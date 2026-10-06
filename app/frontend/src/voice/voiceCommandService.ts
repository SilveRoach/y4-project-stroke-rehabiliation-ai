/**
 * Framework-agnostic voice command listener (Teachable Machine audio model through
 * @tensorflow-models/speech-commands). Runs fully on-device; no audio leaves the browser.
 *
 * The heavy TF.js bundle is loaded with a dynamic import() inside start(), so importing this
 * file costs almost nothing and a load failure can never break the host page.
 *
 * Decision logic (cooldown / confirm streak / held-command suppression / warm-up) lives in the
 * pure function decideFrame() so it can be reasoned about and tested without a microphone.
 */

/** Commands the app understands. */
export type VoiceCommand = 'start' | 'stop' | 'pause' | 'continue';

export const ALL_VOICE_COMMANDS: readonly VoiceCommand[] = ['start', 'pause', 'continue', 'stop'];

/**
 * Model class label -> command. Labels must match the class names set in Teachable Machine
 * exactly. Any label not listed here (including the background-noise class) is ignored.
 */
export const DEFAULT_LABEL_MAP: Readonly<Record<string, VoiceCommand>> = {
  เริ่ม: 'start',
  พัก: 'pause',
  ทำต่อ: 'continue',
  ยกเลิก: 'stop',
};

/** Thai display words per command (for UI hints). */
export const VOICE_COMMAND_WORDS: Readonly<Record<VoiceCommand, string>> = {
  start: 'เริ่ม',
  pause: 'พัก',
  continue: 'ทำต่อ',
  stop: 'ยกเลิก',
};

// ---------------------------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------------------------

export type VoiceErrorReason =
  | 'no-model' // model files missing / unreadable / not valid JSON
  | 'mic-denied' // user (or policy) refused microphone permission
  | 'insecure-context' // getUserMedia needs HTTPS or localhost
  | 'unsupported' // no mediaDevices / no microphone / browser lacks WebAudio
  | 'unknown';

export type VoiceStatus = 'idle' | 'loading' | 'listening' | 'error';

export interface VoiceState {
  status: VoiceStatus;
  /** Set only when status === 'error'. */
  error: VoiceErrorReason | null;
  /** Raw error message for the console / debugging (never shown to users). */
  detail?: string;
}

export const IDLE_STATE: VoiceState = { status: 'idle', error: null };

// ---------------------------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------------------------

/** Why a frame did or did not fire a command. */
export type VoiceFrameOutcome =
  | 'fired'
  | 'confirming' // command class wins above threshold but streak is not long enough yet
  | 'cooldown' // confirmed, but within cooldown of the last fire or the same sound is still held
  | 'below-threshold' // command class wins but its score is under the threshold
  | 'not-command' // winner is noise or an unmapped label
  | 'warming-up'; // recognizer started less than warmupMs ago

export interface DecisionState {
  streakCommand: VoiceCommand | null;
  streakCount: number;
  /** Command already fired whose sound is still continuously winning; suppressed until it breaks. */
  heldCommand: VoiceCommand | null;
  lastFiredAt: number;
}

export function initialDecisionState(): DecisionState {
  return { streakCommand: null, streakCount: 0, heldCommand: null, lastFiredAt: -Infinity };
}

export interface DecisionConfig {
  labelMap: Readonly<Record<string, VoiceCommand>>;
  /** Commands that are active; others behave like "not-command". */
  enabledCommands: ReadonlySet<VoiceCommand>;
  defaultThreshold: number;
  /** Per-command confidence override (0-1). */
  thresholds: Partial<Record<VoiceCommand, number>>;
  confirmFrames: number;
  cooldownMs: number;
}

export interface FrameInput {
  topLabel: string;
  topScore: number;
  now: number;
  /** false during the warm-up window after start. */
  ready: boolean;
}

export interface DecisionResult {
  state: DecisionState;
  outcome: VoiceFrameOutcome;
  command: VoiceCommand | null;
  threshold: number;
}

