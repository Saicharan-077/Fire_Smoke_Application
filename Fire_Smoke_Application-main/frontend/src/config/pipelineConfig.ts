/**
 * Detection-pipeline integration config.
 *
 * PER-PAGE FEATURE FLAGS
 * ----------------------
 * A single global flag would be unsafe during a staged migration: enabling it
 * to test one page would also switch every other page that reads it, including
 * pages not yet repointed. Each page therefore has its own flag, so exactly one
 * surface moves at a time and rollback is per-page rather than all-or-nothing.
 *
 * `VITE_USE_PIPELINE` is a master switch used only for the final cutover; a
 * per-page flag that is explicitly set always wins over it.
 */

const env = import.meta.env as Record<string, string | undefined>;

const bool = (v: string | undefined): boolean | undefined => {
  if (v === undefined || v === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

/** Master switch. Per-page flags override it when explicitly set. */
const MASTER = bool(env.VITE_USE_PIPELINE) ?? false;

const page = (v: string | undefined): boolean => bool(v) ?? MASTER;

export const PIPELINE_FLAGS = {
  detection: page(env.VITE_USE_PIPELINE_DETECTION),
  liveMonitoring: page(env.VITE_USE_PIPELINE_LIVE_MONITORING),
  dashboard: page(env.VITE_USE_PIPELINE_DASHBOARD),
  alerts: page(env.VITE_USE_PIPELINE_ALERTS),
} as const;

export type PipelinePage = keyof typeof PIPELINE_FLAGS;

export const PIPELINE_CONFIG = {
  baseUrl: env.VITE_PIPELINE_BASE_URL ?? 'http://localhost:8100',
  apiKey: env.VITE_PIPELINE_API_KEY ?? '',
  /** Health poll interval, ms. Drives the automatic fallback. */
  healthIntervalMs: 15000,
} as const;

/** Any page on the pipeline? Used to decide whether to poll health at all. */
export const anyPipelinePageEnabled = (): boolean =>
  Object.values(PIPELINE_FLAGS).some(Boolean);
