# Voice command model (Teachable Machine)

Files here (`model.json`, `metadata.json`, `weights.bin`) are served statically by Vite and loaded
on demand by `src/voice/voiceCommandService.ts` from `${BASE_URL}voice-model/`. Everything runs
on-device; no audio is uploaded. Classes: `ทำต่อ`, `พัก`, `ยกเลิก`, `เริ่ม` and a background-noise
class (`เสียงรบกวนในเบื้องหลัง`). The noise class is filtered in our own code, not by the library.

## Retrain / replace the model

1. Open https://teachablemachine.withgoogle.com/train/audio and create an **Audio Project**.
2. Record 20 s or more of silence/ambient sound in the built-in **Background Noise** class.
3. Add 4 classes named exactly `เริ่ม`, `พัก`, `ทำต่อ`, `ยกเลิก` (spelling must match
   `DEFAULT_LABEL_MAP` in `voiceCommandService.ts`; otherwise pass a custom `labelMap`).
4. Record 20-30 short samples per word, varying speakers, distance and tone, ideally with
   realistic room noise. Keep each word a single short utterance.
5. **Train Model**, check the Preview, then **Export Model -> Tensorflow.js -> Download**.
6. Overwrite the three files in this folder and reload. No code change is needed.

Tuning (no retraining): `probabilityThreshold`, per-command `thresholds` (e.g. `{ stop: 0.9 }`),
`confirmFrames`, `cooldownMs`, `warmupMs` via `useVoiceCommands({ listenerOptions })`.
Use `<VoiceControl showDebug />` to see live scores and copy a CSV of frames.

## Use in a page

```tsx
import VoiceControl from '../components/VoiceControl';

<VoiceControl
  enabled={sessionActive}            // false releases the microphone
  handlers={{
    start: onStart,
    pause: onPause,
    continue: onResume,
    stop: onStop,
  }}
  compact                            // optional: icon-only button
  showDebug={false}                  // optional: collapsible score panel
/>
```

Handlers may be plain inline functions; the latest ones are always called. The on/off choice is
remembered in `localStorage` (`voiceCommands.enabled`). The microphone only starts after the user
toggles it on once (needs HTTPS or localhost). For custom UI use the hook
`useVoiceCommands({ enabled, handlers })` -> `{ status, error, lastCommand, lastScores, start, stop, toggle }`.
