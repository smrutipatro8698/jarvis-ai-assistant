import { useState, useRef, useCallback, useEffect } from 'react';

interface WebSocketMessage {
  type: string;
  data: any;
}

type CallbackFn<T> = (value: T) => void;

export interface CompletePayload {
  text: string;
  // 'browser' => client speaks the text via Web Speech; 'server' => audio was
  // already streamed via onAudio and the client just plays that.
  ttsMode: 'browser' | 'server';
}

export interface AudioPayload {
  audioBase64: string;
  mimeType: string;
}

export interface UseWebSocketReturn {
  sendMessage: (text: string) => void;
  isConnected: boolean;
  onChunk: (callback: CallbackFn<string>) => void;
  onComplete: (callback: CallbackFn<CompletePayload>) => void;
  onAudio: (callback: CallbackFn<AudioPayload>) => void;
  onToolResult: (callback: CallbackFn<unknown>) => void;
  onError: (callback: CallbackFn<string>) => void;
  // ── Cloud STT transport (server STT mode only) ──────────────────────
  /** Ask the server to open a cloud recognition session for this turn. */
  sttStart: () => void;
  /** Tell the server the turn is over; it flushes + closes the session. */
  sttStop: () => void;
  /** Stream a frame of 16 kHz PCM16 audio up to the active session. */
  sendAudio: (frame: ArrayBuffer) => void;
  onSttPartial: (callback: CallbackFn<string>) => void;
  onSttTurnEnd: (callback: CallbackFn<string>) => void;
  onSttError: (callback: CallbackFn<string>) => void;
}

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001';

  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return 'ws://localhost:3001';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  const onChunkRef = useRef<CallbackFn<string> | null>(null);
  const onCompleteRef = useRef<CallbackFn<CompletePayload> | null>(null);
  const onAudioRef = useRef<CallbackFn<AudioPayload> | null>(null);
  const onToolResultRef = useRef<CallbackFn<unknown> | null>(null);
  const onErrorRef = useRef<CallbackFn<string> | null>(null);
  const onSttPartialRef = useRef<CallbackFn<string> | null>(null);
  const onSttTurnEndRef = useRef<CallbackFn<string> | null>(null);
  const onSttErrorRef = useRef<CallbackFn<string> | null>(null);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    connectingRef.current = false;
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || connectingRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    cleanup();
    connectingRef.current = true;

    const url = getWsUrl();
    console.log('[Jarvis] Connecting to', url);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      connectingRef.current = false;
      setIsConnected(true);
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      console.log('[Jarvis] WebSocket connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const message: WebSocketMessage = JSON.parse(event.data as string);

        switch (message.type) {
          case 'assistant_chunk':
            onChunkRef.current?.(message.data?.text ?? '');
            break;
          case 'assistant_complete':
            onCompleteRef.current?.({
              text: message.data?.text ?? '',
              ttsMode: message.data?.ttsMode === 'server' ? 'server' : 'browser',
            });
            break;
          case 'tts_audio':
            onAudioRef.current?.({
              audioBase64: message.data?.audioBase64 ?? '',
              mimeType: message.data?.mimeType ?? 'audio/mpeg',
            });
            break;
          case 'tool_result':
            onToolResultRef.current?.(message.data);
            break;
          case 'stt_partial':
            onSttPartialRef.current?.(message.data?.text ?? '');
            break;
          case 'stt_turn_end':
            onSttTurnEndRef.current?.(message.data?.text ?? '');
            break;
          case 'stt_error':
            onSttErrorRef.current?.(message.data?.message ?? 'STT error');
            break;
          case 'error':
            onErrorRef.current?.(message.data?.message ?? 'Unknown error');
            break;
          case 'status':
            console.log('[Jarvis] Status:', message.data?.message);
            break;
        }
      } catch (_e) {
        console.error('[Jarvis] Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      if (!mountedRef.current) return;
      setIsConnected(false);
      console.log('[Jarvis] WebSocket disconnected, reconnecting...');

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);
    };

    ws.onerror = () => {
      connectingRef.current = false;
    };
  }, [cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  const sendMessage = useCallback((text: string) => {
    console.log('[Jarvis] sendMessage called, readyState:', wsRef.current?.readyState, 'text:', JSON.stringify(text));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'user_message', data: { text } })
      );
      console.log('[Jarvis] Message sent to server via WebSocket');
    } else {
      console.warn('[Jarvis] WebSocket is not connected, cannot send message');
    }
  }, []);

  const sttStart = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stt_start' }));
      console.log('[Jarvis] stt_start sent');
    }
  }, []);

  const sttStop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stt_stop' }));
      console.log('[Jarvis] stt_stop sent');
    }
  }, []);

  const sendAudio = useCallback((frame: ArrayBuffer) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(frame);
    }
  }, []);

  const onSttPartial = useCallback((callback: CallbackFn<string>) => {
    onSttPartialRef.current = callback;
  }, []);

  const onSttTurnEnd = useCallback((callback: CallbackFn<string>) => {
    onSttTurnEndRef.current = callback;
  }, []);

  const onSttError = useCallback((callback: CallbackFn<string>) => {
    onSttErrorRef.current = callback;
  }, []);

  const onChunk = useCallback((callback: CallbackFn<string>) => {
    onChunkRef.current = callback;
  }, []);

  const onComplete = useCallback((callback: CallbackFn<CompletePayload>) => {
    onCompleteRef.current = callback;
  }, []);

  const onAudio = useCallback((callback: CallbackFn<AudioPayload>) => {
    onAudioRef.current = callback;
  }, []);

  const onToolResult = useCallback((callback: CallbackFn<unknown>) => {
    onToolResultRef.current = callback;
  }, []);

  const onError = useCallback((callback: CallbackFn<string>) => {
    onErrorRef.current = callback;
  }, []);

  return {
    sendMessage,
    isConnected,
    onChunk,
    onComplete,
    onAudio,
    onToolResult,
    onError,
    sttStart,
    sttStop,
    sendAudio,
    onSttPartial,
    onSttTurnEnd,
    onSttError,
  };
}
