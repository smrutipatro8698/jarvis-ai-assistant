# Jarvis AI Assistant

## Coding Preferences

- Always add `console.log` statements for debugging in server-side code. Log at function entry with inputs, at key decision points, and on errors with context.
- Keep voice responses concise — all output is spoken aloud.
- Use plain English, avoid jargon.

## Project Structure

- `server/` — Node.js + Express + WebSocket backend with Claude API integration
- `client/` — React + Vite frontend with Web Speech API
- Tools live in `server/src/tools/`, each exporting a `definition` and `execute` function
- Register new tools in `server/src/tools/index.ts`

## Text-to-speech (swappable providers)

- TTS backends sit behind one `TTSProvider` interface in `server/src/tts/`.
  Switch engines with the `TTS_PROVIDER` env var — no other code changes.
  - `browser` (default): free, client speaks via the Web Speech API. No key.
  - `cartesia`: cheap, low-latency real voice. Needs `CARTESIA_API_KEY` + `CARTESIA_VOICE_ID`.
  - `elevenlabs`: premium characterful voice. Needs `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`).
- To add a provider: implement `TTSProvider` in `server/src/tts/<name>.ts` and
  register it in `server/src/tts/index.ts`. Cloud providers return base64 audio;
  the server streams it over WS as a `tts_audio` message and marks
  `assistant_complete` with `ttsMode: 'server'`.
- Client side: `client/src/hooks/useTextToSpeech.ts` plays server audio or falls
  back to browser speech. `isSpeaking` drives echo-mute + the follow-up window,
  so provider choice never touches the conversation logic.
- If synthesis fails, the server falls back to browser mode so Jarvis still talks.

## Roadmap

- STT is still the browser Web Speech API (`client/src/hooks/useSpeechRecognition.ts`).
  Next phase: a swappable STT layer (Soniox / AssemblyAI) with AudioWorklet mic
  capture streamed to the server, mirroring the TTS provider pattern.
