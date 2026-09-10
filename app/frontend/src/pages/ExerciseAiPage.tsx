import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Dumbbell, Flag, Plus } from "lucide-react";
import { useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";

interface ExerciseAiPageProps {
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

const videos = [
  ["Correct / Good movement", "2 videos", "elbow-extension-correct-01.mp4", "elbow-extension-correct-02.mp4"],
  ["Incorrect / Bad movement", "2 videos", "elbow-extension-low-rom.mp4", "elbow-extension-trunk-lean.mp4"]
];

export function ExerciseAiPage({ onBack, onLogout, onNavigate }: ExerciseAiPageProps) {
  const { user } = useAuth();
  const [testStarted, setTestStarted] = useState(false);
  const [debug, setDebug] = useState(true);
  const [joints, setJoints] = useState(["Shoulder", "Elbow", "Wrist"]);
  const displayName = user?.displayName || user?.username || "Therapist";

  return (
    <section className="therapist-shell exercise-creation-page">
      <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />
      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div className="creation-topbar-title"><Dumbbell size={18} /><div><strong>AI exercise workspace</strong><span>Configure reference movement and scoring rules</span></div></div>
          <div className="therapist-topbar-profile"><div><strong>{displayName}</strong><small>Physical Therapist</small></div><span className="avatar-badge">{initialsFromName(displayName)}</span></div>
        </header>
        <main className="therapist-main exercise-creation-main ai-workspace-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}><ArrowLeft size={14} /> Back to exercise</button>
          <div className="ai-workspace-heading"><div><h1>AI configuration</h1><p>Elbow Extension · Mock configuration workspace</p></div><span className="mock-badge">UI mockup only</span></div>

          <section className="creation-section-card">
            <div className="creation-section-header"><Dumbbell size={20} /><div><strong>Reference movement dataset</strong><p className="library-card-sub">Use example videos to describe correct and incorrect movement patterns.</p></div></div>
            <div className="dataset-grid">{videos.map(([title, count, first, second], index) => <div className="dataset-panel" key={title}><div className="dataset-panel-heading"><strong>{title}</strong><span>{count}</span></div>{[first, second].map((file) => <div className="dataset-video-card" key={file}><span className={`dataset-thumbnail ${index ? "bad-thumbnail" : ""}`}>▶</span><span><strong>{file}</strong><small>Mock video · 0:24</small>{index === 1 && <select className="dataset-reason" defaultValue="Insufficient ROM"><option>Insufficient ROM</option><option>Excessive ROM</option><option>Trunk compensation</option><option>Incorrect limb movement</option><option>Other</option></select>}</span><button type="button" className="text-action danger">Remove</button></div>)}<button type="button" className="secondary-button dataset-add-button"><Plus size={14} /> Add video</button></div>)}</div>
          </section>

          <section className="creation-section-card ai-checkpoint-section">
            <div className="creation-section-header"><Flag size={20} /><div><strong>Demo checkpoints &amp; target ROM</strong><p className="library-card-sub">Set the movement phases and range target used by the AI rules.</p></div></div>
            <div className="ai-checkpoint-grid">
              {["Start position", "Peak of movement", "Return to start"].map((checkpoint, index) => <div className="ai-checkpoint-card" key={checkpoint}><span className="ai-checkpoint-number">{index + 1}</span><div><strong>{checkpoint}</strong><small>{index === 0 ? "Frame 1 · 0.00s" : index === 1 ? "Frame 136 · 4.50s" : "Frame 271 · 9.00s"}</small></div><CheckCircle2 size={16} /></div>)}
            </div>
            <div className="ai-rom-control"><div><strong>Target range of motion</strong><p className="library-card-sub">Patient must reach this angle for full ROM accuracy.</p></div><strong className="rom-slider-value">120°</strong></div>
            <input type="range" min={0} max={180} defaultValue={120} style={{ width: "100%" }} aria-label="Target range of motion" />
            <div className="rom-control-labels"><span>Lenient</span><span>Strict</span></div>
          </section>

          <section className="creation-section-card">
            <div className="creation-section-header"><Flag size={20} /><div><strong>Movement rules</strong><p className="library-card-sub">Define the angle boundaries used for AI feedback.</p></div></div>
            <div className="rule-list">{joints.map((joint) => <div className="rule-row" key={joint}><strong>{joint}</strong><label>Min<input type="number" defaultValue={20} /></label><label>Max<input type="number" defaultValue={160} /></label></div>)}</div>
            <button type="button" className="secondary-button" onClick={() => setJoints((items) => [...items, `Joint ${items.length + 1}`])}><Plus size={14} /> Add Joint</button>
            <div className="trunk-rules"><strong>Trunk rules</strong>{["Forward / backward lean", "Lateral lean", "Rotation"].map((rule) => <div className="rule-row" key={rule}><span>{rule}</span><label>Min<input type="number" defaultValue={-10} /></label><label>Max<input type="number" defaultValue={10} /></label></div>)}</div>
          </section>

          <section className="creation-section-card">
            <div className="creation-section-header"><Camera size={20} /><div><strong>Therapist testing & scoring</strong><p className="library-card-sub">Preview the authored AI rules with simulated tracking data.</p></div></div>
            <div className="testing-grid"><div className="testing-preview"><span className="testing-skeleton">◎<br />╱│╲<br />╱ ╲</span><span className="testing-checkpoint">Peak of movement</span></div><div className="testing-metrics"><span>Current joint angles <strong>Shoulder 84° · Elbow 142°</strong></span><span>Trunk angle <strong>6°</strong></span><span>Repetition count <strong>4 / 10</strong></span><span>Current score <strong className="score-good">87</strong></span><p className="testing-warning"><AlertTriangle size={14} /> Keep your trunk upright</p></div></div>
            <div className="testing-actions"><button type="button" className="primary-button" onClick={() => setTestStarted(!testStarted)}>{testStarted ? "Stop Test" : "Start Test"}</button><label className="debug-toggle"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Debug Mode</label></div>
            {debug && <div className="debug-options"><label><input type="checkbox" defaultChecked /> Show skeleton</label><label><input type="checkbox" defaultChecked /> Show joint angles</label><label><input type="checkbox" defaultChecked /> Show checkpoints</label><label><input type="checkbox" /> Show scoring zones</label></div>}
          </section>

          <section className="creation-section-card">
            <div className="creation-section-header"><CheckCircle2 size={20} /><div><strong>Difficulty &amp; scoring</strong><p className="library-card-sub">Hard mode applies stronger penalties for movement deviation.</p></div></div>
            <div className="difficulty-grid">{[["Easy", "12°", "Low"], ["Medium", "8°", "Medium"], ["Hard", "4°", "High"]].map(([level, tolerance, penalty]) => <div className={`difficulty-card difficulty-${level.toLowerCase()}`} key={level}><div><strong>{level}</strong><span>{penalty} penalty</span></div><p>ROM tolerance <b>{tolerance}</b></p><p>Trunk tolerance <b>{tolerance}</b></p><p>Start position <b>{tolerance}</b></p></div>)}</div>
          </section>
        </main>
      </div>
    </section>
  );
}
