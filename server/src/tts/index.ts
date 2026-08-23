import { TTSProvider } from './types';
import { BrowserTTSProvider } from './browser';
import { ElevenLabsTTSProvider } from './elevenlabs';
import { CartesiaTTSProvider } from './cartesia';

export type { TTSProvider, SynthesisResult, TTSMode } from './types';

// Pick the active TTS backend from the TTS_PROVIDER env var.
// Default is 'browser' (zero cost, no API key needed) so the app works out of
// the box. Set TTS_PROVIDER=elevenlabs or =cartesia to use a real voice.
let cached: TTSProvider | null = null;

export function getTTSProvider(): TTSProvider {
  if (cached) return cached;

  const choice = (process.env.TTS_PROVIDER || 'browser').trim().toLowerCase();
  console.log(`[TTS] Selected provider: ${choice}`);

  switch (choice) {
    case 'elevenlabs':
      cached = new ElevenLabsTTSProvider();
      break;
    case 'cartesia':
      cached = new CartesiaTTSProvider();
      break;
    case 'browser':
      cached = new BrowserTTSProvider();
      break;
    default:
      console.warn(`[TTS] Unknown TTS_PROVIDER "${choice}", falling back to browser`);
      cached = new BrowserTTSProvider();
  }
  return cached;
}
