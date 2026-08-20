interface MicButtonProps {
  isCapturing: boolean;
  onPress: () => void;
  onRelease: () => void;
}

function MicIcon() {
  return (
    <svg
      className="mic-button__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="1" width="6" height="12" rx="3" ry="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export function MicButton({ isCapturing, onPress, onRelease }: MicButtonProps) {
  return (
    <div className="mic-button-container">
      <button
        className={`mic-button ${isCapturing ? 'mic-button--capturing' : ''}`}
        onMouseDown={onPress}
        onMouseUp={onRelease}
        onMouseLeave={isCapturing ? onRelease : undefined}
        onTouchStart={(e) => {
          e.preventDefault();
          onPress();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          onRelease();
        }}
        aria-label={isCapturing ? 'Release to send' : 'Hold to talk'}
        type="button"
      >
        <MicIcon />
      </button>
      <span className="mic-button__hint">
        Hold to talk or say &quot;Hey Jarvis&quot;
      </span>
    </div>
  );
}
