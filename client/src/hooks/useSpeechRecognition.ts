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

const WAKE_PHRASE = 'hey jarvis';
const SILENCE_TIMEOUT_MS = 2000;

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

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const modeRef = useRef<Mode>('off');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedTextRef = useRef('');
  const restartingRef = useRef(false);
  const shouldRestartRef = useRef(false);

  // Keep modeRef in sync
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const finishCapture = useCallback(() => {
    clearSilenceTimer();
    const text = capturedTextRef.current.trim();
    if (text) {
      setFinalTranscript(text);
    }
    capturedTextRef.current = '';
    setTranscript('');
  }, [clearSilenceTimer]);

  const stopRecognition = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_e) {
        // ignore
      }
    }
  }, []);

  const startRecognition = useCallback(
    (targetMode: Mode) => {
      if (!SpeechRecognitionAPI) return;

      // Stop any existing recognition
      stopRecognition();

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognitionRef.current = recognition;
      setMode(targetMode);
      modeRef.current = targetMode;

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

        const currentText = finalText || interimText;

        if (modeRef.current === 'wake-word') {
          const combined = currentText.toLowerCase();
          if (combined.includes(WAKE_PHRASE)) {
            // Wake word detected - switch to command capture
            setWakeWordDetected(true);
            setTimeout(() => setWakeWordDetected(false), 600);

            capturedTextRef.current = '';
            setTranscript('');
            setMode('command-capture');
            modeRef.current = 'command-capture';

            // Reset the silence timer for capturing
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              finishCapture();
              // Switch back to wake word mode
              setMode('wake-word');
              modeRef.current = 'wake-word';
              // Restart recognition in wake word mode
              shouldRestartRef.current = true;
              try {
                recognition.stop();
              } catch (_e) {
                // ignore
              }
            }, SILENCE_TIMEOUT_MS);
          }
        } else if (modeRef.current === 'command-capture') {
          // Accumulate captured text
          if (finalText) {
            capturedTextRef.current += ' ' + finalText;
          }
          setTranscript(
            (capturedTextRef.current + ' ' + interimText).trim()
          );

          // Reset silence timer on new results
          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(() => {
            finishCapture();
            // If we were in wake-word mode before, go back to it
            setMode('wake-word');
            modeRef.current = 'wake-word';
            shouldRestartRef.current = true;
            try {
              recognition.stop();
            } catch (_e) {
              // ignore
            }
          }, SILENCE_TIMEOUT_MS);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' || event.error === 'no-speech') {
          return; // These are expected during restarts
        }
        console.error('Speech recognition error:', event.error);
      };

      recognition.onend = () => {
        if (restartingRef.current) return;

        if (shouldRestartRef.current && modeRef.current === 'wake-word') {
          // Restart in wake-word mode after a brief delay
          shouldRestartRef.current = false;
          restartingRef.current = true;
          setTimeout(() => {
            restartingRef.current = false;
            if (modeRef.current !== 'off') {
              startRecognition('wake-word');
            }
          }, 200);
          return;
        }

        // Browser periodically stops continuous recognition - restart if in wake-word mode
        if (modeRef.current === 'wake-word') {
          restartingRef.current = true;
          setTimeout(() => {
            restartingRef.current = false;
            if (modeRef.current === 'wake-word') {
              startRecognition('wake-word');
            }
          }, 200);
        }
      };

      try {
        recognition.start();
      } catch (_e) {
        console.error('Failed to start speech recognition');
      }
    },
    [SpeechRecognitionAPI, stopRecognition, clearSilenceTimer, finishCapture]
  );

  const startWakeWordListening = useCallback(() => {
    startRecognition('wake-word');
  }, [startRecognition]);

  const startManualListening = useCallback(() => {
    capturedTextRef.current = '';
    setTranscript('');
    startRecognition('command-capture');
  }, [startRecognition]);

  const stopManualListening = useCallback(() => {
    clearSilenceTimer();
    finishCapture();
    setMode('off');
    modeRef.current = 'off';
    stopRecognition();
  }, [clearSilenceTimer, finishCapture, stopRecognition]);

  const stopAll = useCallback(() => {
    clearSilenceTimer();
    setMode('off');
    modeRef.current = 'off';
    capturedTextRef.current = '';
    setTranscript('');
    stopRecognition();
  }, [clearSilenceTimer, stopRecognition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      stopRecognition();
    };
  }, [clearSilenceTimer, stopRecognition]);

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
  };
}
