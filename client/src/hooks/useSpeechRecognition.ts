import { useRef, useCallback, useState, useEffect } from 'react';

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

/**
 * Conversation state machine layered on top of ONE persistent recognition stream.
 *
 *  - 'off'       : not listening at all (before activation / after stopAll)
 *  - 'idle'      : mic is live, listening for the wake word
 *  - 'capturing' : mic is live, actively collecting a spoken command
 *  - 'muted'     : mic is STILL live, but every result is dropped (used during
 *                  TTS playback so Jarvis never hears its own voice)
 *
 * The key design choice: we never destroy/recreate the recognition object to
 * switch modes. Mode changes are just ref flag flips, which are instantaneous
 * and race-free. The only place we (re)start recognition is Chrome's own
 * `onend` (Chrome ends the session periodically), and that restart preserves
 * whatever mode we're in — so a multi-turn conversation never loses the mic.
 */
export type ConvState = 'off' | 'idle' | 'capturing' | 'muted';

const WAKE_PHRASES = [
  'hey jarvis',
  'hey jarves',
  'hey jervis',
  'hey travis',
  'hey charvis',
  'a jarvis',
  'jarvis',
];

// How long a silence (after speech) before we finalize a command.
const SILENCE_MS = 1800;
// Follow-up window: how long to wait for the user to START talking after
// Jarvis finishes speaking (or after a manual mic tap) before giving up.
const GRACE_MS = 7000;

function findWakePhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of WAKE_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

export interface SpeechOptions {
  onWake?: () => void;
  onCommand?: (text: string) => void;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  mode: ConvState;
  transcript: string;
  /** Start persistent listening in wake-word mode. */
  start: () => void;
  /** Open a command-capture window (follow-up after TTS, or manual mic). */
  beginCommandCapture: () => void;
  /** Force-finalize the current command immediately (e.g. mic button release). */
  finishCommandCapture: () => void;
  /** Mute (drop results) during TTS, or unmute back to wake-word listening. */
  setMuted: (muted: boolean) => void;
  /** Fully stop and release the mic. */
  stopAll: () => void;
}

