import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { nextRun, isDue, reconcileTimeZone } from "../src/automation/schedule";
import {
  acknowledgeWeather,
  checkWeather,
  simulateWeather,
} from "../src/automation/weather";
import {
  GoogleDriveAuth,
  type GoogleCredentials,
} from "../src/automation/google";
import { defaults, scheduleSchema } from "../src/shared/contracts";

describe("durable schedule decisions", () => {
  test("month end clamps, leap years and strict after semantics", () => {
    const schedule = scheduleSchema.parse({
      kind: "monthly",
      day: 31,
      time: "18:00",
    });
    expect(nextRun(schedule, new Date(2028, 0, 31, 18))?.getTime()).toBe(
      new Date(2028, 1, 29, 18).getTime(),
    );
    expect(nextRun(schedule, new Date(2027, 0, 31, 18))?.getTime()).toBe(
      new Date(2027, 1, 28, 18).getTime(),
    );
  });
  test("missed runs catch up once and are re-anchored after enqueue", () => {
    const schedule = scheduleSchema.parse({ kind: "interval", minutes: 60 });
    const now = new Date("2026-09-15T12:00:00Z");
    expect(isDue(schedule, "2026-09-01T12:00:00Z", now)).toBe(true);
    expect(isDue(schedule, nextRun(schedule, now)?.toISOString(), now)).toBe(
      false,
    );
    expect(nextRun(schedule, now)?.toISOString()).toBe(
      "2026-09-15T13:00:00.000Z",
    );
    expect(
      isDue(
        scheduleSchema.parse({ kind: "manual" }),
        "2026-09-01T12:00:00Z",
        now,
      ),
    ).toBe(false);
    expect(isDue(schedule, "bad date", now)).toBe(false);
  });
  test("weekly skips current occurrence and timezone reconciliation preserves overdue work", () => {
    const schedule = scheduleSchema.parse({
      kind: "weekly",
      weekday: 1,
      time: "09:00",
    });
    const now = new Date(2026, 8, 14, 9);
    expect(nextRun(schedule, now)?.getTime()).toBe(
      new Date(2026, 8, 21, 9).getTime(),
    );
    expect(reconcileTimeZone(schedule, "2020-01-01T00:00:00Z", now)).toBe(
      "2020-01-01T00:00:00Z",
    );
  });
  test("DST transitions preserve local wall-clock semantics in America/Chicago", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      const spring = nextRun(
        scheduleSchema.parse({ kind: "daily", time: "02:30" }),
        new Date(2026, 2, 8, 0),
      );
      expect(spring?.getHours()).toBe(3);
      expect(spring?.getMinutes()).toBe(30);
      const autumn = scheduleSchema.parse({ kind: "daily", time: "01:30" });
      const first = nextRun(autumn, new Date(2026, 10, 1, 0));
      expect(first?.getDate()).toBe(1);
      expect(nextRun(autumn, first!)?.getDate()).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

const now = new Date("2026-09-15T12:00:00Z");
const alert = {
  id: "urn:alert:one",
  event: "Tornado Warning",
  severity: "Extreme",
  status: "Actual",
  messageType: "Alert",
  sent: "2026-09-15T11:55:00Z",
  effective: "2026-09-15T11:55:00Z",
  expires: "2026-09-15T14:00:00Z",
};
const weather = { ...defaults.weather, enabled: true, planIds: ["school"] };
function weatherFetch(
  alerts: unknown[],
  updated = now.toISOString(),
): typeof fetch {
  return (async (input: string | URL | Request) =>
    new Response(
      JSON.stringify(
        String(input).includes("/points/")
          ? {
              properties: {
                forecastZone: "https://api.weather.gov/zones/forecast/TXZ119",
              },
            }
          : { updated, features: alerts.map((properties) => ({ properties })) },
      ),
      { headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
}

describe("weather safety", () => {
  test("only actual, current, selected alerts can trigger; acknowledgement deduplicates across restart", async () => {
    const result = await checkWeather(
      weather,
      { seen: {} },
      {
        now,
        fetch: weatherFetch([
          alert,
          { ...alert, id: "test", status: "Test" },
          { ...alert, id: "expired", expires: "2026-09-15T11:00:00Z" },
          { ...alert, id: "cancel", messageType: "Cancel" },
        ]),
      },
    );
    expect(result.eligible.map((item) => item.id)).toEqual(["urn:alert:one"]);
    expect(result.ledger.seen).toEqual({});
    const ledger = JSON.parse(
      JSON.stringify(acknowledgeWeather(result.ledger, result.eligible, now)),
    );
    expect(
      (
        await checkWeather(weather, ledger, {
          now,
          fetch: weatherFetch([alert]),
        })
      ).eligible,
    ).toHaveLength(0);
    expect(
      (
        await checkWeather(weather, ledger, {
          now,
          fetch: weatherFetch([{ ...alert, id: "other" }]),
        })
      ).eligible,
    ).toHaveLength(0);
  });
  test("coverage failures, malformed and stale data never become clear-weather success", async () => {
    const unavailable = await checkWeather(
      weather,
      { seen: {} },
      {
        now,
        fetch: (async (_input: string | URL | Request) =>
          new Response("", { status: 404 })) as typeof fetch,
        previousStatus: { alerts: 1, lastSuccess: "2026-09-14T12:00:00Z" },
      },
    );
    expect(unavailable.status.error).toContain("does not cover");
    expect(unavailable.status.lastSuccess).toBe("2026-09-14T12:00:00Z");
    expect(
      (
        await checkWeather(
          weather,
          { seen: {} },
          { now, fetch: weatherFetch([{ broken: true }]) },
        )
      ).status.error,
    ).toContain("invalid");
    expect(
      (
        await checkWeather(
          weather,
          { seen: {} },
          { now, fetch: weatherFetch([alert], "2026-09-15T10:00:00Z") },
        )
      ).status.error,
    ).toContain("30 minutes");
  });
  test("simulation is explicitly separate from real history and dedup", () => {
    const result = simulateWeather(weather);
    expect(result.simulation).toBe(true);
    expect(result.message).toContain("No backup was started");
    expect(result.planIds).toEqual(["school"]);
  });
});

describe("Google installed application protocol", () => {
  test("loopback rejects bad state, then exchanges PKCE and persists offline credentials", async () => {
    let saved: GoogleCredentials | null = null;
    let challenge = "";
    let callbackRedirect = "";
    const auth = new GoogleDriveAuth({
      clientId: "test.apps.googleusercontent.com",
      load: async () => saved,
      save: async (value) => {
        saved = value;
      },
      onAuthorize: async (url) => {
        const authorization = new URL(url);
        challenge = authorization.searchParams.get("code_challenge")!;
        callbackRedirect = authorization.searchParams.get("redirect_uri")!;
        expect(authorization.origin).toBe("https://accounts.google.com");
        expect(authorization.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        expect(new URL(callbackRedirect).hostname).toBe("127.0.0.1");
        expect(
          (await fetch(`${callbackRedirect}?state=invalid&code=bad`)).status,
        ).toBe(400);
        expect(
          (
            await fetch(
              `${callbackRedirect}?${new URLSearchParams({ state: authorization.searchParams.get("state")!, code: "fixture-code" })}`,
            )
          ).status,
        ).toBe(200);
      },
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://oauth2.googleapis.com/token");
        const body = init?.body as URLSearchParams;
        expect(body.get("redirect_uri")).toBe(callbackRedirect);
        expect(
          createHash("sha256")
            .update(body.get("code_verifier")!)
            .digest("base64url"),
        ).toBe(challenge);
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }) as typeof fetch,
    });
    await auth.connect();
    expect(await auth.connected()).toBe(true);
    const environment = await auth.environment();
    expect(environment.RCLONE_CONFIG_SENTRY_TYPE).toBe("drive");
    expect(
      JSON.parse(environment.RCLONE_CONFIG_SENTRY_TOKEN!).refresh_token,
    ).toBe("fixture-refresh");
    await auth.disconnect();
    expect(await auth.connected()).toBe(false);
  });
  test("refresh is single-flight, preserves refresh token, updates secure storage and returns quota", async () => {
    let saved: GoogleCredentials | null = {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: 0,
      tokenType: "Bearer",
    };
    let refreshes = 0;
    const auth = new GoogleDriveAuth({
      clientId: "test.apps.googleusercontent.com",
      load: async () => saved,
      save: async (value) => {
        saved = value;
      },
      onAuthorize: async () => {},
      fetch: (async (input: string | URL | Request) => {
        if (String(input).includes("/token")) {
          refreshes++;
          return Response.json({
            access_token: "new",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        return Response.json({ storageQuota: { usage: "123", limit: "456" } });
      }) as typeof fetch,
    });
    const refreshed = await Promise.all([auth.refresh(), auth.refresh()]);
    expect(refreshes).toBe(1);
    expect(refreshed[0].refreshToken).toBe("refresh");
    expect(await auth.quota()).toEqual({ used: 123, limit: 456 });
  });
  test("decline, timeout and cancellation do not save credentials; errors do not reflect provider secrets", async () => {
    let writes = 0;
    const base = {
      clientId: "test.apps.googleusercontent.com",
      load: async () => null,
      save: async () => {
        writes++;
      },
    };
    const timeout = new GoogleDriveAuth({
      ...base,
      timeoutMs: 25,
      onAuthorize: async () => {},
    });
    await expect(timeout.connect()).rejects.toThrow("timed out");
    const controller = new AbortController();
    const cancel = new GoogleDriveAuth({
      ...base,
      onAuthorize: async () => {
        controller.abort();
      },
    });
    await expect(cancel.connect(controller.signal)).rejects.toThrow(
      "cancelled",
    );
    const decline = new GoogleDriveAuth({
      ...base,
      onAuthorize: async (url) => {
        const parsed = new URL(url);
        await fetch(
          `${parsed.searchParams.get("redirect_uri")}?${new URLSearchParams({ state: parsed.searchParams.get("state")!, error: "secret-provider-details" })}`,
        );
      },
    });
    await expect(decline.connect()).rejects.toThrow("declined");
    expect(writes).toBe(0);
  });
});
