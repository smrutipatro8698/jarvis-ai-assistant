// Text-to-speech provider abstraction.
//
// Every TTS backend (browser Web Speech, ElevenLabs, Cartesia, ...) implements
// this one interface so the rest of the app never knows or cares which voice
// engine is active. Swap providers by setting the TTS_PROVIDER env var — no
// code changes anywhere else. This is the "start cheap, A/B ElevenLabs later"
// seam.

export type TTSMode = 'browser' | 'server';

export interface SynthesisResult {
  // 'browser' => no audio bytes; the client speaks the text itself via the
  // Web Speech API (zero cost, the default).
  // 'server'  => audioBase64 holds synthesized audio the client plays back.
  mode: TTSMode;
  audioBase64?: string;
  // MIME type of the audio, e.g. 'audio/mpeg'. Required when mode === 'server'.
  mimeType?: string;
}

export interface TTSProvider {
  // Human-readable id for logs (e.g. 'elevenlabs').
  readonly name: string;
  // Whether this provider produces server-side audio. false => browser mode.
  readonly producesAudio: boolean;
  // Turn text into speech. Providers that produce audio return base64 audio;
  // the browser provider returns { mode: 'browser' } with no bytes.
  synthesize(text: string): Promise<SynthesisResult>;
}
