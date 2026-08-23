// Speech-to-text provider abstraction (the input mirror of server/src/tts).
//
// Every STT backend implements this one interface so the rest of the app never
// knows or cares which recognizer is active. Swap providers by setting the
// STT_PROVIDER env var — no code changes anywhere else. This is the "start on
// free browser STT, A/B a cloud recognizer later" seam.
//
// Unlike TTS (a single request→response call), STT is a live stream: the client
// captures microphone PCM and streams it up; the provider streams partial and
// final transcripts back, plus a semantic "turn ended" signal that tells us the
// user finished speaking. So the contract here is a *session*, not one call.

export type STTMode = 'browser' | 'server';

export interface STTCallbacks {
  // Interim, still-changing transcript for live on-screen feedback.
  onPartial: (text: string) => void;
  // A finalized chunk of transcript (stable, won't change).
  onFinal: (text: string) => void;
  // The provider's semantic endpoint: the user finished their turn. `text` is
  // the best full transcript of the turn — this is what becomes the command.
  onTurnEnd: (text: string) => void;
  onError: (err: Error) => void;
}

export interface STTSession {
  // Feed a chunk of 16 kHz, mono, signed 16-bit little-endian PCM.
  pushAudio: (chunk: Buffer) => void;
  // Politely end the turn (flush + close). Safe to call more than once.
  stop: () => void;
}

export interface STTProvider {
  // Human-readable id for logs (e.g. 'soniox').
  readonly name: string;
  // 'browser' => the client does recognition locally with the Web Speech API
  // and never streams audio to us (zero cost, the default). 'server' => the
  // client streams PCM here and we proxy it to a cloud recognizer.
  readonly mode: STTMode;
  // Open a streaming recognition session. Only defined for server-mode
  // providers; browser mode returns undefined (the client handles everything).
  createSession?: (callbacks: STTCallbacks) => STTSession | Promise<STTSession>;
}
