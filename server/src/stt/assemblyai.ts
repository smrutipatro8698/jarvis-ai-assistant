import WebSocket from 'ws';
import { STTProvider, STTSession, STTCallbacks } from './types';

// AssemblyAI Universal-Streaming — the strong alternative to Soniox for a
// cloud recognizer bake-off. ~$0.15/hr streamed, very low latency, and a clean
// turn model: every message is a "Turn" with an `end_of_turn` flag, so the
// endpoint is explicit. Good English accuracy; run it against Soniox on your
// own voice and keep whichever wins on your accent.
//
// Protocol (WebSocket v3): connect with the API key in the Authorization
// header, stream raw PCM binary frames, receive JSON "Turn" messages. Send
// { type: 'Terminate' } to finish.
//
// Docs: https://www.assemblyai.com/docs/speech-to-text/universal-streaming
const AAI_WS_BASE = 'wss://streaming.assemblyai.com/v3/ws';

class AssemblyAISession implements STTSession {
  private ws: WebSocket;
  private cb: STTCallbacks;
  private ready = false;
  private pending: Buffer[] = [];
  private stopped = false;

  constructor(apiKey: string, cb: STTCallbacks) {
    this.cb = cb;
    const url = `${AAI_WS_BASE}?sample_rate=16000&encoding=pcm_s16le&format_turns=true`;
    console.log('[STT:assemblyai] Opening session');
    this.ws = new WebSocket(url, { headers: { Authorization: apiKey } });

    this.ws.on('open', () => {
      console.log('[STT:assemblyai] Socket open');
      this.ready = true;
      for (const chunk of this.pending) this.ws.send(chunk);
      this.pending = [];
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'Begin':
            console.log('[STT:assemblyai] Session begin:', msg.id);
            break;
          case 'Turn': {
            const transcript: string = (msg.transcript || '').trim();
            if (msg.end_of_turn) {
              console.log('[STT:assemblyai] End of turn:', JSON.stringify(transcript));
              if (transcript) this.cb.onFinal(transcript);
              this.cb.onTurnEnd(transcript);
            } else if (transcript) {
              this.cb.onPartial(transcript);
            }
            break;
          }
          case 'Termination':
            console.log('[STT:assemblyai] Terminated');
            break;
          default:
            break;
        }
      } catch (e) {
        console.error('[STT:assemblyai] Failed to parse message:', (e as Error).message);
      }
    });

    this.ws.on('error', (err: Error) => {
      console.error('[STT:assemblyai] Socket error:', err.message);
      this.cb.onError(err);
    });

    this.ws.on('close', (code: number) => {
      console.log('[STT:assemblyai] Socket closed:', code);
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
    console.log('[STT:assemblyai] Stopping session');
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
        this.ws.close();
      } else {
        this.ws.terminate();
      }
    } catch (_e) {
      /* ignore */
    }
  }
}

export class AssemblyAISTTProvider implements STTProvider {
  readonly name = 'assemblyai';
  readonly mode = 'server' as const;

  private apiKey: string;

  constructor() {
    this.apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
    if (!this.apiKey) {
      console.warn('[STT:assemblyai] ASSEMBLYAI_API_KEY is not set — recognition will fail');
    }
  }

  createSession(callbacks: STTCallbacks): STTSession {
    if (!this.apiKey) throw new Error('ASSEMBLYAI_API_KEY not configured');
    return new AssemblyAISession(this.apiKey, callbacks);
  }
}
