import { useState, useEffect, useCallback, useRef } from 'react';
import { HUDLayout } from './components/HUDLayout';
import { JarvisOrb } from './components/JarvisOrb';
import type { OrbState } from './components/JarvisOrb';
import { ConversationPanel } from './components/ConversationPanel';
import type { Message } from './components/ConversationPanel';
import { ToolResultCard } from './components/ToolResultCard';
import type { ToolResult } from './components/ToolResultCard';
import { StatusBar } from './components/StatusBar';
import { MicButton } from './components/MicButton';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { useWebSocket } from './hooks/useWebSocket';

// Generate a short ascending two-note chime using Web Audio API
function playWakeChime() {
  try {
    const ctx = new AudioContext();
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    // First note
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    osc1.connect(gainNode);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.12);

    // Second note (higher)
    const gainNode2 = ctx.createGain();
    gainNode2.connect(ctx.destination);
    gainNode2.gain.setValueAtTime(0, ctx.currentTime);
    gainNode2.gain.setValueAtTime(0.15, ctx.currentTime + 0.1);
    gainNode2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
    osc2.connect(gainNode2);
    osc2.start(ctx.currentTime + 0.1);
    osc2.stop(ctx.currentTime + 0.3);

    // Cleanup
    setTimeout(() => ctx.close(), 500);
  } catch (_e) {
    // AudioContext may not be available
  }
}

export default function App() {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const responseBufferRef = useRef('');

  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();
  const ws = useWebSocket();

  // Start wake word listening on mount
  useEffect(() => {
    if (speech.isSupported) {
      speech.startWakeWordListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle wake word detection
  useEffect(() => {
    if (speech.wakeWordDetected) {
      playWakeChime();
      setOrbState('wake-detected');
      // Stop any ongoing TTS to avoid overlap
      tts.stop();

      // Brief flash then switch to listening
      const timer = setTimeout(() => {
        setOrbState('listening');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [speech.wakeWordDetected, tts]);

  // Track capturing state
  useEffect(() => {
    if (speech.isCapturing) {
      setOrbState('listening');
      setCurrentTranscript(speech.transcript);
    }
  }, [speech.isCapturing, speech.transcript]);

  // Update transcript display while capturing
  useEffect(() => {
    if (speech.isCapturing) {
      setCurrentTranscript(speech.transcript);
    }
  }, [speech.transcript, speech.isCapturing]);

  // Handle completed command (finalTranscript changes)
  const processCommand = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      // Stop TTS if speaking
      tts.stop();

      // Add user message
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: text.trim(), timestamp: new Date() },
      ]);

      // Switch to thinking state
      setOrbState('thinking');
      setCurrentTranscript('');
      responseBufferRef.current = '';

      // Send to backend
      ws.sendMessage(text.trim());
    },
    [tts, ws]
  );

  // Watch for finalTranscript
  const lastFinalRef = useRef('');
  useEffect(() => {
    if (
      speech.finalTranscript &&
      speech.finalTranscript !== lastFinalRef.current
    ) {
      lastFinalRef.current = speech.finalTranscript;
      processCommand(speech.finalTranscript);
    }
  }, [speech.finalTranscript, processCommand]);

  // WebSocket event handlers
  useEffect(() => {
    ws.onChunk((chunk: string) => {
      responseBufferRef.current += chunk;
      setCurrentTranscript(responseBufferRef.current);
    });

    ws.onComplete((fullText: string) => {
      const text = fullText || responseBufferRef.current;
      responseBufferRef.current = '';

      // Add assistant message
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text, timestamp: new Date() },
      ]);

      // Speak the response
      setOrbState('speaking');
      tts.speak(text);
    });

    ws.onToolResult((result: unknown) => {
      const toolResult = result as ToolResult;
      setToolResults((prev) => [...prev, toolResult]);
    });

    ws.onError((error: string) => {
      console.error('WebSocket error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Error: ${error}`,
          timestamp: new Date(),
        },
      ]);
      setOrbState('idle');
      setCurrentTranscript('');
    });
  }, [ws, tts]);

  // When TTS finishes, return to idle and resume wake word
  useEffect(() => {
    if (orbState === 'speaking' && !tts.isSpeaking) {
      setOrbState('idle');
      setCurrentTranscript('');
      // Resume wake word listening
      if (speech.isSupported) {
        speech.startWakeWordListening();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.isSpeaking, orbState]);

  // Mic button handlers
  const handleMicPress = useCallback(() => {
    tts.stop();
    setOrbState('listening');
    speech.startManualListening();
  }, [tts, speech]);

  const handleMicRelease = useCallback(() => {
    speech.stopManualListening();
  }, [speech]);

  // Tool panel content
  const toolPanel = (
    <div className="tool-panel">
      <div className="tool-panel__header">System Output</div>
      <div className="tool-panel__cards">
        {toolResults.length === 0 ? (
          <div className="tool-panel__empty">
            No tool results yet
          </div>
        ) : (
          toolResults.map((result, index) => (
            <ToolResultCard key={index} result={result} />
          ))
        )}
      </div>
    </div>
  );

  return (
    <HUDLayout
      left={<ConversationPanel messages={messages} />}
      center={
        <>
          <JarvisOrb
            state={orbState}
            transcript={
              orbState === 'listening' || orbState === 'thinking'
                ? currentTranscript
                : undefined
            }
          />
          <MicButton
            isCapturing={speech.isCapturing}
            onPress={handleMicPress}
            onRelease={handleMicRelease}
          />
        </>
      }
      right={toolPanel}
      bottom={
        <StatusBar isConnected={ws.isConnected} orbState={orbState} />
      }
    />
  );
}
