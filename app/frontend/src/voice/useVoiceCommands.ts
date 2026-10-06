import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDLE_STATE,
  createVoiceListener,
  type VoiceCommand,
  type VoiceErrorReason,
  type VoiceListener,
  type VoiceListenerOptions,
  type VoiceScoreFrame,
  type VoiceStatus,
} from './voiceCommandService';

const PREF_KEY = 'voiceCommands.enabled';

function readPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export interface UseVoiceCommandsOptions {
  /**
   * Gate for the whole feature (e.g. only while a session screen is mounted/active). When false the
   * microphone is always released. When it flips true the mic starts only if the stored user
   * preference is "on" (set earlier by a user-initiated toggle/start). Default true.
   */
  enabled?: boolean;
  /** Command callbacks. The latest ones are always used, no need to memoize. */
  handlers: Partial<Record<VoiceCommand, () => void>>;
  /** Forwarded to the listener (thresholds, commands, labelMap, modelBaseUrl, ...). Read once per start. */
  listenerOptions?: Omit<VoiceListenerOptions, 'onCommand' | 'onStateChange' | 'onScores'>;
  /** Receive every prediction frame (debug). Latest callback is used. */
  onScores?: (frame: VoiceScoreFrame) => void;
  /** Called after any recognized command (even without a handler for it). */
  onCommand?: (command: VoiceCommand, confidence: number) => void;
}

export interface UseVoiceCommandsResult {
  status: VoiceStatus;
  error: VoiceErrorReason | null;
  /** Most recent recognized command with a timestamp (use `at` to key a flash animation). */
  lastCommand: { command: VoiceCommand; confidence: number; at: number } | null;
  /** Latest prediction frame (updated at most ~4x/s to limit re-renders). */
  lastScores: VoiceScoreFrame | null;
  /** User-initiated start; persists preference "on". */
  start: () => void;
  /** User-initiated stop; persists preference "off". */
  stop: () => void;
  toggle: () => void;
}

export function useVoiceCommands(opts: UseVoiceCommandsOptions): UseVoiceCommandsResult {
  const { enabled = true } = opts;
  const [state, setState] = useState(IDLE_STATE);
  const [lastCommand, setLastCommand] = useState<UseVoiceCommandsResult['lastCommand']>(null);
  const [lastScores, setLastScores] = useState<VoiceScoreFrame | null>(null);

  // Latest props in a ref so the long-lived listener never calls stale closures.
  const latest = useRef(opts);
  latest.current = opts;

  const listenerRef = useRef<VoiceListener | null>(null);
  const lastScoreUiAt = useRef(0);

  const ensureListener = useCallback((): VoiceListener => {
    if (listenerRef.current) return listenerRef.current;
    const listener = createVoiceListener({
      ...latest.current.listenerOptions,
      onStateChange: (s) => setState(s),
      onCommand: (command, confidence) => {
        setLastCommand({ command, confidence, at: Date.now() });
        try {
          latest.current.handlers[command]?.();
        } catch (e) {
          console.warn('[voice] handler threw', e);
        }
        latest.current.onCommand?.(command, confidence);
      },
      onScores: (frame) => {
        latest.current.onScores?.(frame);
        if (frame.timeMs - lastScoreUiAt.current >= 250) {
          lastScoreUiAt.current = frame.timeMs;
          setLastScores(frame);
        }
      },
    });
    listenerRef.current = listener;
    return listener;
  }, []);

  const start = useCallback(() => {
    writePref(true);
    void ensureListener().start();
  }, [ensureListener]);

  const stop = useCallback(() => {
    writePref(false);
    void listenerRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    const s = listenerRef.current?.getState().status ?? 'idle';
    if (s === 'loading' || s === 'listening') stop();
    else start();
  }, [start, stop]);

  // Auto-start (only when the user previously switched it on) / auto-release when `enabled` changes.
  useEffect(() => {
    if (!enabled) return;
    if (readPref()) void ensureListener().start();
    return () => {
      // Release the mic on disable/unmount WITHOUT touching the saved preference.
      void listenerRef.current?.stop();
      setLastScores(null);
    };
  }, [enabled, ensureListener]);

  return {
    status: state.status,
    error: state.error,
    lastCommand,
    lastScores,
    start,
    stop,
    toggle,
  };
}
