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
  register it in `server/src/tts/index.ts`. Cloud providers return base64 audio.
- Streaming synthesis (cloud modes): the server (`server/src/index.ts`) breaks
  the reply into sentence-sized chunks AS Claude streams it (`makeSentenceChunker`,
  min size `TTS_CHUNK_MIN_CHARS`, default 100), synthesizes each chunk serially,
  and sends each as its own `tts_audio` WS message. So Jarvis starts speaking in
  near-real-time and long answers are read in FULL (no length cap / timeout — each
  chunk is small). `assistant_complete` carries `ttsMode: 'server'` once any audio
  was sent. Cloud TTS bills per character, so the server logs the running
  character total after each reply for cost visibility.
- Client side: `client/src/hooks/useTextToSpeech.ts` queues the incoming audio
  chunks and plays them in order (`enqueueServerAudio`), staying `isSpeaking` true
  across the gaps between chunks until the server signals the reply is done
  (`endServerStream`, fired from `assistant_complete`). `isSpeaking` drives
  echo-mute + the follow-up window, so provider choice never touches the
  conversation logic. Browser mode still speaks the full text locally.
- If every chunk fails to synthesize, the server sends `ttsMode: 'browser'` so the
  client speaks the full text with the free browser voice as a fallback.

## Speech-to-text (swappable providers)

- STT backends sit behind one `STTProvider` interface in `server/src/stt/`.
  Switch recognizers with the `STT_PROVIDER` env var — no other code changes.
  - `browser` (default): free, recognition runs in the client via the Web
    Speech API. No key, no audio leaves the browser.
  - `soniox`: best-value cloud recognizer, strong on accented English. Needs
    `SONIOX_API_KEY` (+ optional `SONIOX_MODEL`).
  - `assemblyai`: cloud recognizer with an explicit turn model. Needs
    `ASSEMBLYAI_API_KEY`. Pins the `universal-3-5-pro` flagship (strong on
    accented English) via the v3 streaming WebSocket; `mode` (min_latency /
    balanced / max_accuracy) is the primary tuning knob. Optional overrides:
    `ASSEMBLYAI_MODEL`, `ASSEMBLYAI_MODE`, `ASSEMBLYAI_PROMPT`. The server holds
    the key and opens the provider socket, so it never reaches the browser.
- The wake word ("Hey Jarvis") is ALWAYS detected locally by the Web Speech API,
  in every mode — it's free and instant. In server mode, only the COMMAND is
  streamed to the cloud recognizer, and only while a command window is open, so
  we never bill silence.
- Audio path (server mode): the client captures the mic, an AudioWorklet
  (`client/public/pcm-worklet.js`) resamples it to 16 kHz PCM16, and
  `client/src/audio/cloudCapture.ts` streams frames over the WebSocket as binary.
  The server (`server/src/index.ts`) proxies them to the provider's streaming
  socket and sends transcripts back as `stt_partial` / `stt_turn_end` messages.
  The client learns which mode is active from `GET /api/stt-config`.
- To add a provider: implement `STTProvider` in `server/src/stt/<name>.ts` and
  register it in `server/src/stt/index.ts`. Cloud providers implement a
  streaming `createSession`; browser mode has none.
- If a cloud session errors, the speech hook returns to wake-word listening so
  Jarvis stays usable.

## Roadmap

- Both the voice (TTS) and the ears (STT) are now swappable behind one env var
  each, defaulting to the free browser engines. Streaming TTS (speak each
  sentence as Claude writes it) is done. Possible next steps: a local wake-word
  engine (e.g. Porcupine) to drop the Web Speech dependency entirely; a hard
  per-period TTS spend budget with browser-voice fallback; cloud hosting for an
  always-on backend.
