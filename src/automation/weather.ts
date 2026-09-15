import { z } from "zod";
import type { Settings, WeatherStatus } from "../shared/contracts";

export type WeatherConfig = Settings["weather"];
const alertSchema = z.object({
  id: z.string().min(1).max(1000),
  event: z.string().max(200),
  severity: z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]),
  status: z.string(),
  messageType: z.string(),
  sent: z.string().datetime({ offset: true }),
  effective: z.string().datetime({ offset: true }),
  expires: z.string().datetime({ offset: true }),
  ends: z.string().datetime({ offset: true }).nullable().optional(),
  headline: z.string().max(4000).nullable().optional(),
});
const responseSchema = z.object({
  features: z.array(z.object({ properties: alertSchema })).max(10_000),
  updated: z.string().datetime({ offset: true }).optional(),
});
export type WeatherAlert = z.infer<typeof alertSchema>;
export interface WeatherLedger {
  seen: Record<string, string>;
  lastTriggeredAt?: string;
}
export interface WeatherResult {
  status: WeatherStatus;
  alerts: WeatherAlert[];
  eligible: WeatherAlert[];
  ledger: WeatherLedger;
}
export interface WeatherOptions {
  fetch?: typeof globalThis.fetch;
  now?: Date;
  signal?: AbortSignal;
  previousStatus?: WeatherStatus;
}
const headers = {
  "User-Agent": "Sentry/0.1 (https://frommeans.com)",
  Accept: "application/geo+json",
};

async function json(url: string, options: WeatherOptions): Promise<unknown> {
  const response = await (options.fetch ?? fetch)(url, {
    headers,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "NWS does not cover this location. Weather protection is unavailable here."
        : `NWS is unavailable (HTTP ${response.status}). Regular schedules are unchanged.`,
    );
  if (Number(response.headers.get("content-length")) > 5_000_000)
    throw new Error("NWS response exceeded the safety limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("NWS returned no data.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 5_000_000) {
      await reader.cancel();
      throw new Error("NWS response exceeded the safety limit.");
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function checkWeather(
  config: WeatherConfig,
  ledger: WeatherLedger,
  options: WeatherOptions = {},
): Promise<WeatherResult> {
  const now = options.now ?? new Date();
  const clean: WeatherLedger = {
    ...ledger,
    seen: Object.fromEntries(
      Object.entries(ledger.seen).filter(
        ([, expiry]) => Date.parse(expiry) > now.getTime(),
      ),
    ),
  };
  if (!config.enabled)
    return {
      status: { ...options.previousStatus, alerts: 0 },
      alerts: [],
      eligible: [],
      ledger: clean,
    };
  const status: WeatherStatus = {
    ...options.previousStatus,
    lastCheck: now.toISOString(),
    alerts: 0,
    error: undefined,
  };
  try {
    const point = `${config.latitude.toFixed(4)},${config.longitude.toFixed(4)}`;
    // A successful empty alert list outside the US must never masquerade as coverage.
    const coverage = z
      .object({ properties: z.object({ forecastZone: z.string().url() }) })
      .safeParse(
        await json(`https://api.weather.gov/points/${point}`, options),
      );
    if (!coverage.success)
      throw new Error(
        "NWS coverage could not be established for this location.",
      );
    const parsed = responseSchema.safeParse(
      await json(
        `https://api.weather.gov/alerts/active?point=${point}`,
        options,
      ),
    );
    if (!parsed.success)
      throw new Error(
        "NWS returned an invalid alert response. No weather jobs were started.",
      );
    if (
      parsed.data.updated &&
      now.getTime() - Date.parse(parsed.data.updated) > 30 * 60_000
    )
      throw new Error(
        "NWS alert data is more than 30 minutes old. No weather jobs were started.",
      );
    const alerts = parsed.data.features
      .map((feature) => feature.properties)
      .filter(
        (alert) =>
          alert.status === "Actual" &&
          ["Alert", "Update"].includes(alert.messageType) &&
          Date.parse(alert.sent) <= now.getTime() &&
          Date.parse(alert.effective) <= now.getTime() &&
          Date.parse(alert.expires) > now.getTime() &&
          (!alert.ends || Date.parse(alert.ends) > now.getTime()),
      );
    const cooling =
      clean.lastTriggeredAt !== undefined &&
      now.getTime() - Date.parse(clean.lastTriggeredAt) <
        config.cooldownMinutes * 60_000;
    const eligible = cooling
      ? []
      : alerts.filter(
          (alert) =>
            config.events.includes(alert.event) &&
            config.severities.includes(alert.severity) &&
            !Object.hasOwn(clean.seen, alert.id),
        );
    return {
      status: {
        ...status,
        lastSuccess: now.toISOString(),
        alerts: alerts.length,
      },
      alerts,
      eligible,
      ledger: clean,
    };
  } catch (error) {
    return {
      status: {
        ...status,
        error: error instanceof Error ? error.message : "Weather check failed.",
      },
      alerts: [],
      eligible: [],
      ledger: clean,
    };
  }
}

/** Call only in the same durable transaction as successfully queued real weather jobs. */
export function acknowledgeWeather(
  ledger: WeatherLedger,
  alerts: WeatherAlert[],
  now = new Date(),
): WeatherLedger {
  if (!alerts.length) return ledger;
  return {
    seen: {
      ...ledger.seen,
      ...Object.fromEntries(alerts.map((alert) => [alert.id, alert.expires])),
    },
    lastTriggeredAt: now.toISOString(),
  };
}

/** Simulation has no network, queue or ledger side effects. It cannot produce a real alert. */
export function simulateWeather(config: WeatherConfig): {
  simulation: true;
  message: string;
  planIds: string[];
} {
  return {
    simulation: true,
    message: `Simulation only: ${config.events[0] ?? "a configured alert"} would request ${config.planIds.length} selected plan(s). No backup was started.`,
    planIds: [...config.planIds],
  };
}
