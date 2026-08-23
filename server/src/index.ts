import './env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ConversationMessage } from './types';
import { processMessage } from './claude';
import { getTTSProvider } from './tts';
import { getSTTProvider, STTSession } from './stt';

const app = express();
const PORT = process.env.PORT || 3001;

// We stream the reply to the cloud TTS provider sentence-by-sentence as Claude
// writes it, instead of synthesizing the whole answer in one shot. Two wins:
//   1. Jarvis starts speaking almost immediately (first sentence, ~real time)
//      rather than after the entire paragraph is written and synthesized.
//   2. Long replies are read IN FULL and never fail — each chunk is small, so
//      we never hit a provider length cap or a single-request timeout (the two
//      things that were killing long answers before).
// Chunks are grouped to at least this many chars so we aren't firing a separate
// TTS request per tiny sentence (extra latency + per-request overhead).
const TTS_CHUNK_MIN_CHARS = parseInt(process.env.TTS_CHUNK_MIN_CHARS || '100', 10);

// Running total of characters sent to the cloud TTS this process, logged after
// every reply so per-character spend stays visible (Cartesia bills per char).
// Resets on restart — a visibility aid, not a hard budget.
let ttsCharsThisProcess = 0;

// Index just past the last sentence end (". "/"! "/"? "/newline/end-of-text) in
// `s`, or -1 if there's no complete sentence yet.
function lastSentenceBoundary(s: string): number {
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.' || c === '!' || c === '?' || c === '\n') {
      const next = s[i + 1];
      if (next === undefined || next === ' ' || next === '\n') idx = i + 1;
    }
  }
  return idx;
}

// Accumulates streamed text deltas and emits speakable chunks: at least `min`
// chars, cut at a sentence boundary so speech never breaks mid-sentence.
// flush() emits whatever's left (the final partial sentence).
function makeSentenceChunker(min: number, emit: (chunk: string) => void) {
  let buf = '';
  return {
    push(delta: string) {
      buf += delta;
      const b = lastSentenceBoundary(buf);
      if (b >= min) {
        const chunk = buf.slice(0, b).trim();
        buf = buf.slice(b);
        if (chunk) emit(chunk);
      }
    },
    flush() {
      const chunk = buf.trim();
      buf = '';
      if (chunk) emit(chunk);
    },
    // Discard buffered text without speaking it (used when a turn turns out to
    // be interim tool-use narration rather than the final answer).
    reset() {
      buf = '';
    },
  };
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    system: 'J.A.R.V.I.S.',
    version: '4.7.2',
    timestamp: new Date().toISOString(),
  });
});

