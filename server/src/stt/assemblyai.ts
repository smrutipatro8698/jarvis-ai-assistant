import WebSocket from 'ws';
import { STTProvider, STTSession, STTCallbacks } from './types';

// AssemblyAI Universal-Streaming (v3) — our cloud recognizer. Low latency and a
// clean turn model: every message is a "Turn" with an `end_of_turn` flag, so
// the command endpoint is explicit.
//
// We pin speech_model=universal-3-5-pro, the current flagship. It transcribes
// 18 languages natively with code-switching and is strong on accented English —
// which is the whole reason we route the command to the cloud. `mode` (the
// primary latency/accuracy knob: min_latency | balanced | max_accuracy) sets
// sensible turn-detection defaults, so we don't hand-tune silence bounds.
//
// Protocol: connect with the raw API key in the Authorization header (NO
// `Bearer` prefix — that's Voice-Agent-only), stream raw PCM16 16 kHz mono
// binary frames of 50–1000 ms each (our worklet sends ~64 ms), receive JSON
// "Turn" messages, and send { type: 'Terminate' } to finish (an abandoned
// session bills until the 3-hour cap). Note: `format_turns` is NOT a U3.5-Pro
// knob — formatting always tracks `end_of_turn` — so we don't send it.
//
// This runs server-side, so the key stays here and never reaches the browser
// (no temp-token minting needed — that's only for browser-direct connections).
//
// Docs: https://www.assemblyai.com/docs/streaming/select-the-speech-model
const AAI_WS_BASE = 'wss://streaming.assemblyai.com/v3/ws';

// WebSocket close codes worth naming in the logs (see docs §14).
const CLOSE_CODES: Record<number, string> = {
  1008: 'unauthorized — check ASSEMBLYAI_API_KEY (no "Bearer" prefix)',
  3005: 'session cancelled (server-side error)',
  3006: 'invalid message / JSON',
  3007: 'audio chunk outside 50–1000 ms or faster than real-time',
  3008: 'session expired (3-hour cap)',
  3009: 'too many concurrent sessions',
};

class AssemblyAISession implements STTSession {
  private ws: WebSocket;
  private cb: STTCallbacks;
  private ready = false;
  private pending: Buffer[] = [];
  private stopped = false;

  constructor(apiKey: string, cb: STTCallbacks, opts: { model: string; mode: string; prompt: string }) {
    this.cb = cb;
    const params = new URLSearchParams({
      sample_rate: '16000',
      encoding: 'pcm_s16le',
      speech_model: opts.model,
      mode: opts.mode,
    });
    // Optional natural-language steering (domain/scenario/names). Skipped unless
    // ASSEMBLYAI_PROMPT is set, so the default stays clean.
    if (opts.prompt) params.set('prompt', opts.prompt);
    const url = `${AAI_WS_BASE}?${params.toString()}`;
    console.log(`[STT:assemblyai] Opening session model=${opts.model} mode=${opts.mode}${opts.prompt ? ' (prompt set)' : ''}`);
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
      const reason = CLOSE_CODES[code];
      console.log(`[STT:assemblyai] Socket closed: ${code}${reason ? ' — ' + reason : ''}`);
      // A close we didn't initiate (bad key, expired/oversized session, etc.)
      // is an error — surface it so the client falls back to wake-word listening
      // instead of silently hanging on a dead session.
      if (!this.stopped) {
        this.stopped = true;
        this.cb.onError(new Error(`AssemblyAI closed session (${code}${reason ? ': ' + reason : ''})`));
      }
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
  private model: string;
  private latencyMode: string;
  private prompt: string;

  constructor() {
    this.apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
    // universal-3-5-pro is the current flagship; balanced is the recommended
    // default latency/accuracy preset. Both overridable if you want to tune.
    this.model = (process.env.ASSEMBLYAI_MODEL || 'universal-3-5-pro').trim();
    this.latencyMode = (process.env.ASSEMBLYAI_MODE || 'balanced').trim();
    this.prompt = (process.env.ASSEMBLYAI_PROMPT || '').trim();
    if (!this.apiKey) {
      console.warn('[STT:assemblyai] ASSEMBLYAI_API_KEY is not set — recognition will fail');
    }
    console.log(`[STT:assemblyai] Configured model=${this.model} mode=${this.latencyMode}`);
  }

  createSession(callbacks: STTCallbacks): STTSession {
    if (!this.apiKey) throw new Error('ASSEMBLYAI_API_KEY not configured');
    return new AssemblyAISession(this.apiKey, callbacks, {
      model: this.model,
      mode: this.latencyMode,
      prompt: this.prompt,
    });
  }
}
