/** Type surface of the OQ-16 worker entry point (implementation is plain ESM). */

export declare const WORKER_NAME: "receipt-sla";
export declare const DEFAULT_POLL_MS: number;
export declare const DEFAULT_SHUTDOWN_TIMEOUT_MS: number;

export interface SlaMetrics {
  bucket: number;
  pending_submissions: number;
  due_submissions: number;
  active_administrators: number;
  notifications_created: number;
  processed_at: string;
}

export interface WorkerLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export type SlaRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

export declare function createLogger(options?: {
  now?: () => Date;
  write?: (line: string) => void;
}): WorkerLogger;

export declare function processSlaCycle(options: {
  rpc: SlaRpc;
  logger?: WorkerLogger;
  clock?: () => Date;
}): Promise<SlaMetrics>;

export declare function defaultSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void>;

export interface SlaWorkerOptions {
  rpc: SlaRpc;
  logger?: WorkerLogger;
  pollMs?: number;
  shutdownTimeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  clock?: () => Date;
  runCycle?: (options: {
    rpc: SlaRpc;
    logger: WorkerLogger;
    clock: () => Date;
  }) => Promise<SlaMetrics>;
}

export interface SlaWorker {
  start(): Promise<void>;
  stop(signal?: string): Promise<void>;
  done: Promise<void>;
  isRunning(): boolean;
}

export declare function createSlaWorker(options: SlaWorkerOptions): SlaWorker;

export declare function main(): Promise<void>;
