import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, ChevronDown, ChevronUp } from 'lucide-react';
import {
  VOICE_COMMAND_WORDS,
  useVoiceCommands,
  type VoiceCommand,
  type VoiceErrorReason,
} from '../voice/voiceCommands';
import { VoiceScorePanel, type VoiceScorePanelHandle } from './VoiceScorePanel';

export interface VoiceControlProps {
  /** Master gate; false releases the microphone. Default true. */
  enabled?: boolean;
  /** Command callbacks (latest ones are always used). */
  handlers: Partial<Record<VoiceCommand, () => void>>;
  /** Smaller layout (icon button + short status) for tight overlays. */
  compact?: boolean;
  /** Show a collapsible debug score panel. Default false. */
  showDebug?: boolean;
}

const HINT: Record<VoiceCommand, string> = {
  start: 'เริ่มฝึก',
  pause: 'หยุดชั่วคราว',
  continue: 'ฝึกต่อ',
  stop: 'ยกเลิกเซสชัน',
};

const ERROR_TEXT: Record<VoiceErrorReason, string> = {
  'no-model': 'ไม่พบโมเดลเสียง',
  'mic-denied': 'ไม่ได้รับสิทธิ์ไมค์',
  'insecure-context': 'ต้องใช้ HTTPS',
  unsupported: 'อุปกรณ์ไม่รองรับไมค์',
  unknown: 'คำสั่งเสียงใช้งานไม่ได้',
};

/** Self-contained voice-command toggle + status + hints. Page buttons must keep working regardless. */
export default function VoiceControl({ enabled = true, handlers, compact = false, showDebug = false }: VoiceControlProps) {
  const panelRef = useRef<VoiceScorePanelHandle>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [flash, setFlash] = useState<VoiceCommand | null>(null);

  const voice = useVoiceCommands({
    enabled,
    handlers,
    onScores: showDebug ? (f) => panelRef.current?.push(f) : undefined,
  });

  // Brief flash of the last recognized command.
  useEffect(() => {
    if (!voice.lastCommand) return;
    setFlash(voice.lastCommand.command);
    const id = window.setTimeout(() => setFlash(null), 1500);
    return () => window.clearTimeout(id);
  }, [voice.lastCommand]);

  const on = voice.status === 'listening' || voice.status === 'loading';
  let statusText = '';
  if (voice.status === 'loading') statusText = 'กำลังโหลด…';
  else if (voice.status === 'listening') statusText = 'กำลังฟัง…';
  else if (voice.status === 'error') statusText = ERROR_TEXT[voice.error ?? 'unknown'];

  const label = on ? 'ปิดคำสั่งเสียง' : 'เปิดคำสั่งเสียง';

  return (
    <div className={`voice-control${compact ? ' compact' : ''}${voice.status === 'error' ? ' has-error' : ''}`}>
      <div className="voice-control-row">
        <button
          type="button"
          className={`voice-control-btn${voice.status === 'listening' ? ' listening' : ''}`}
          onClick={voice.toggle}
          aria-pressed={on}
          aria-label={label}
          title={label}
        >
          {on ? <Mic size={18} /> : <MicOff size={18} />}
          {!compact && <span>{label}</span>}
        </button>
        <span className="voice-control-status" role="status" aria-live="polite">
          {flash ? <strong className="voice-control-flash">"{VOICE_COMMAND_WORDS[flash]}"</strong> : statusText}
        </span>
        {showDebug && (
          <button
            type="button"
            className="voice-control-debug-toggle"
            onClick={() => setDebugOpen((v) => !v)}
            aria-expanded={debugOpen}
            aria-label="แสดง/ซ่อนคะแนนเสียง"
          >
            {debugOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>
      {!compact && voice.status === 'listening' && (
        <p className="voice-control-hint">
          {(Object.keys(VOICE_COMMAND_WORDS) as VoiceCommand[]).map((c) => (
            <span key={c}><b>"{VOICE_COMMAND_WORDS[c]}"</b> {HINT[c]}</span>
          ))}
        </p>
      )}
      {showDebug && debugOpen && <VoiceScorePanel ref={panelRef} />}
    </div>
  );
}

export { VoiceControl };