export function useSpeechRecognition(options: SpeechOptions = {}): UseSpeechRecognitionReturn {
  const SpeechRecognitionAPI =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;

  const isSupported = !!SpeechRecognitionAPI;

  const [mode, setModeState] = useState<ConvState>('off');
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListeningRef = useRef(false); // desired state: should the mic be on?
  const runningRef = useRef(false); // actual state: is recognition running?
  const convStateRef = useRef<ConvState>('off');
  const capturedRef = useRef(''); // accumulated FINAL text for current command
  const interimRef = useRef(''); // latest interim (fallback when Chrome never finalizes)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest callbacks in a ref so the (long-lived) recognition handlers
  // always call the current versions without needing to be re-created.
  const optsRef = useRef(options);
  optsRef.current = options;

  const setConvState = useCallback((s: ConvState) => {
    convStateRef.current = s;
    setModeState(s);
  }, []);

  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Finalize whatever command we've captured and return to wake-word listening.
  const finalize = useCallback(() => {
    clearSilence();
    const text = (capturedRef.current.trim() || interimRef.current.trim()).trim();
    capturedRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setConvState('idle');
    if (text) {
      console.log('[Jarvis] Finalizing command:', JSON.stringify(text));
      optsRef.current.onCommand?.(text);
    } else {
      console.log('[Jarvis] Command window closed with no speech — back to wake word');
    }
  }, [clearSilence, setConvState]);

  const armSilence = useCallback(
    (ms: number) => {
      clearSilence();
      silenceTimerRef.current = setTimeout(finalize, ms);
    },
    [clearSilence, finalize]
  );

  // Lazily build the single recognition instance. Handlers read refs, so this
  // object lives for the lifetime of the app and is reused across all modes.
  const ensureRecognition = useCallback((): SpeechRecognitionInstance | null => {
    if (!SpeechRecognitionAPI) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      runningRef.current = true;
      console.log('[Jarvis] Recognition stream started (mode:', convStateRef.current, ')');
    };

    rec.onend = () => {
      runningRef.current = false;
      console.log('[Jarvis] Recognition stream ended (want:', wantListeningRef.current, ')');
      // Chrome ends the session on its own periodically. As long as we still
      // want to listen, restart the SAME instance — mode is preserved, so a
      // conversation never drops the mic between turns.
      if (wantListeningRef.current) {
        setTimeout(() => {
          if (wantListeningRef.current && !runningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {
              console.warn('[Jarvis] Restart failed (will retry on next onend):', e);
            }
          }
        }, 150);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' and 'aborted' are normal lifecycle events; onend handles restart.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('[Jarvis] Microphone permission denied. Check chrome://settings/content/microphone');
        wantListeningRef.current = false;
        setConvState('off');
      } else {
        console.log('[Jarvis] Recognition error (non-fatal):', event.error);
      }
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }

      const state = convStateRef.current;

      // Drop everything while muted (TTS playing) or off. This is how we
      // prevent Jarvis from hearing itself — the mic stays alive, we just
      // ignore what it hears.
      if (state === 'muted' || state === 'off') return;

      if (state === 'idle') {
        const combined = (final || interim).trim();
        setTranscript(combined);
        const phrase = findWakePhrase(combined);
        if (phrase) {
          console.log('[Jarvis] Wake word detected in:', JSON.stringify(combined));
          // If the user ran the wake word into their command
          // ("hey jarvis what's the weather"), keep the remainder.
          const lower = combined.toLowerCase();
          const rest = combined.slice(lower.indexOf(phrase) + phrase.length).trim();
          capturedRef.current = rest;
          interimRef.current = '';
          setTranscript(rest);
          setConvState('capturing');
          optsRef.current.onWake?.();
          // If they already started the command, use the short silence gap;
          // otherwise give them the full grace window to begin.
          armSilence(rest ? SILENCE_MS : GRACE_MS);
        }
      } else if (state === 'capturing') {
        if (final) {
          capturedRef.current = (capturedRef.current + ' ' + final).trim();
        }
        interimRef.current = interim;
        setTranscript((capturedRef.current + ' ' + interim).trim());
        // Reset the silence countdown on every bit of speech.
        armSilence(SILENCE_MS);
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, [SpeechRecognitionAPI, armSilence, setConvState]);

  const kick = useCallback(() => {
    const rec = ensureRecognition();
    if (rec && !runningRef.current) {
      try {
        rec.start();
      } catch (e) {
        // start() throws if it's already running — safe to ignore.
        console.log('[Jarvis] start() no-op (already running):', (e as Error).message);
      }
    }
  }, [ensureRecognition]);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) return;
    console.log('[Jarvis] start() — wake-word listening');
    wantListeningRef.current = true;
    clearSilence();
    capturedRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setConvState('idle');
    kick();
  }, [SpeechRecognitionAPI, clearSilence, setConvState, kick]);

  const beginCommandCapture = useCallback(() => {
    if (!SpeechRecognitionAPI) return;
    console.log('[Jarvis] beginCommandCapture() — opening command window');
    wantListeningRef.current = true;
    clearSilence();
    capturedRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setConvState('capturing');
    kick();
    // Give the user the full grace window to start speaking; real speech
    // will shorten this to SILENCE_MS via armSilence in onresult.
    armSilence(GRACE_MS);
  }, [SpeechRecognitionAPI, clearSilence, setConvState, kick, armSilence]);

  const finishCommandCapture = useCallback(() => {
    if (convStateRef.current === 'capturing') finalize();
  }, [finalize]);

  const setMuted = useCallback(
    (muted: boolean) => {
      if (muted) {
        console.log('[Jarvis] Muting (results dropped) — mic stays alive');
        clearSilence();
        capturedRef.current = '';
        interimRef.current = '';
        setConvState('muted');
        // Deliberately do NOT stop the recognition — keeping the stream alive
        // is what makes the next turn work reliably.
      } else {
        console.log('[Jarvis] Unmuting — back to wake-word listening');
        clearSilence();
        capturedRef.current = '';
        interimRef.current = '';
        setTranscript('');
        setConvState('idle');
        kick(); // in case Chrome ended the stream while muted
      }
    },
    [clearSilence, setConvState, kick]
  );

  const stopAll = useCallback(() => {
    console.log('[Jarvis] stopAll() — releasing mic');
    wantListeningRef.current = false;
    clearSilence();
    capturedRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setConvState('off');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_e) {
        /* ignore */
      }
    }
    runningRef.current = false;
  }, [clearSilence, setConvState]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_e) {
          /* ignore */
        }
      }
    };
  }, []);

  return {
    isSupported,
    mode,
    transcript,
    start,
    beginCommandCapture,
    finishCommandCapture,
    setMuted,
    stopAll,
  };
}
