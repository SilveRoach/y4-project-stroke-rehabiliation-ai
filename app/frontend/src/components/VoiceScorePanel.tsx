import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { VoiceFrameOutcome, VoiceScoreFrame } from '../voice/voiceCommandService';

/**
 * Debug panel: live per-class scores, peaks, and a CSV-exportable log of frames that "smell like"
 * a command. Frames arrive ~6-7/s, so they are pushed through a ref and flushed to the screen on
 * a timer instead of going through parent state.
 */
export interface VoiceScorePanelHandle {
  push: (frame: VoiceScoreFrame) => void;
}

interface LogRow {
  t: number;
  frame: VoiceScoreFrame;
}

const REFRESH_MS = 150;
const LOG_MIN_COMMAND_SCORE = 0.3;
const MAX_LOG_ROWS = 1000;
const MAX_VISIBLE_ROWS = 30;

const OUTCOME_TH: Record<VoiceFrameOutcome, string> = {
  fired: 'สั่งแล้ว',
  confirming: 'รอยืนยันหลายเฟรม',
  cooldown: 'ช่วงกันยิงซ้ำ',
  'below-threshold': 'คะแนนไม่ถึงเกณฑ์',
  'not-command': 'ไม่ใช่คำสั่ง',
  'warming-up': 'กำลังอุ่นเครื่อง',
};

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const VoiceScorePanel = forwardRef<VoiceScorePanelHandle>(function VoiceScorePanel(_p, ref) {
  const latestRef = useRef<VoiceScoreFrame | null>(null);
  const peaksRef = useRef<Record<string, number>>({});
  const logRef = useRef<LogRow[]>([]);
  const startRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const [view, setView] = useState<{ latest: VoiceScoreFrame | null; peaks: Record<string, number>; rows: LogRow[] }>({
    latest: null,
    peaks: {},
    rows: [],
  });
  const [msg, setMsg] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    push: (frame) => {
      if (startRef.current === null) startRef.current = frame.timeMs;
      latestRef.current = frame;
      let maxCmd = 0;
      for (const s of frame.scores) {
        if (s.score > (peaksRef.current[s.label] ?? 0)) peaksRef.current[s.label] = s.score;
        if (s.isCommand && s.score > maxCmd) maxCmd = s.score;
      }
      if (maxCmd >= LOG_MIN_COMMAND_SCORE || frame.outcome === 'fired') {
        logRef.current.push({ t: (frame.timeMs - startRef.current) / 1000, frame });
        if (logRef.current.length > MAX_LOG_ROWS) logRef.current.shift();
      }
      dirtyRef.current = true;
    },
  }));

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setView({
        latest: latestRef.current,
        peaks: { ...peaksRef.current },
        rows: logRef.current.slice(-MAX_VISIBLE_ROWS).reverse(),
      });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const clear = () => {
    peaksRef.current = {};
    logRef.current = [];
    startRef.current = null;
    dirtyRef.current = true;
    setMsg(null);
  };

  const copyCsv = async () => {
    const rows = logRef.current;
    if (rows.length === 0) {
      setMsg('ยังไม่มีข้อมูล ลองพูดคำสั่งก่อน');
      return;
    }
    const labels = rows[0].frame.scores.map((s) => s.label);
    const header = ['time_s', 'outcome', 'top_label', 'top_score', 'threshold', ...labels].map(csvCell).join(',');
    const body = rows.map(({ t, frame }) =>
      [t.toFixed(2), frame.outcome, frame.topLabel, frame.topScore.toFixed(4), frame.threshold.toFixed(2),
        ...frame.scores.map((s) => s.score.toFixed(4))].map(csvCell).join(',')
    );
    try {
      await navigator.clipboard.writeText([header, ...body].join('\n'));
      setMsg(`คัดลอก CSV แล้ว ${rows.length} แถว`);
    } catch {
      setMsg('คัดลอกไม่สำเร็จ');
    }
  };

  const { latest, peaks, rows } = view;
  const threshold = latest?.threshold ?? 0.75;

  return (
    <div className="voice-debug">
      <div className="voice-debug-head">
        <strong>คะแนนคำสั่งเสียง (debug)</strong>
        <span className="voice-debug-spacer" />
        <button type="button" onClick={clear}>ล้าง</button>
        <button type="button" onClick={copyCsv}>คัดลอก CSV</button>
      </div>
      {!latest ? (
        <p className="voice-debug-muted">รอเสียงจากไมโครโฟน…</p>
      ) : (
        <>
          {latest.scores.map((s) => {
            const fillClass = !s.isCommand ? 'noise' : s.score >= threshold ? 'hit' : 'cmd';
            return (
              <div key={s.label} className={`voice-debug-row${s.label === latest.topLabel ? ' top' : ''}`}>
                <span className="voice-debug-label" title={s.label}>{s.label}</span>
                <div className="voice-debug-bar">
                  <div className={`voice-debug-fill ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, s.score * 100))}%` }} />
                  <div className="voice-debug-threshold" style={{ left: `${threshold * 100}%` }} />
                </div>
                <span className="voice-debug-num">{s.score.toFixed(2)}</span>
                <span className="voice-debug-peak">สูงสุด {(peaks[s.label] ?? 0).toFixed(2)}</span>
              </div>
            );
          })}
          <p className="voice-debug-muted">
            ล่าสุด: {latest.topLabel} ({latest.topScore.toFixed(2)}) - {OUTCOME_TH[latest.outcome]}
          </p>
        </>
      )}
      <div className="voice-debug-log">
        <table>
          <tbody>
            {rows.map(({ t, frame }, i) => (
              <tr key={`${frame.timeMs}-${i}`} className={frame.outcome === 'fired' ? 'fired' : ''}>
                <td>{t.toFixed(1)}s</td>
                <td>{frame.topLabel}</td>
                <td>{frame.topScore.toFixed(2)}</td>
                <td>{OUTCOME_TH[frame.outcome]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className="voice-debug-muted">{msg}</p>}
    </div>
  );
});
