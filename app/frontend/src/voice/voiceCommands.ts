// Barrel for the standalone voice-command module:
//   voiceCommandService.ts  framework-agnostic listener + pure decideFrame()
//   useVoiceCommands.ts     React hook (latest-handler refs, persisted on/off preference)
//   ../components/VoiceControl.tsx  ready-made UI (mic toggle, status, hints, optional debug panel)
// The TF.js model code is lazy-loaded on start(), so importing this barrel is cheap.
export * from './voiceCommandService';
export * from './useVoiceCommands';
