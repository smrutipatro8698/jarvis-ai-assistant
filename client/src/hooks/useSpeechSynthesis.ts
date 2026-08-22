import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
}

export interface UseSpeechSynthesisReturn {
  speak: (text: string) => void;
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
    const match = voices.find(
      (v) => v.name.includes(preferred) && v.lang.startsWith('en')
    );
    if (match) return match;
  }

  const englishVoice = voices.find((v) => v.lang.startsWith('en'));
  if (englishVoice) return englishVoice;

  return voices[0];
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const allVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      const rawVoices = window.speechSynthesis.getVoices();
      allVoicesRef.current = rawVoices;

      const englishVoices = rawVoices
        .filter((v) => v.lang.startsWith('en'))
        .map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI }));
      setVoices(englishVoices);

      if (!selectedVoice) {
        const defaultVoice = pickDefaultVoice(rawVoices);
        if (defaultVoice) setSelectedVoice(defaultVoice.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [isSupported, selectedVoice]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    utteranceRef.current = null;
  }, [isSupported]);

  const speak = useCallback(
    (text: string) => {
      if (!isSupported) return;

      window.speechSynthesis.cancel();

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
    [isSupported, selectedVoice]
  );

  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
}
