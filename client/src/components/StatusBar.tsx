import { useState, useEffect } from 'react';
import type { OrbState } from './JarvisOrb';

interface StatusBarProps {
  isConnected: boolean;
  orbState: OrbState;
}

const MODE_LABELS: Record<OrbState, string> = {
  idle: 'Wake Word Active',
  listening: 'Listening...',
  thinking: 'Processing...',
  speaking: 'Speaking...',
  'wake-detected': 'Wake Word Detected',
};

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function StatusBar({ isConnected, orbState }: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="status-bar">
      <div className="status-bar__section">
        <div className="status-bar__indicator">
          <span
            className={`status-bar__dot ${
              isConnected
                ? 'status-bar__dot--connected'
                : 'status-bar__dot--disconnected'
            }`}
          />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      <div className="status-bar__section">
        <span className="status-bar__mode">
          {MODE_LABELS[orbState] || 'Idle'}
        </span>
        <span className="status-bar__badge">Web Speech API</span>
      </div>

      <div className="status-bar__section">
        <span className="status-bar__time">{formatClock(currentTime)}</span>
      </div>
    </div>
  );
}
