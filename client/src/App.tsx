import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { HUDLayout } from './components/HUDLayout';
import { JarvisOrb } from './components/JarvisOrb';
import type { OrbState } from './components/JarvisOrb';
import { ConversationPanel } from './components/ConversationPanel';
import type { Message } from './components/ConversationPanel';
import { ToolResultCard } from './components/ToolResultCard';
import type { ToolResult } from './components/ToolResultCard';
import { StatusBar } from './components/StatusBar';
import { MicButton } from './components/MicButton';
import { VoicePicker } from './components/VoicePicker';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import { useWebSocket } from './hooks/useWebSocket';

function playWakeChime() {
  try {
    const ctx = new AudioContext();
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    osc1.connect(gainNode);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.12);

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
  const [activated, setActivated] = useState(false);
  const responseBufferRef = useRef('');
  // Tracks whether TTS was playing, so we can fire the follow-up window exactly
  // once when it transitions from speaking → done (see the follow-up effect).
  const wasSpeakingRef = useRef(false);

  // Forward-declared so the speech callbacks can reach the latest version
  // without re-subscribing the recognition stream.
  const processCommandRef = useRef<(text: string) => void>(() => {});

  const tts = useTextToSpeech();
  const ws = useWebSocket();

  const handleWake = useCallback(() => {
    playWakeChime();
    tts.stop();
    setOrbState('listening');
    setCurrentTranscript('');
  }, [tts]);

  // Transport the speech hook uses to stream mic audio to the server's cloud
  // recognizer (server STT mode only). Backed by the WebSocket connection.
  const cloudTransport = useMemo(
    () => ({
      start: ws.sttStart,
      stop: ws.sttStop,
      sendAudio: ws.sendAudio,
    }),
    [ws.sttStart, ws.sttStop, ws.sendAudio]
  );

  const speech = useSpeechRecognition({
    onWake: handleWake,
    onCommand: (text) => processCommandRef.current(text),
    cloudTransport,
  });
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const handleActivate = useCallback(() => {
    speech.start();
    setActivated(true);
    playWakeChime();
  }, [speech]);

  // Reflect the speech-hook's conversation state onto the orb.
  useEffect(() => {
    if (speech.mode === 'capturing') {
      setOrbState('listening');
    } else if (speech.mode === 'idle') {
      // Only drop to idle if we were listening — never override thinking/speaking.
      setOrbState((s) => (s === 'listening' ? 'idle' : s));
    }
  }, [speech.mode]);

  // Mute the mic (drop results, keep stream alive) while TTS is playing so
  // Jarvis never hears its own voice. Unmuting happens in the follow-up effect.
  useEffect(() => {
    if (tts.isSpeaking) {
      speechRef.current.setMuted(true);
    }
  }, [tts.isSpeaking]);

  // Show what the mic hears while listening.
  useEffect(() => {
    if (speech.transcript) {
      setCurrentTranscript(speech.transcript);
    }
  }, [speech.transcript]);

  // Handle a completed spoken command.
  const processCommand = useCallback(
    (text: string) => {
      console.log('[App] processCommand:', JSON.stringify(text));
      if (!text.trim()) return;

      // Keep the mic muted while we think + speak the reply.
      speechRef.current.setMuted(true);
      tts.stop();

      setMessages((prev) => [
        ...prev,
        { role: 'user', text: text.trim(), timestamp: new Date() },
      ]);

      setOrbState('thinking');
      setCurrentTranscript('');
      responseBufferRef.current = '';

      ws.sendMessage(text.trim());
    },
    [tts, ws]
  );
  processCommandRef.current = processCommand;

  // WebSocket event handlers
  useEffect(() => {
    ws.onChunk((chunk: string) => {
      responseBufferRef.current += chunk;
      setCurrentTranscript(responseBufferRef.current);
    });

    ws.onComplete(({ text: fullText, ttsMode }) => {
      const text = fullText || responseBufferRef.current;
      responseBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text, timestamp: new Date() },
      ]);

      setOrbState('speaking');
      // Server mode: audio already arrived (or will) via onAudio and is playing.
      // Browser mode: speak the text locally with the Web Speech API.
      if (ttsMode === 'browser') {
        tts.speak(text);
      }
    });

    // Server-synthesized audio (ElevenLabs / Cartesia). Play it back; this sets
    // tts.isSpeaking, which drives the same echo-mute + follow-up behavior.
    ws.onAudio(({ audioBase64, mimeType }) => {
      tts.playServerAudio(audioBase64, mimeType);
    });

    // Cloud STT results (server mode). Feed them into the speech hook, which
    // owns the conversation state machine and turns end-of-turn into a command.
    ws.onSttPartial((text) => speechRef.current.ingestPartial(text));
    ws.onSttTurnEnd((text) => speechRef.current.ingestTurnEnd(text));
    ws.onSttError((message) => speechRef.current.ingestError(message));

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

  // When TTS finishes speaking the reply, open a hands-free follow-up window
  // so the user can just keep talking without saying the wake word again.
  //
  // We detect the finish via a ref that remembers whether TTS was playing, and
  // depend ONLY on tts.isSpeaking. An earlier version also depended on orbState
  // and called setOrbState('listening') inside the effect — which re-ran the
  // effect and fired its cleanup, cancelling the pending beginCommandCapture
  // timeout before the next turn could open. Depending only on isSpeaking keeps
  // that timeout alive so the follow-up window actually opens.
  useEffect(() => {
    if (tts.isSpeaking) {
      wasSpeakingRef.current = true;
      return;
    }
    if (!wasSpeakingRef.current) return; // TTS wasn't playing — nothing to follow up on
    wasSpeakingRef.current = false;
    console.log('[App] TTS finished — opening follow-up window');
    setCurrentTranscript('');
    setOrbState('listening');
    // Small delay so the tail of the speaker audio doesn't leak into the mic
    // before we open the window; beginCommandCapture unmutes and starts capture.
    const t = setTimeout(() => {
      speechRef.current.beginCommandCapture();
    }, 350);
    return () => clearTimeout(t);
  }, [tts.isSpeaking]);

  // Mic button: tap to open a command window immediately.
  const handleMicPress = useCallback(() => {
    tts.stop();
    setOrbState('listening');
    speech.beginCommandCapture();
  }, [tts, speech]);

  const handleMicRelease = useCallback(() => {
    speech.finishCommandCapture();
  }, [speech]);

  // Activation screen - browser requires user gesture for mic access
  if (!activated) {
    return (
      <div className="activation-screen" onClick={handleActivate}>
        <div className="activation-orb" />
        <h1 className="activation-title">J.A.R.V.I.S.</h1>
        <p className="activation-subtitle">Just A Rather Very Intelligent System</p>
        <button className="activation-button" onClick={handleActivate}>
          Initialize System
        </button>
        <p className="activation-hint">Click anywhere to activate voice assistant</p>
        {!speech.isSupported && (
          <p className="activation-warning">
            Web Speech API not supported. Please use Google Chrome.
          </p>
        )}
      </div>
    );
  }

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
            transcript={currentTranscript || undefined}
          />
          <MicButton
            isCapturing={speech.mode === 'capturing'}
            onPress={handleMicPress}
            onRelease={handleMicRelease}
          />
        </>
      }
      right={toolPanel}
      bottom={
        <div className="bottom-bar">
          <StatusBar isConnected={ws.isConnected} orbState={orbState} />
          <VoicePicker
            voices={tts.voices}
            selectedVoice={tts.selectedVoice}
            onSelect={tts.setSelectedVoice}
          />
        </div>
      }
    />
  );
}
