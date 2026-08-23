import WebSocket from 'ws';
import { STTProvider, STTSession, STTCallbacks } from './types';

// Soniox real-time STT — the best value for money for this use case: strong
// accuracy on accented English (incl. Indian English), built-in semantic
// endpoint detection, and ~$0.12/hr of streamed audio. Because we only open
// the socket during a command window (never during idle/wake), we pay for
// seconds of speech, not hours of silence.
//
// Protocol (WebSocket): send one JSON config frame first, then raw PCM binary
// frames. The server streams back JSON { tokens: [...] }. Each token has a
// `text` and `is_final`; endpoint detection surfaces a special "<end>" token
// when the speaker's turn is complete.
//
// Docs: https://soniox.com/docs/speech-to-text/api-reference/websocket-api
const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

class SonioxSession implements STTSession {
  private ws: WebSocket;
  private cb: STTCallbacks;
  private ready = false;
  private pending: Buffer[] = [];
  private finalText = '';
  private interimText = '';
  private stopped = false;

  constructor(apiKey: string, model: string, cb: STTCallbacks) {
    this.cb = cb;
    console.log('[STT:soniox] Opening session, model:', model);
    this.ws = new WebSocket(SONIOX_WS_URL);

    this.ws.on('open', () => {
      console.log('[STT:soniox] Socket open, sending config');
      this.ws.send(
        JSON.stringify({
          api_key: apiKey,
          model,
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          enable_endpoint_detection: true,
          language_hints: ['en'],
        })
      );
      this.ready = true;
      // Flush any audio that arrived before the socket finished opening.
      for (const chunk of this.pending) this.ws.send(chunk);
      this.pending = [];
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.error_code || msg.error_message) {
          console.error('[STT:soniox] API error:', msg.error_code, msg.error_message);
          this.cb.onError(new Error(`Soniox ${msg.error_code}: ${msg.error_message}`));
          return;
        }
        const tokens: Array<{ text?: string; is_final?: boolean }> = msg.tokens || [];
        let sawEndpoint = false;
        let newInterim = '';
        for (const tok of tokens) {
          const text = tok.text ?? '';
          // Soniox marks the end of a turn with an "<end>"/"<fin>" control token.
          if (text === '<end>' || text === '<fin>' || text === '</end>') {
            sawEndpoint = true;
            continue;
          }
          if (tok.is_final) {
            this.finalText = (this.finalText + text).replace(/\s+/g, ' ');
            this.cb.onFinal(this.finalText.trim());
          } else {
            newInterim += text;
          }
        }
        this.interimText = newInterim;
        const live = (this.finalText + ' ' + this.interimText).replace(/\s+/g, ' ').trim();
        if (live) this.cb.onPartial(live);

        if (sawEndpoint) {
          const turn = live || this.finalText.trim();
          console.log('[STT:soniox] Endpoint — turn:', JSON.stringify(turn));
          this.cb.onTurnEnd(turn);
          this.finalText = '';
          this.interimText = '';
        }
      } catch (e) {
        console.error('[STT:soniox] Failed to parse message:', (e as Error).message);
      }
    });

    this.ws.on('error', (err: Error) => {
      console.error('[STT:soniox] Socket error:', err.message);
      this.cb.onError(err);
    });

    this.ws.on('close', (code: number) => {
      console.log('[STT:soniox] Socket closed:', code);
    });
  }

  pushAudio(chunk: Buffer): void {
    if (this.stopped) return;
    if (this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    } else {
      this.pending.push(chunk);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    console.log('[STT:soniox] Stopping session');
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        // Empty string signals end-of-stream to Soniox; then close.
        this.ws.send('');
        this.ws.close();
      } else {
        this.ws.terminate();
      }
    } catch (_e) {
      /* ignore */
    }
  }
}

export class SonioxSTTProvider implements STTProvider {
  readonly name = 'soniox';
  readonly mode = 'server' as const;

  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = (process.env.SONIOX_API_KEY || '').trim();
    this.model = (process.env.SONIOX_MODEL || 'stt-rt-preview').trim();
    if (!this.apiKey) {
      console.warn('[STT:soniox] SONIOX_API_KEY is not set — recognition will fail');
    }
    console.log(`[STT:soniox] Configured model=${this.model}`);
  }

  createSession(callbacks: STTCallbacks): STTSession {
    if (!this.apiKey) throw new Error('SONIOX_API_KEY not configured');
    return new SonioxSession(this.apiKey, this.model, callbacks);
  }
}
