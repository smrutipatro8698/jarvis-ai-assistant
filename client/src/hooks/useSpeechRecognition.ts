import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Mode = 'off' | 'wake-word' | 'command-capture';

const WAKE_PHRASES = ['hey jarvis', 'hey jarves', 'a jarvis', 'hey travis', 'hey jervis'];
const SILENCE_TIMEOUT_MS = 2500;

function containsWakePhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return WAKE_PHRASES.some(phrase => lower.includes(phrase));
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isCapturing: boolean;
  transcript: string;
  finalTranscript: string;
  wakeWordDetected: boolean;
  startManualListening: () => void;
  stopManualListening: () => void;
  startWakeWordListening: () => void;
  stopAll: () => void;
  isSupported: boolean;
  isActivated: boolean;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const SpeechRecognitionAPI =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;

  const isSupported = !!SpeechRecognitionAPI;

  const [mode, setMode] = useState<Mode>('off');
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [isActivated, setIsActivated] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const modeRef = useRef<Mode>('off');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedTextRef = useRef('');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const destroyRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try { rec.abort(); } catch (_e) { /* ignore */ }
      recognitionRef.current = null;
    }
  }, []);

  const createAndStartRecognition = useCallback(
    (targetMode: Mode) => {
      if (!SpeechRecognitionAPI) return;

      destroyRecognition();
      clearSilenceTimer();

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognitionRef.current = recognition;

      modeRef.current = targetMode;
      setMode(targetMode);

      recognition.onstart = () => {
        console.log(`[Jarvis] Speech recognition started in ${modeRef.current} mode`);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            finalText += text;
          } else {
            interimText += text;
          }
        }

        const currentText = (finalText || interimText).trim();

        if (modeRef.current === 'wake-word') {
          if (containsWakePhrase(currentText)) {
            console.log('[Jarvis] Wake word detected!');
            setWakeWordDetected(true);
            setTimeout(() => setWakeWordDetected(false), 600);

            capturedTextRef.current = '';
            setTranscript('');
            modeRef.current = 'command-capture';
            setMode('command-capture');

            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              const captured = capturedTextRef.current.trim();
              if (captured) {
                setFinalTranscript(captured);
              }
              capturedTextRef.current = '';
              setTranscript('');
              modeRef.current = 'off';
              setMode('off');
              destroyRecognition();
              setTimeout(() => createAndStartRecognition('wake-word'), 300);
            }, SILENCE_TIMEOUT_MS);
          }
        } else if (modeRef.current === 'command-capture') {
          if (finalText) {
            capturedTextRef.current += ' ' + finalText;
          }
          setTranscript((capturedTextRef.current + ' ' + interimText).trim());

          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(() => {
            const captured = capturedTextRef.current.trim();
            if (captured) {
              setFinalTranscript(captured);
            }
            capturedTextRef.current = '';
            setTranscript('');
            modeRef.current = 'off';
            setMode('off');
            destroyRecognition();
            setTimeout(() => createAndStartRecognition('wake-word'), 300);
          }, SILENCE_TIMEOUT_MS);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' || event.error === 'no-speech') {
          return;
        }
        console.error('[Jarvis] Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          console.error('[Jarvis] Microphone permission denied. Click the page first, then try again.');
        }
      };

      recognition.onend = () => {
        console.log(`[Jarvis] Speech recognition ended, mode: ${modeRef.current}`);
        if (modeRef.current === 'wake-word') {
          restartTimerRef.current = setTimeout(() => {
            if (modeRef.current === 'wake-word') {
              console.log('[Jarvis] Restarting wake word listener...');
              createAndStartRecognition('wake-word');
            }
          }, 300);
        }
      };

      try {
        recognition.start();
        setIsActivated(true);
      } catch (e) {
        console.error('[Jarvis] Failed to start speech recognition:', e);
      }
    },
    [SpeechRecognitionAPI, destroyRecognition, clearSilenceTimer]
  );

  const startWakeWordListening = useCallback(() => {
    createAndStartRecognition('wake-word');
  }, [createAndStartRecognition]);

  const startManualListening = useCallback(() => {
    capturedTextRef.current = '';
    setTranscript('');
    createAndStartRecognition('command-capture');
  }, [createAndStartRecognition]);

  const stopManualListening = useCallback(() => {
    clearSilenceTimer();
    const text = capturedTextRef.current.trim();
    if (text) {
      setFinalTranscript(text);
    }
    capturedTextRef.current = '';
    setTranscript('');
    modeRef.current = 'off';
    setMode('off');
    destroyRecognition();
  }, [clearSilenceTimer, destroyRecognition]);

  const stopAll = useCallback(() => {
    clearSilenceTimer();
    modeRef.current = 'off';
    setMode('off');
    capturedTextRef.current = '';
    setTranscript('');
    destroyRecognition();
  }, [clearSilenceTimer, destroyRecognition]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      destroyRecognition();
    };
  }, [clearSilenceTimer, destroyRecognition]);

  return {
    isListening: mode === 'wake-word',
    isCapturing: mode === 'command-capture',
    transcript,
    finalTranscript,
    wakeWordDetected,
    startManualListening,
    stopManualListening,
    startWakeWordListening,
    stopAll,
    isSupported,
    isActivated,
  };
}
