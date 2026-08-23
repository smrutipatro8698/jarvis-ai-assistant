import { useRef, useCallback, useState, useEffect } from 'react';
import { CloudCapture } from '../audio/cloudCapture';

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
 *
 * ── Cloud STT ──────────────────────────────────────────────────────────────
 * When the server reports STT mode 'server' (Soniox / AssemblyAI), the WAKE
 * WORD is still detected locally by the free Web Speech API — but the actual
 * COMMAND is captured by streaming microphone PCM to the server's cloud
 * recognizer (via the cloudTransport passed in options). The command text and
 * the semantic end-of-turn then come from the cloud, not from Web Speech. We
 * only open the cloud mic during a command window, so we never bill silence.
 * In 'browser' mode (the default) nothing streams and Web Speech does it all.
 */
export type ConvState = 'off' | 'idle' | 'capturing' | 'muted';
export type SttMode = 'browser' | 'server';

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
// Jarvis finishes speaking (or after a manual mic tap) before giving up and
// returning to wake-word listening. Note: in server (cloud STT) mode the mic
// streams to the recognizer during this whole window, so a longer grace means
// up to this many seconds of (mostly silent) audio billed per follow-up turn.
const GRACE_MS = 15000;

function findWakePhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of WAKE_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

// Transport the hook uses to stream audio to a cloud recognizer (server mode).
// Supplied by App, backed by the WebSocket connection.
export interface CloudTransport {
  start: () => void; // open a cloud session (server-side)
  stop: () => void; // close it
  sendAudio: (frame: ArrayBuffer) => void; // stream one PCM frame
}

export interface SpeechOptions {
  onWake?: () => void;
  onCommand?: (text: string) => void;
  cloudTransport?: CloudTransport;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  mode: ConvState;
  sttMode: SttMode;
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
  // ── Cloud STT result ingestion (server mode; fed from the WebSocket) ──
  /** Interim transcript from the cloud recognizer. */
  ingestPartial: (text: string) => void;
  /** The cloud recognizer's semantic end-of-turn: this is the command. */
  ingestTurnEnd: (text: string) => void;
  /** The cloud recognizer errored; bail back to wake-word listening. */
  ingestError: (message: string) => void;
}

