export type RuntimeEnv = Record<string, string | undefined>;

export type Logger = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

export type WorkerState = {
  name: string;
  status: string;
  restartCount: number;
  lastError: string | null;
};

export type RuntimeConfig = {
  url: string;
  serviceRoleKey: string;
  port: number | null;
  host: string;
  slaPollMs: number;
  slaShutdownTimeoutMs: number;
  bcvFetchTimeoutMs: number;
  bcvShutdownTimeoutMs: number;
};

export type SupervisedWorker = {
  start: () => Promise<void>;
  stop: (signal?: string) => Promise<void>;
  getState: () => WorkerState;
  isRunning: () => boolean;
};

export type UnifiedWorkerRuntime = {
  start: () => Promise<{ port: number | null }>;
  stop: (signal?: string) => Promise<void>;
  getHealthPort: () => number | null;
  getWorkerStates: () => Record<string, WorkerState>;
  isStopping: () => boolean;
};

export function validateRuntimeEnv(env?: RuntimeEnv): RuntimeConfig;
export function createRuntimeLogger(options?: {
  now?: () => Date;
  write?: (line: string) => void;
}): Logger;
export function createRuntimeHealthSnapshot(options: {
  startedAt: Date;
  now?: () => Date;
  workers?: Record<string, unknown>;
}): Record<string, unknown>;
export function startRuntimeHealthServer(options?: {
  port?: number;
  host?: string;
  startedAt?: Date;
  now?: () => Date;
  getWorkers?: () => Record<string, unknown>;
}): Promise<{ port: number; host: string; close: () => Promise<void> }>;
export function superviseWorker(options: {
  name: string;
  create: () => unknown;
  logger?: Logger;
  restartDelayMs?: number;
  beforeRestart?: (context: {
    name: string;
    restartCount: number;
    error?: unknown;
  }) => Promise<void>;
}): SupervisedWorker;
export function createUnifiedWorkerRuntime(options?: {
  env?: RuntimeEnv;
  logger?: Logger;
  createClientImpl?: (...args: unknown[]) => unknown;
  createBcvWorker?: (...args: unknown[]) => unknown;
  createSlaWorkerImpl?: (...args: unknown[]) => unknown;
  startHealthServer?: (...args: unknown[]) => unknown;
  now?: () => Date;
  bcvLogger?: Logger;
  slaLogger?: Logger;
}): UnifiedWorkerRuntime;
export function main(env?: RuntimeEnv): Promise<void>;
