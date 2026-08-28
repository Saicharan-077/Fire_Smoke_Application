/**
 * Polls the pipeline's health endpoint and reports whether it is reachable.
 *
 * Drives the AUTOMATIC fallback described in DASHBOARD_MIGRATION_PLAN.md §6:
 * if the pipeline goes unreachable mid-session, a repointed page falls back to
 * the legacy endpoint for the rest of that session and shows a banner. There is
 * deliberately no automatic fail-BACK once the pipeline recovers -- flipping a
 * live page between two detection backends mid-session is worse than asking
 * for a reload, so recovery is a manual refresh.
 */

import { useEffect, useRef, useState } from 'react';
import { pipelineHealth, PipelineUnavailableError, type PipelineHealth } from '../services/pipelineApi';
import { PIPELINE_CONFIG, anyPipelinePageEnabled } from '../config/pipelineConfig';

export interface PipelineHealthState {
  /** True once ANY health check has failed this session. Once true, stays
   *  true -- see the no-fail-back note above. */
  everUnavailable: boolean;
  /** True right now, i.e. the most recent check failed. */
  currentlyUnavailable: boolean;
  health: PipelineHealth | null;
  lastError: string | null;
}

export function usePipelineHealth(enabled: boolean = anyPipelinePageEnabled()): PipelineHealthState {
  const [state, setState] = useState<PipelineHealthState>({
    everUnavailable: false,
    currentlyUnavailable: false,
    health: null,
    lastError: null,
  });
  const everUnavailableRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const check = async () => {
      try {
        const health = await pipelineHealth();
        if (cancelled) return;
        setState({
          everUnavailable: everUnavailableRef.current,
          currentlyUnavailable: false,
          health,
          lastError: null,
        });
      } catch (e) {
        if (cancelled) return;
        everUnavailableRef.current = true;
        const message = e instanceof PipelineUnavailableError
          ? e.message
          : e instanceof Error ? e.message : 'Unknown pipeline error';
        setState({
          everUnavailable: true,
          currentlyUnavailable: true,
          health: null,
          lastError: message,
        });
      }
    };

    check();
    const id = window.setInterval(check, PIPELINE_CONFIG.healthIntervalMs);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled]);

  return state;
}
