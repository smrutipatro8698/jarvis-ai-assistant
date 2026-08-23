import { useState, useRef, useCallback, useEffect } from 'react';

// Unified text-to-speech for the client. Two backends behind one contract:
//   - browser: speak text via the Web Speech API (zero cost, the default)
//   - server:  play back audio bytes the server synthesized (ElevenLabs, Cartesia)
// The server decides which mode per reply; App.tsx just calls speak() for
// browser mode and playServerAudio() when audio arrives. isSpeaking is true
// during either, so the existing echo-mute + follow-up logic keeps working
// unchanged regardless of provider.

export interface VoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
}

export interface UseTextToSpeechReturn {
  // Browser mode: speak text with the Web Speech API.
  speak: (text: string) => void;
  // Server mode: queue a synthesized audio chunk (base64) from the active TTS
  // provider. Chunks stream in during generation and play back in order.
  enqueueServerAudio: (audioBase64: string, mimeType: string) => void;
  // Server mode: the server has finished sending chunks for this reply. Once the
  // queue drains, isSpeaking flips false (which opens the follow-up window).
  endServerStream: () => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  voices: VoiceOption[];
  selectedVoice: string;
  setSelectedVoice: (voiceURI: string) => void;
}

const PREFERRED_VOICE_NAMES = ['Google UK English Male', 'Daniel', 'Google', 'Samantha'];

function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  for (const preferred of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name.includes(preferred) && v.lang.startsWith('en'));
    if (match) return match;
  }
  const englishVoice = voices.find((v) => v.lang.startsWith('en'));
  return englishVoice || voices[0];
}

export function useTextToSpeech(): UseTextToSpeechReturn {
  const speechSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const allVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  // Server-mode playback queue. Chunks arrive during generation; we play them
  // one at a time, in order. streamActive = a reply is in progress; streamEnded
  // = server has sent its last chunk. We keep isSpeaking true across the gaps
  // between chunks (queue momentarily empty but more coming) so the echo-mute
  // and follow-up window never fire in the middle of a reply.
  const queueRef = useRef<Array<{ base64: string; mime: string }>>([]);
  const playingRef = useRef(false);
  const streamActiveRef = useRef(false);
  const streamEndedRef = useRef(false);

  // Load Web Speech voices for browser mode (also used by the VoicePicker).
  useEffect(() => {
    if (!speechSupported) return;
    const loadVoices = () => {
      const rawVoices = window.speechSynthesis.getVoices();
      allVoicesRef.current = rawVoices;
      const englishVoices = rawVoices
        .filter((v) => v.lang.startsWith('en'))
        .map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI }));
      setVoices(englishVoices);
      if (!selectedVoice) {
        const def = pickDefaultVoice(rawVoices);
        if (def) setSelectedVoice(def.voiceURI);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, [speechSupported, selectedVoice]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onplay = null;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      try {
        audioRef.current.pause();
      } catch (_e) {
        /* ignore */
      }
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (speechSupported) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }
    queueRef.current = [];
    playingRef.current = false;
    streamActiveRef.current = false;
    streamEndedRef.current = false;
    cleanupAudio();
    setIsSpeaking(false);
  }, [speechSupported, cleanupAudio]);

  const speak = useCallback(
    (text: string) => {
      if (!speechSupported || !text.trim()) return;
      console.log('[TTS] Browser Web Speech, chars:', text.length);
      window.speechSynthesis.cancel();
      cleanupAudio();

      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      const voice = allVoicesRef.current.find((v) => v.voiceURI === selectedVoice);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        utteranceRef.current = null;
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        utteranceRef.current = null;
      };
      window.speechSynthesis.speak(utterance);
    },
    [speechSupported, selectedVoice, cleanupAudio]
  );

  // Play the next queued chunk. When the queue empties, only truly stop if the
  // server has signalled the reply is complete; otherwise more chunks are still
  // in flight, so we stay "speaking" and wait.
  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      if (streamEndedRef.current) {
        streamActiveRef.current = false;
        cleanupAudio();
        setIsSpeaking(false);
      }
      return;
    }
    playingRef.current = true;
    cleanupAudio(); // release the previous chunk's element/URL
    try {
      const bytes = Uint8Array.from(atob(next.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: next.mime });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => playNext();
      audio.onerror = () => {
        console.error('[TTS] Server audio chunk playback error — skipping to next');
        playNext();
      };
      void audio.play().catch((e) => {
        console.error('[TTS] audio.play() rejected:', e);
        playNext();
      });
    } catch (e) {
      console.error('[TTS] Failed to decode/play server audio chunk:', e);
      playNext();
    }
  }, [cleanupAudio]);

  const enqueueServerAudio = useCallback(
    (audioBase64: string, mimeType: string) => {
      if (!audioBase64) return;
      if (!streamActiveRef.current) {
        // First chunk of a new reply — start a fresh stream.
        console.log('[TTS] Server audio stream started');
        streamActiveRef.current = true;
        streamEndedRef.current = false;
        queueRef.current = [];
        if (speechSupported) window.speechSynthesis.cancel();
      }
      queueRef.current.push({ base64: audioBase64, mime: mimeType });
      setIsSpeaking(true);
      if (!playingRef.current) playNext();
    },
    [speechSupported, playNext]
  );

  const endServerStream = useCallback(() => {
    console.log('[TTS] Server audio stream ended (queued:', queueRef.current.length, 'playing:', playingRef.current, ')');
    streamEndedRef.current = true;
    // If everything already drained, finish now; otherwise playNext() finishes
    // when the last chunk ends.
    if (!playingRef.current && queueRef.current.length === 0) {
      streamActiveRef.current = false;
      cleanupAudio();
      setIsSpeaking(false);
    }
  }, [cleanupAudio]);

  useEffect(() => {
    return () => {
      if (speechSupported) window.speechSynthesis.cancel();
      cleanupAudio();
    };
  }, [speechSupported, cleanupAudio]);

  return {
    speak,
    enqueueServerAudio,
    endServerStream,
    stop,
    isSpeaking,
    isSupported: speechSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
}
