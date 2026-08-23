import { TTSProvider, SynthesisResult } from './types';

// The zero-cost default: the server generates no audio and signals the client
// to speak the text itself using the browser's built-in Web Speech API.
// This keeps Jarvis fully working with no TTS API key.
export class BrowserTTSProvider implements TTSProvider {
  readonly name = 'browser';
  readonly producesAudio = false;

  async synthesize(text: string): Promise<SynthesisResult> {
    console.log('[TTS:browser] Deferring speech to client Web Speech API, chars:', text.length);
    return { mode: 'browser' };
  }
}
