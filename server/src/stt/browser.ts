import { STTProvider } from './types';

// The zero-cost default: recognition happens entirely in the browser via the
// Web Speech API. The server is never in the audio path, so there is no session
// to open and no API key to configure. This keeps Jarvis fully working out of
// the box; the wake word also stays local and free in every mode.
export class BrowserSTTProvider implements STTProvider {
  readonly name = 'browser';
  readonly mode = 'browser' as const;
  // No createSession: the client streams no audio to us in browser mode.
}
