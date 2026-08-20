import { useEffect, useRef } from 'react';

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

interface ConversationPanelProps {
  messages: Message[];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ConversationPanel({ messages }: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="conversation-panel">
      <div className="conversation-panel__header">Conversation Log</div>
      <div className="conversation-panel__messages">
        {messages.length === 0 ? (
          <div className="conversation-panel__empty">
            Say &quot;Hey Jarvis&quot; to begin...
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`message ${
                msg.role === 'user' ? 'message--user' : 'message--jarvis'
              }`}
            >
              <div className="message__text">{msg.text}</div>
              <div className="message__time">{formatTime(msg.timestamp)}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
