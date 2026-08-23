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

// Longest reply we send to a cloud TTS engine. Long text is the main cause of
// synthesis failures (provider length caps, or non-streaming generation blowing
// past the request timeout) — and a multi-minute spoken monologue is poor UX for
// a voice assistant anyway. We speak a concise version and still show the FULL
// answer on screen. Tune or disable (0 = no cap) with TTS_MAX_CHARS.
const TTS_MAX_CHARS = parseInt(process.env.TTS_MAX_CHARS || '700', 10);

// Trim text to at most `max` chars, preferring the last sentence end so speech
// never cuts off mid-word. Returns the whole string when it's already short
// enough or the cap is disabled.
function trimForSpeech(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  if (sentenceEnd > max * 0.5) return text.slice(0, sentenceEnd + 1).trim();
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > 0 ? text.slice(0, wordEnd) : slice).trim();
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

      const { text } = await processMessage(
        userText,
        conversationHistory,
        (chunk) => {
          sendMessage('assistant_chunk', { text: chunk });
        },
        (toolResult) => {
          sendMessage('tool_result', toolResult);
        }
      );

      // Synthesize the reply through whichever TTS provider is configured.
      // 'browser' mode returns no audio and the client speaks it locally;
      // cloud providers return audio the client plays back. If synthesis
      // fails, fall back to browser mode so Jarvis still talks.
      const tts = getTTSProvider();
      let ttsMode: 'browser' | 'server' = 'browser';
      // Speak a concise version; the full `text` still goes to the screen below.
      const spokenText = trimForSpeech(text, TTS_MAX_CHARS);
      if (spokenText.length < text.length) {
        console.log(`[J.A.R.V.I.S.] Trimmed spoken text for TTS: ${text.length} -> ${spokenText.length} chars (full reply still shown on screen)`);
      }
      try {
        const result = await tts.synthesize(spokenText);
        ttsMode = result.mode;
        if (result.mode === 'server' && result.audioBase64) {
          console.log(`[J.A.R.V.I.S.] Sending server TTS audio (${tts.name}), base64 len: ${result.audioBase64.length}`);
          sendMessage('tts_audio', {
            audioBase64: result.audioBase64,
            mimeType: result.mimeType || 'audio/mpeg',
          });
        }
      } catch (ttsErr: any) {
        console.error(`[J.A.R.V.I.S.] TTS synthesis failed (${tts.name}, ${spokenText.length} chars), falling back to browser voice:`, ttsErr?.message || ttsErr);
        ttsMode = 'browser';
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
