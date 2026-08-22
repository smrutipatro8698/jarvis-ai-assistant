import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    let raw = fs.readFileSync(envPath, 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    console.log(`[J.A.R.V.I.S.] Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  }
}
if (!envLoaded) {
  dotenv.config();
  console.log('[J.A.R.V.I.S.] No .env file found, using dotenv default');
}

if (process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY.trim();
  console.log(`[J.A.R.V.I.S.] API key loaded (${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...)`);
} else {
  console.error('[J.A.R.V.I.S.] WARNING: ANTHROPIC_API_KEY not found! Set it in .env or as environment variable.');
}

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ConversationMessage } from './types';
import { processMessage } from './claude';

const app = express();
const PORT = process.env.PORT || 3001;

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

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('[J.A.R.V.I.S.] New client connected');
  const conversationHistory: ConversationMessage[] = [];

  const sendMessage = (type: string, data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  };

  ws.on('message', async (raw: Buffer) => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type !== 'user_message' || !message.data?.text) {
        sendMessage('error', { message: 'Invalid message format. Expected { type: "user_message", data: { text: string } }' });
        return;
      }

      const userText = message.data.text;
      sendMessage('status', { message: 'Processing your request...' });

      const { text, toolResults } = await processMessage(
        userText,
        conversationHistory,
        (chunk) => {
          sendMessage('assistant_chunk', { text: chunk });
        },
        (toolResult) => {
          sendMessage('tool_result', toolResult);
        }
      );

      sendMessage('assistant_complete', { text });
    } catch (error: any) {
      console.error('[J.A.R.V.I.S.] Error:', error.message);
      sendMessage('error', { message: `I encountered an error: ${error.message}` });
    }
  });

  ws.on('close', () => {
    console.log('[J.A.R.V.I.S.] Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('[J.A.R.V.I.S.] WebSocket error:', error.message);
    sendMessage('error', { message: `WebSocket error: ${error.message}` });
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  J.A.R.V.I.S. server online');
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Health:    http://localhost:${PORT}/api/health`);
  console.log('='.repeat(50));
});
