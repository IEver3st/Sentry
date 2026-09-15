export interface DiagnosticEvent {
  id: number;
  time: string;
  level: "info" | "warning" | "error";
  source: "application" | "engine" | "request";
  message: string;
  operation?: string;
  durationMs?: number;
  jobId?: string;
}
export interface ResourceProcess {
  pid: number;
  name: string;
  cpu: number | null;
  memory: number;
}
export interface DiagnosticsSnapshot {
  capturedAt: string;
  collectionMs: number;
  runtime: { app: string; electron: string; node: string; platform: string; arch: string; uptime: number; logicalCores: number; totalMemory: number; freeMemory: number; battery: boolean; idleSeconds: number; encryption: boolean; workerConnected: boolean; pendingRequests: number };
  processes: ResourceProcess[];
  events: DiagnosticEvent[];
  droppedEvents: number;
  engine: { version: string; busy: boolean; paused: boolean; jobs: number; queued: number; destinations: number; unavailable: number; googleConnected: boolean; weatherLastCheck?: string; weatherError: boolean } | null;
  engineError?: string;
}