// Tells the client which speech-to-text mode is active. In 'browser' mode the
// client recognizes speech locally with the Web Speech API and streams no audio
// to us; in 'server' mode it streams PCM here to a cloud recognizer. The client
// fetches this on load to decide how to capture the microphone.
app.get('/api/stt-config', (_req, res) => {
  const stt = getSTTProvider();
  res.json({ mode: stt.mode, provider: stt.name });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('[J.A.R.V.I.S.] New client connected');
  const conversationHistory: ConversationMessage[] = [];

  // Active cloud STT session (server mode only). Opened on stt_start, torn down
  // on stt_stop / turn end / disconnect. Null in browser mode.
  let sttSession: STTSession | null = null;

  const sendMessage = (type: string, data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  };

  const stopSttSession = () => {
    if (sttSession) {
      sttSession.stop();
      sttSession = null;
    }
  };

  const startSttSession = () => {
    const stt = getSTTProvider();
    if (stt.mode !== 'server' || !stt.createSession) {
      // Browser mode: nothing to do here, the client recognizes locally.
      return;
    }
    stopSttSession(); // never run two at once
    try {
      console.log(`[J.A.R.V.I.S.] Opening STT session (${stt.name})`);
      const maybe = stt.createSession({
        onPartial: (text) => sendMessage('stt_partial', { text }),
        onFinal: (text) => sendMessage('stt_final', { text }),
        onTurnEnd: (text) => {
          sendMessage('stt_turn_end', { text });
          // A turn is one command; close the socket so we don't bill silence.
          stopSttSession();
        },
        onError: (err) => {
          console.error('[J.A.R.V.I.S.] STT error:', err.message);
          sendMessage('stt_error', { message: err.message });
          stopSttSession();
        },
      });
      Promise.resolve(maybe)
        .then((session) => {
          sttSession = session;
        })
        .catch((err: any) => {
          console.error('[J.A.R.V.I.S.] Failed to open STT session:', err.message);
          sendMessage('stt_error', { message: err.message });
        });
    } catch (err: any) {
      console.error('[J.A.R.V.I.S.] Failed to open STT session:', err.message);
      sendMessage('stt_error', { message: err.message });
    }
  };

  ws.on('message', async (raw: Buffer, isBinary: boolean) => {
    // Binary frames are microphone PCM for the active cloud STT session.
    if (isBinary) {
      if (sttSession) sttSession.pushAudio(raw);
      return;
    }

    try {
      const message = JSON.parse(raw.toString());

      // ── Cloud STT control messages ─────────────────────────────────
      if (message.type === 'stt_start') {
        startSttSession();
        return;
      }
      if (message.type === 'stt_stop') {
        stopSttSession();
        return;
      }

      // ── Chat message ───────────────────────────────────────────────
      if (message.type !== 'user_message' || !message.data?.text) {
        sendMessage('error', { message: 'Invalid message format. Expected { type: "user_message", data: { text: string } }' });
        return;
      }

      // A new command means any in-flight capture is done.
      stopSttSession();

      const userText = message.data.text;
      sendMessage('status', { message: 'Processing your request...' });

      // Cloud TTS providers get the reply streamed to them sentence-by-sentence
      // as Claude writes it (see makeSentenceChunker): Jarvis starts speaking in
      // near-real-time and long answers are read in full without length/timeout
      // failures. 'browser' mode synthesizes nothing here — the client speaks
      // the full text locally once it arrives.
      const tts = getTTSProvider();
      const serverTTS = tts.producesAudio;
      let ttsMode: 'browser' | 'server' = 'browser';
      let sentAnyAudio = false;
      let charsThisReply = 0;

      // Synthesize chunks strictly in order (serial chain) so the audio the
      // client receives — and plays — is in the same order Claude wrote it.
      let synthChain: Promise<void> = Promise.resolve();
      const enqueueSynth = (chunk: string) => {
        charsThisReply += chunk.length;
        synthChain = synthChain.then(async () => {
          try {
            const result = await tts.synthesize(chunk);
            if (result.mode === 'server' && result.audioBase64) {
              sentAnyAudio = true;
              sendMessage('tts_audio', {
                audioBase64: result.audioBase64,
                mimeType: result.mimeType || 'audio/mpeg',
              });
            }
          } catch (ttsErr: any) {
            console.error(`[J.A.R.V.I.S.] TTS chunk failed (${tts.name}, ${chunk.length} chars):`, ttsErr?.message || ttsErr);
          }
        });
      };
      const chunker = serverTTS ? makeSentenceChunker(TTS_CHUNK_MIN_CHARS, enqueueSynth) : null;

      const { text } = await processMessage(
        userText,
        conversationHistory,
        (chunk) => {
          // On-screen transcript: every turn's text (including interim narration).
          sendMessage('assistant_chunk', { text: chunk });
        },
        (toolResult) => {
          sendMessage('tool_result', toolResult);
        },
        // Voice pipeline: only the FINAL answer is synthesized. Interim tool-use
        // narration is reset (dropped) before it ever reaches Cartesia.
        chunker
          ? { onDelta: (d) => chunker.push(d), onReset: () => chunker.reset() }
          : undefined
      );

      if (chunker) {
        chunker.flush();
        await synthChain; // let every chunk finish synthesizing + sending, in order
        if (sentAnyAudio) {
          ttsMode = 'server';
          ttsCharsThisProcess += charsThisReply;
          console.log(`[J.A.R.V.I.S.] TTS spoke ${charsThisReply} chars via ${tts.name} (session total: ${ttsCharsThisProcess})`);
        } else {
          // Nothing synthesized (all chunks failed, or empty reply) — let the
          // client speak the full text with the free browser voice as a fallback.
          console.warn(`[J.A.R.V.I.S.] No ${tts.name} audio produced — client will fall back to browser voice`);
        }
      }

      sendMessage('assistant_complete', { text, ttsMode });
    } catch (error: any) {
      console.error('[J.A.R.V.I.S.] Error:', error.message);
      sendMessage('error', { message: `I encountered an error: ${error.message}` });
    }
  });

  ws.on('close', () => {
    stopSttSession();
    console.log('[J.A.R.V.I.S.] Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('[J.A.R.V.I.S.] WebSocket error:', error.message);
    stopSttSession();
    sendMessage('error', { message: `WebSocket error: ${error.message}` });
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  J.A.R.V.I.S. server online');
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Health:    http://localhost:${PORT}/api/health`);
  // Eagerly resolve both providers at boot so the active STT/TTS config (and
  // any missing-key warnings) is visible right here in the banner — instead of
  // only appearing lazily on the first request. Their constructors log the
  // selected provider + settings.
  const stt = getSTTProvider();
  const tts = getTTSProvider();
  console.log(`  STT:       ${stt.name} (${stt.mode})`);
  console.log(`  TTS:       ${tts.name}`);
  console.log('='.repeat(50));
});