export function useSpeechRecognition(options: SpeechOptions = {}): UseSpeechRecognitionReturn {
  const SpeechRecognitionAPI =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;

  const isSupported = !!SpeechRecognitionAPI;

  const [mode, setModeState] = useState<ConvState>('off');
  const [sttMode, setSttMode] = useState<SttMode>('browser');
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListeningRef = useRef(false); // desired state: should the mic be on?
  const runningRef = useRef(false); // actual state: is recognition running?
  const convStateRef = useRef<ConvState>('off');
  const capturedRef = useRef(''); // accumulated FINAL text for current command (browser mode)
  const interimRef = useRef(''); // latest interim (fallback when Chrome never finalizes)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cloud STT (server mode) state.
  const sttModeRef = useRef<SttMode>('browser');
  const cloudCaptureRef = useRef<CloudCapture | null>(null);
  const cloudTextRef = useRef(''); // latest transcript from the cloud recognizer

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

  // Open the cloud mic + session for a command window (server mode only).
  const startCloudCapture = useCallback(() => {
    const transport = optsRef.current.cloudTransport;
    if (!transport) {
      console.warn('[Jarvis] Server STT mode but no cloudTransport provided');
      return;
    }
    cloudTextRef.current = '';
    transport.start(); // ask the server to open the recognizer session
    if (!cloudCaptureRef.current) {
      cloudCaptureRef.current = new CloudCapture((frame) => {
        optsRef.current.cloudTransport?.sendAudio(frame);
      });
    }
    void cloudCaptureRef.current.start().catch((e) => {
      console.error('[Jarvis] Cloud capture failed to start:', e);
    });
  }, []);

  // Close the cloud mic + session.
  const stopCloudCapture = useCallback(() => {
    if (cloudCaptureRef.current) {
      void cloudCaptureRef.current.stop();
    }
    optsRef.current.cloudTransport?.stop();
  }, []);

  // Finalize whatever command we've captured and return to wake-word listening.
  const finalize = useCallback(() => {
    clearSilence();
    let text: string;
    if (sttModeRef.current === 'server') {
      text = cloudTextRef.current.trim();
      stopCloudCapture();
    } else {
      text = (capturedRef.current.trim() || interimRef.current.trim()).trim();
    }
    capturedRef.current = '';
    interimRef.current = '';
    cloudTextRef.current = '';
    setTranscript('');
    setConvState('idle');
    if (text) {
      console.log('[Jarvis] Finalizing command:', JSON.stringify(text));
      optsRef.current.onCommand?.(text);
    } else {
      console.log('[Jarvis] Command window closed with no speech — back to wake word');
    }
  }, [clearSilence, setConvState, stopCloudCapture]);

  const armSilence = useCallback(
    (ms: number) => {
      clearSilence();
      silenceTimerRef.current = setTimeout(finalize, ms);
    },
    [clearSilence, finalize]
  );

  // ── Cloud STT result ingestion (server mode) ────────────────────────────
  const ingestPartial = useCallback(
    (text: string) => {
      if (sttModeRef.current !== 'server') return;
      if (convStateRef.current !== 'capturing') return;
      if (!text) return;
      cloudTextRef.current = text;
      setTranscript(text);
      // Cloud speech resets the silence countdown, same as local speech would.
      armSilence(SILENCE_MS);
    },
    [armSilence]
  );

  const ingestTurnEnd = useCallback(
    (text: string) => {
      if (sttModeRef.current !== 'server') return;
      if (convStateRef.current !== 'capturing') return;
      if (text) cloudTextRef.current = text;
      console.log('[Jarvis] Cloud end-of-turn');
      finalize();
    },
    [finalize]
  );

  const ingestError = useCallback(
    (message: string) => {
      if (sttModeRef.current !== 'server') return;
      console.warn('[Jarvis] Cloud STT error — returning to wake word:', message);
      stopCloudCapture();
      clearSilence();
      capturedRef.current = '';
      interimRef.current = '';
      cloudTextRef.current = '';
      setTranscript('');
      setConvState('idle');
    },
    [stopCloudCapture, clearSilence, setConvState]
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
          setConvState('capturing');
          optsRef.current.onWake?.();

          if (sttModeRef.current === 'server') {
            // Cloud mode: hand the command off to the cloud recognizer. We
            // ignore the Web Speech remainder — the cloud hears the command
            // itself from here — and give a full grace window to start.
            capturedRef.current = '';
            interimRef.current = '';
            cloudTextRef.current = '';
            setTranscript('');
            startCloudCapture();
            armSilence(GRACE_MS);
          } else {
            // Browser mode: keep any words the user ran into the wake phrase
            // ("hey jarvis what's the weather").
            const lower = combined.toLowerCase();
            const rest = combined.slice(lower.indexOf(phrase) + phrase.length).trim();
            capturedRef.current = rest;
            interimRef.current = '';
            setTranscript(rest);
            armSilence(rest ? SILENCE_MS : GRACE_MS);
          }
        }
      } else if (state === 'capturing') {
        // In server mode the cloud recognizer is authoritative; drop the local
        // Web Speech results so we don't double-transcribe.
        if (sttModeRef.current === 'server') return;
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
  }, [SpeechRecognitionAPI, armSilence, setConvState, startCloudCapture]);

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
    console.log('[Jarvis] beginCommandCapture() — opening command window');
    wantListeningRef.current = true;
    clearSilence();
    capturedRef.current = '';
    interimRef.current = '';
    cloudTextRef.current = '';
    setTranscript('');
    setConvState('capturing');
    if (sttModeRef.current === 'server') {
      startCloudCapture();
    } else {
      kick();
    }
    // Give the user the full grace window to start speaking; real speech
    // will shorten this to SILENCE_MS via armSilence.
    armSilence(GRACE_MS);
  }, [clearSilence, setConvState, kick, armSilence, startCloudCapture]);

  const finishCommandCapture = useCallback(() => {
    if (convStateRef.current === 'capturing') finalize();
  }, [finalize]);

  const setMuted = useCallback(
    (muted: boolean) => {
      if (muted) {
        console.log('[Jarvis] Muting (results dropped) — mic stays alive');
        clearSilence();
        // If a cloud command window was open, close it — TTS is about to play.
        if (sttModeRef.current === 'server') stopCloudCapture();
        capturedRef.current = '';
        interimRef.current = '';
        cloudTextRef.current = '';
        setConvState('muted');
        // Deliberately do NOT stop the local recognition — keeping the stream
        // alive is what makes the next turn's wake word work reliably.
      } else {
        console.log('[Jarvis] Unmuting — back to wake-word listening');
        clearSilence();
        capturedRef.current = '';
        interimRef.current = '';
        cloudTextRef.current = '';
        setTranscript('');
        setConvState('idle');
        kick(); // in case Chrome ended the stream while muted
      }
    },
    [clearSilence, setConvState, kick, stopCloudCapture]
  );

  const stopAll = useCallback(() => {
    console.log('[Jarvis] stopAll() — releasing mic');
    wantListeningRef.current = false;
    clearSilence();
    stopCloudCapture();
    capturedRef.current = '';
    interimRef.current = '';
    cloudTextRef.current = '';
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
  }, [clearSilence, setConvState, stopCloudCapture]);

  // Ask the server which STT mode is active (browser vs a cloud recognizer).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stt-config')
      .then((r) => r.json())
      .then((cfg) => {
        if (cancelled) return;
        const m: SttMode = cfg?.mode === 'server' ? 'server' : 'browser';
        sttModeRef.current = m;
        setSttMode(m);
        console.log('[Jarvis] STT mode:', m, '| provider:', cfg?.provider);
      })
      .catch((e) => {
        console.warn('[Jarvis] Could not fetch STT config, defaulting to browser:', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (cloudCaptureRef.current) void cloudCaptureRef.current.stop();
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
    sttMode,
    transcript,
    start,
    beginCommandCapture,
    finishCommandCapture,
    setMuted,
    stopAll,
    ingestPartial,
    ingestTurnEnd,
    ingestError,
  };
}
