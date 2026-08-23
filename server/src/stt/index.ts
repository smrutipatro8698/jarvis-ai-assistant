import { STTProvider } from './types';
import { BrowserSTTProvider } from './browser';
import { SonioxSTTProvider } from './soniox';
import { AssemblyAISTTProvider } from './assemblyai';

export type { STTProvider, STTSession, STTCallbacks, STTMode } from './types';

// Pick the active STT backend from the STT_PROVIDER env var.
// Default is 'browser' (zero cost, no API key, recognition runs in the client
// via the Web Speech API) so the app works out of the box. Set
// STT_PROVIDER=soniox or =assemblyai to stream to a cloud recognizer.
let cached: STTProvider | null = null;

export function getSTTProvider(): STTProvider {
  if (cached) return cached;

  const choice = (process.env.STT_PROVIDER || 'browser').trim().toLowerCase();
  console.log(`[STT] Selected provider: ${choice}`);

  switch (choice) {
    case 'soniox':
      cached = new SonioxSTTProvider();
      break;
    case 'assemblyai':
      cached = new AssemblyAISTTProvider();
      break;
    case 'browser':
      cached = new BrowserSTTProvider();
      break;
    default:
      console.warn(`[STT] Unknown STT_PROVIDER "${choice}", falling back to browser`);
      cached = new BrowserSTTProvider();
  }
  return cached;
}