/** Pure: given the previous state and one frame, return the next state and the outcome. */
export function decideFrame(prev: DecisionState, frame: FrameInput, cfg: DecisionConfig): DecisionResult {
  const mapped = cfg.labelMap[frame.topLabel];
  const command = mapped !== undefined && cfg.enabledCommands.has(mapped) ? mapped : null;
  const threshold = command ? (cfg.thresholds[command] ?? cfg.defaultThreshold) : cfg.defaultThreshold;

  // Warm-up: ignore the frame completely and reset streaks so startup glitches cannot accumulate.
  if (!frame.ready) {
    return {
      state: { ...initialDecisionState(), lastFiredAt: prev.lastFiredAt },
      outcome: 'warming-up',
      command,
      threshold,
    };
  }

  const qualifies = command !== null && frame.topScore >= threshold;
  let { streakCommand, streakCount, heldCommand } = prev;

  if (qualifies && command === streakCommand) {
    streakCount += 1;
  } else if (qualifies) {
    streakCommand = command;
    streakCount = 1;
  } else {
    streakCommand = null;
    streakCount = 0;
  }
  // The held flag is released as soon as that same command stops winning.
  if (heldCommand !== null && !(qualifies && command === heldCommand)) heldCommand = null;

  let outcome: VoiceFrameOutcome;
  if (!command) outcome = 'not-command';
  else if (!qualifies) outcome = 'below-threshold';
  else if (streakCount < cfg.confirmFrames) outcome = 'confirming';
  else if (command === heldCommand || frame.now - prev.lastFiredAt < cfg.cooldownMs) outcome = 'cooldown';
  else outcome = 'fired';

  let lastFiredAt = prev.lastFiredAt;
  if (outcome === 'fired') {
    lastFiredAt = frame.now;
    heldCommand = command;
  }

  return { state: { streakCommand, streakCount, heldCommand, lastFiredAt }, outcome, command, threshold };
}

// ---------------------------------------------------------------------------------------------
// Listener
// ---------------------------------------------------------------------------------------------

export interface VoiceScoreFrame {
  /** Date.now() when the prediction finished. */
  timeMs: number;
  /** Scores of every model class, in wordLabels() order. */
  scores: { label: string; score: number; isCommand: boolean }[];
  topLabel: string;
  topScore: number;
  command: VoiceCommand | null;
  outcome: VoiceFrameOutcome;
  threshold: number;
}

export interface VoiceListenerOptions {
  /** Called when a command is recognized. Exceptions thrown here are caught and logged. */
  onCommand: (command: VoiceCommand, confidence: number) => void;
  /** Called on every state change. */
  onStateChange?: (state: VoiceState) => void;
  /** Called for every prediction (~6-7/s). Keep it cheap; used for debug panels. */
  onScores?: (frame: VoiceScoreFrame) => void;
  /**
   * Folder containing model.json / metadata.json / weights.bin. Default: `${import.meta.env.BASE_URL}voice-model/`
   * so it works under a non-root Vite `base`. Relative values are resolved against the page URL.
   */
  modelBaseUrl?: string;
  /** Default confidence threshold (0-1). Default 0.75. */
  probabilityThreshold?: number;
  /** Per-command confidence override, e.g. { stop: 0.9 } to make the destructive command harder to trigger. */
  thresholds?: Partial<Record<VoiceCommand, number>>;
  /** Which commands are active. Default: all four. */
  commands?: readonly VoiceCommand[];
  /** Override the label -> command map (when the model uses different class names). */
  labelMap?: Readonly<Record<string, VoiceCommand>>;
  /** Fraction (0 <= x < 1) by which successive 1 s windows overlap. Default 0.85 (~0.15 s per prediction). */
  overlapFactor?: number;
  /** Consecutive winning frames needed before firing. Default 2. */
  confirmFrames?: number;
  /** Minimum gap between two fired commands. Default 1000 ms. */
  cooldownMs?: number;
  /** Ignore all frames for this long after the recognizer starts listening. Default 500 ms. */
  warmupMs?: number;
}

export interface VoiceListener {
  /** Load the model and start listening. Resolves when listening (or after an error state). Never throws. */
  start: () => Promise<void>;
  /** Stop listening and release the microphone. Safe to call at any time, even while start() is pending. */
  stop: () => Promise<void>;
  getState: () => VoiceState;
}

