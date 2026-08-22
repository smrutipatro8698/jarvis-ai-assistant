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
  const latestInterimRef = useRef('');
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

      (recognition as any).onaudiostart = () => {
        console.log('[Jarvis] Audio capture started - mic is streaming');
      };

      (recognition as any).onsoundstart = () => {
        console.log('[Jarvis] Sound detected');
      };

      (recognition as any).onspeechstart = () => {
        console.log('[Jarvis] Speech detected!');
      };

      (recognition as any).onspeechend = () => {
        console.log('[Jarvis] Speech ended');
      };

      (recognition as any).onsoundend = () => {
        console.log('[Jarvis] Sound ended');
      };

      (recognition as any).onaudioend = () => {
        console.log('[Jarvis] Audio capture ended');
      };

      (recognition as any).onnomatch = () => {
        console.log('[Jarvis] No match - heard something but could not recognize');
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
          setTranscript(currentText);
          if (containsWakePhrase(currentText)) {
            console.log('[Jarvis] Wake word detected!');
            setWakeWordDetected(true);
            setTimeout(() => setWakeWordDetected(false), 600);

            capturedTextRef.current = '';
            latestInterimRef.current = '';
            setTranscript('');
            modeRef.current = 'command-capture';
            setMode('command-capture');

            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              let captured = capturedTextRef.current.trim();
              if (!captured) {
                captured = latestInterimRef.current.trim();
              }
              if (captured) {
                console.log('[Jarvis] Silence timer (wake-word transition) finalizing:', captured);
                setFinalTranscript(captured);
              }
              capturedTextRef.current = '';
              latestInterimRef.current = '';
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
          if (interimText) {
            latestInterimRef.current = interimText;
          }
          setTranscript((capturedTextRef.current + ' ' + interimText).trim());

          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(() => {
            let captured = capturedTextRef.current.trim();
            if (!captured) {
              captured = latestInterimRef.current.trim();
              console.log('[Jarvis] Using interim text as fallback:', captured);
            }
            if (captured) {
              console.log('[Jarvis] Silence timer finalizing:', captured);
              setFinalTranscript(captured);
            }
            capturedTextRef.current = '';
            latestInterimRef.current = '';
            setTranscript('');
            modeRef.current = 'off';
            setMode('off');
            destroyRecognition();
            setTimeout(() => createAndStartRecognition('wake-word'), 300);
          }, SILENCE_TIMEOUT_MS);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn(`[Jarvis] Speech recognition error: ${event.error} - ${event.message || 'no details'}`);
        if (event.error === 'not-allowed') {
          console.error('[Jarvis] Microphone permission denied! Check chrome://settings/content/microphone');
        }
      };

      recognition.onend = () => {
        console.log(`[Jarvis] Speech recognition ended, mode: ${modeRef.current}`);
        if (modeRef.current === 'command-capture') {
          console.log('[Jarvis] Restarting in command-capture mode to keep listening...');
          const pendingText = capturedTextRef.current.trim() || latestInterimRef.current.trim();
          restartTimerRef.current = setTimeout(() => {
            if (modeRef.current === 'command-capture') {
              createAndStartRecognition('command-capture');
              if (pendingText) {
                console.log('[Jarvis] Re-arming silence timer after restart, pending:', pendingText);
                silenceTimerRef.current = setTimeout(() => {
                  let captured = capturedTextRef.current.trim();
                  if (!captured) {
                    captured = latestInterimRef.current.trim();
                  }
                  if (captured) {
                    console.log('[Jarvis] Post-restart silence timer finalizing:', captured);
                    setFinalTranscript(captured);
                  }
                  capturedTextRef.current = '';
                  latestInterimRef.current = '';
                  setTranscript('');
                  modeRef.current = 'off';
                  setMode('off');
                  destroyRecognition();
                  setTimeout(() => createAndStartRecognition('wake-word'), 300);
                }, SILENCE_TIMEOUT_MS);
              }
            }
          }, 100);
        } else if (modeRef.current === 'wake-word') {
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
    latestInterimRef.current = '';
    setTranscript('');
    createAndStartRecognition('command-capture');
  }, [createAndStartRecognition]);

  const stopManualListening = useCallback(() => {
    clearSilenceTimer();
    let text = capturedTextRef.current.trim();
    if (!text) {
      text = latestInterimRef.current.trim();
    }
    if (text) {
      console.log('[Jarvis] stopManualListening finalizing:', text);
      setFinalTranscript(text);
    }
    capturedTextRef.current = '';
    latestInterimRef.current = '';
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
    latestInterimRef.current = '';
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
