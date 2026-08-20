import { useState, useEffect } from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'wake-detected';

interface JarvisOrbProps {
  state: OrbState;
  transcript?: string;
}

const STATE_LABELS: Record<OrbState, string> = {
  idle: '',
  listening: 'Listening...',
  thinking: 'Processing...',
  speaking: 'Speaking...',
  'wake-detected': 'Activated',
};

const ORB_CLASS_MAP: Record<OrbState, string> = {
  idle: 'orb--idle',
  listening: 'orb--listening',
  thinking: 'orb--thinking',
  speaking: 'orb--speaking',
  'wake-detected': 'orb--wake-detected',
};

export function JarvisOrb({ state, transcript }: JarvisOrbProps) {
  const [showWakeFlash, setShowWakeFlash] = useState(false);

  useEffect(() => {
    if (state === 'wake-detected') {
      setShowWakeFlash(true);
      const timer = setTimeout(() => setShowWakeFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const orbClass = ORB_CLASS_MAP[state] || '';
  const statusText = STATE_LABELS[state] || '';
  const arcRingSize = 220;

  return (
    <div className="jarvis-orb-container">
      {/* Rotating rings */}
      <div className="jarvis-orb__ring jarvis-orb__ring--outer" />
      <div className="jarvis-orb__ring jarvis-orb__ring--inner" />

      {/* Arc reactor SVG ring */}
      <svg
        className="jarvis-orb__arc-ring"
        width={arcRingSize}
        height={arcRingSize}
        viewBox={`0 0 ${arcRingSize} ${arcRingSize}`}
      >
        {/* Outer dashed ring */}
        <circle
          cx={arcRingSize / 2}
          cy={arcRingSize / 2}
          r={arcRingSize / 2 - 8}
          fill="none"
          stroke="rgba(33, 150, 243, 0.2)"
          strokeWidth="1"
          strokeDasharray="8 4"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${arcRingSize / 2} ${arcRingSize / 2}`}
            to={`360 ${arcRingSize / 2} ${arcRingSize / 2}`}
            dur="20s"
            repeatCount="indefinite"
          />
        </circle>
        {/* Inner dashed ring */}
        <circle
          cx={arcRingSize / 2}
          cy={arcRingSize / 2}
          r={arcRingSize / 2 - 16}
          fill="none"
          stroke="rgba(0, 188, 212, 0.15)"
          strokeWidth="0.5"
          strokeDasharray="12 6 4 6"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`360 ${arcRingSize / 2} ${arcRingSize / 2}`}
            to={`0 ${arcRingSize / 2} ${arcRingSize / 2}`}
            dur="15s"
            repeatCount="indefinite"
          />
        </circle>
        {/* Tick marks */}
        {Array.from({ length: 36 }).map((_, i) => {
          const angle = (i * 10 * Math.PI) / 180;
          const r1 = arcRingSize / 2 - 4;
          const r2 = arcRingSize / 2 - (i % 3 === 0 ? 12 : 8);
          const cx = arcRingSize / 2;
          const cy = arcRingSize / 2;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(angle)}
              y1={cy + r1 * Math.sin(angle)}
              x2={cx + r2 * Math.cos(angle)}
              y2={cy + r2 * Math.sin(angle)}
              stroke={
                i % 3 === 0
                  ? 'rgba(33, 150, 243, 0.3)'
                  : 'rgba(33, 150, 243, 0.12)'
              }
              strokeWidth={i % 3 === 0 ? '1' : '0.5'}
            />
          );
        })}
      </svg>

      {/* Wake flash overlay */}
      {showWakeFlash && <div className="jarvis-orb__wake-flash" />}

      {/* Main orb */}
      <div className={`jarvis-orb ${orbClass}`} />

      {/* Label */}
      <div className="jarvis-orb__label">J.A.R.V.I.S.</div>

      {/* Status text */}
      {statusText && (
        <div className="jarvis-orb__status-text">{statusText}</div>
      )}

      {/* Transcript display */}
      {transcript && (
        <div className="jarvis-orb__transcript">{transcript}</div>
      )}
    </div>
  );
}
