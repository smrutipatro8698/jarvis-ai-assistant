import { useState, useRef, useCallback, useEffect } from 'react';

interface WebSocketMessage {
  type: string;
  data: unknown;
}

type CallbackFn<T> = (value: T) => void;

export interface UseWebSocketReturn {
  sendMessage: (text: string) => void;
  isConnected: boolean;
  onChunk: (callback: CallbackFn<string>) => void;
  onComplete: (callback: CallbackFn<string>) => void;
  onToolResult: (callback: CallbackFn<unknown>) => void;
  onError: (callback: CallbackFn<string>) => void;
}

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001';

  // In development, connect directly to backend
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return 'ws://localhost:3001';
  }

  // In production, use the current host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Callback refs
  const onChunkRef = useRef<CallbackFn<string> | null>(null);
  const onCompleteRef = useRef<CallbackFn<string> | null>(null);
  const onToolResultRef = useRef<CallbackFn<unknown> | null>(null);
  const onErrorRef = useRef<CallbackFn<string> | null>(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const url = getWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const message: WebSocketMessage = JSON.parse(event.data as string);

        switch (message.type) {
          case 'chunk':
            onChunkRef.current?.(message.data as string);
            break;
          case 'complete':
            onCompleteRef.current?.(message.data as string);
            break;
          case 'tool_result':
            onToolResultRef.current?.(message.data);
            break;
          case 'error':
            onErrorRef.current?.(message.data as string);
            break;
        }
      } catch (_e) {
        console.error('Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);

      // Schedule reconnect with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(
        delay * 2,
        MAX_RECONNECT_DELAY
      );

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }, []);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'message', data: text })
      );
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  const onChunk = useCallback((callback: CallbackFn<string>) => {
    onChunkRef.current = callback;
  }, []);

  const onComplete = useCallback((callback: CallbackFn<string>) => {
    onCompleteRef.current = callback;
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
    onToolResult,
    onError,
  };
}