/** Model URL honoring Vite's `base` (e.g. /app/). */
export function defaultModelBaseUrl(): string {
  let base = '/';
  try {
    base = import.meta.env.BASE_URL || '/';
  } catch {
    /* non-Vite environment */
  }
  return `${base.endsWith('/') ? base : `${base}/`}voice-model/`;
}

function classifyError(err: unknown): VoiceErrorReason {
  const name = (err as { name?: string } | null)?.name ?? '';
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return typeof window !== 'undefined' && window.isSecureContext === false ? 'insecure-context' : 'mic-denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotSupportedError') return 'unsupported';
  if (msg.includes('permission') || msg.includes('denied')) return 'mic-denied';
  return 'unknown';
}

export function createVoiceListener(options: VoiceListenerOptions): VoiceListener {
  let state: VoiceState = IDLE_STATE;
  /** Bumped on every start()/stop(); an in-flight run whose token is stale must clean up and bail out. */
  let generation = 0;
  /** True from start() until stop() or failure; prevents duplicate starts. */
  let wanted = false;
  /** Serializes runs so two overlapping getUserMedia wrappers can never exist (StrictMode double-mount). */
  let inflight: Promise<void> = Promise.resolve();
  /** Resources of the run currently holding the microphone. */
  let current: Run | null = null;

  interface Run {
    recognizer: { stopListening: () => Promise<void>; isListening: () => boolean } | null;
    streams: MediaStream[];
  }

  const setState = (next: VoiceState) => {
    state = next;
    try {
      options.onStateChange?.(next);
    } catch (e) {
      console.warn('[voice] onStateChange threw', e);
    }
  };

  /** Stop recognizer + every mic track of a run. Never throws. */
  const release = async (run: Run) => {
    if (current === run) current = null;
    const rec = run.recognizer;
    run.recognizer = null;
    if (rec) {
      try {
        if (rec.isListening()) await rec.stopListening();
      } catch {
        /* already stopped */
      }
    }
    for (const s of run.streams) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    run.streams = [];
  };

  const start = (): Promise<void> => {
    if (wanted) return inflight; // already starting/listening
    wanted = true;
    const myGen = ++generation;
    setState({ status: 'loading', error: null });
    inflight = inflight.then(() => run(myGen)).catch((e) => console.warn('[voice] unexpected', e));
    return inflight;
  };

  const run = async (myGen: number): Promise<void> => {
    const isStale = () => myGen !== generation;
    if (isStale()) return;
    const mine: Run = { recognizer: null, streams: [] };
    current = mine;
    const fail = async (error: VoiceErrorReason, detail?: unknown) => {
      await release(mine);
      if (isStale()) return;
      wanted = false;
      if (detail !== undefined) console.warn(`[voice] ${error}`, detail);
      setState({ status: 'error', error, detail: detail === undefined ? undefined : String(detail) });
    };

    // 1. Environment checks (cheap, before downloading anything).
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return fail('unsupported');
    if (window.isSecureContext === false) return fail('insecure-context');
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return fail('unsupported');
    }

    // 2. Model files. Vite dev server answers missing files with index.html (200), so check the JSON too.
    const baseUrl = new URL(options.modelBaseUrl ?? defaultModelBaseUrl(), window.location.href).toString();
    const modelUrl = `${baseUrl}model.json`;
    const metadataUrl = `${baseUrl}metadata.json`;
    try {
      const [m, md] = await Promise.all([fetch(modelUrl), fetch(metadataUrl)]);
      if (!m.ok || !md.ok) throw new Error(`HTTP ${m.status}/${md.status}`);
      await m.clone().json();
      await md.json();
    } catch (e) {
      return fail('no-model', e);
    }
    if (isStale()) return release(mine);

    // 3. Lazy-load TF.js + speech-commands.
    let recognizer: Awaited<ReturnType<typeof createRecognizer>>;
    try {
      recognizer = await createRecognizer(modelUrl, metadataUrl);
    } catch (e) {
      return fail(e instanceof Error && /fetch|load|model/i.test(e.message) ? 'no-model' : 'unknown', e);
    }
    if (isStale()) return release(mine);

    const wordLabels = recognizer.wordLabels();
    const labelMap = options.labelMap ?? DEFAULT_LABEL_MAP;
    const cfg: DecisionConfig = {
      labelMap,
      enabledCommands: new Set(options.commands ?? ALL_VOICE_COMMANDS),
      defaultThreshold: options.probabilityThreshold ?? 0.75,
      thresholds: options.thresholds ?? {},
      confirmFrames: Math.max(1, Math.floor(options.confirmFrames ?? 2)),
      cooldownMs: options.cooldownMs ?? 1000,
    };
    const warmupMs = options.warmupMs ?? 500;
    let decision = initialDecisionState();
    let listenStartedAt = Infinity; // set right after listen() resolves

    // 4. Start listening. getUserMedia is wrapped only for the duration of listen() so that
    // we hold a reference to the stream and can always stop its tracks ourselves.
    mine.recognizer = recognizer;
    const md = navigator.mediaDevices;
    const origGum = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await origGum(c);
      mine.streams.push(s);
      return s;
    };

    try {
      // The library is asked to report EVERY prediction (threshold 0, noise included, no suppression)
      // and all filtering happens in decideFrame(). Reason: the library only skips a class literally
      // named "_background_noise_", but the Thai Teachable Machine names it differently, which made the
      // library treat noise as a detected word and pause listening for 1 s each time.
      await recognizer.listen(
        async (result) => {
          if (isStale()) return;
          const raw = result.scores as Float32Array;
          let top = 0;
          for (let i = 1; i < raw.length; i++) if (raw[i] > raw[top]) top = i;
          const now = Date.now();
          const d = decideFrame(
            decision,
            { topLabel: wordLabels[top], topScore: raw[top], now, ready: now - listenStartedAt >= warmupMs },
            cfg
          );
          decision = d.state;

          if (options.onScores) {
            try {
              options.onScores({
                timeMs: now,
                scores: wordLabels.map((label, i) => ({
                  label,
                  score: raw[i],
                  isCommand: label in labelMap && cfg.enabledCommands.has(labelMap[label]),
                })),
                topLabel: wordLabels[top],
                topScore: raw[top],
                command: d.command,
                outcome: d.outcome,
                threshold: d.threshold,
              });
            } catch {
              /* debug consumer must never break listening */
            }
          }

          if (d.outcome === 'fired' && d.command) {
            try {
              options.onCommand(d.command, raw[top]);
            } catch (e) {
              console.warn('[voice] onCommand threw', e);
            }
          }
        },
        {
          probabilityThreshold: 0,
          invokeCallbackOnNoiseAndUnknown: true,
          overlapFactor: options.overlapFactor ?? 0.85,
          suppressionTimeMillis: 0,
        }
      );
    } catch (e) {
      md.getUserMedia = origGum;
      return fail(classifyError(e), e);
    }
    md.getUserMedia = origGum;

    // stop() was called while we were waiting for the permission prompt / model: honor it now.
    if (isStale()) return release(mine);
    listenStartedAt = Date.now();
    setState({ status: 'listening', error: null });
  };

  const stop = async (): Promise<void> => {
    generation++; // invalidates any in-flight run and mutes pending callbacks
    wanted = false;
    if (state.status !== 'idle') setState(IDLE_STATE);
    if (current) await release(current);
    // Let an in-flight run notice it is stale and release whatever it acquired meanwhile
    // (e.g. while the permission prompt was open). Callers that don't care may skip awaiting.
    await inflight;
  };

  return { start, stop, getState: () => state };
}

/** Dynamic import of TF.js + speech-commands, then build and load the recognizer. */
async function createRecognizer(modelUrl: string, metadataUrl: string) {
  const [speechCommands] = await Promise.all([
    import('@tensorflow-models/speech-commands'),
    // Side-effect import: registers the webgl/cpu backends that speech-commands needs.
    import('@tensorflow/tfjs'),
  ]);
  const recognizer = speechCommands.create('BROWSER_FFT', undefined, modelUrl, metadataUrl);
  await recognizer.ensureModelLoaded();
  return recognizer;
}
