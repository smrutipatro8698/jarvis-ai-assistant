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
  // Server mode: play synthesized audio (base64) from the active TTS provider.
  playServerAudio: (audioBase64: string, mimeType: string) => void;
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

  const playServerAudio = useCallback(
    (audioBase64: string, mimeType: string) => {
      if (!audioBase64) return;
      console.log('[TTS] Playing server audio, mime:', mimeType, 'base64 len:', audioBase64.length);
      // Stop any in-flight speech/audio first.
      if (speechSupported) window.speechSynthesis.cancel();
      cleanupAudio();

      try {
        const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onplay = () => setIsSpeaking(true);
        audio.onended = () => {
          setIsSpeaking(false);
          cleanupAudio();
        };
        audio.onerror = () => {
          console.error('[TTS] Server audio playback error');
          setIsSpeaking(false);
          cleanupAudio();
        };
        // Some browsers need isSpeaking set before the async play resolves so the
        // echo-mute fires immediately.
        setIsSpeaking(true);
        void audio.play().catch((e) => {
          console.error('[TTS] audio.play() rejected:', e);
          setIsSpeaking(false);
          cleanupAudio();
        });
      } catch (e) {
        console.error('[TTS] Failed to decode/play server audio:', e);
        setIsSpeaking(false);
        cleanupAudio();
      }
    },
    [speechSupported, cleanupAudio]
  );

  useEffect(() => {
    return () => {
      if (speechSupported) window.speechSynthesis.cancel();
      cleanupAudio();
    };
  }, [speechSupported, cleanupAudio]);

  return {
    speak,
    playServerAudio,
    stop,
    isSpeaking,
    isSupported: speechSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
}
