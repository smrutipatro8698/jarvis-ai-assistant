export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolResult {
  name: string;
  result: any;
  displayType: 'weather' | 'time' | 'calculation' | 'reminder' | 'system' | 'device' | 'news' | 'search' | 'webpage' | 'text';
}

export interface WSMessage {
  type:
    | 'user_message'
    | 'assistant_chunk'
    | 'assistant_complete'
    | 'tool_result'
    | 'error'
    | 'status'
    | 'tts_audio'
    // Cloud STT control (client → server) and results (server → client).
    | 'stt_start'
    | 'stt_stop'
    | 'stt_partial'
    | 'stt_final'
    | 'stt_turn_end'
    | 'stt_error';
  data: any;
}

export interface DeviceState {
  id: string;
  name: string;
  type: 'light' | 'thermostat' | 'lock' | 'speaker';
  state: Record<string, any>;
}
