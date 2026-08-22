import type { VoiceOption } from '../hooks/useSpeechSynthesis';

interface VoicePickerProps {
  voices: VoiceOption[];
  selectedVoice: string;
  onSelect: (voiceURI: string) => void;
}

export function VoicePicker({ voices, selectedVoice, onSelect }: VoicePickerProps) {
  if (voices.length === 0) {
    return null;
  }

  return (
    <div className="voice-picker">
      <label className="voice-picker__label">Voice</label>
      <select
        className="voice-picker__select"
        value={selectedVoice}
        onChange={(e) => onSelect(e.target.value)}
      >
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}
