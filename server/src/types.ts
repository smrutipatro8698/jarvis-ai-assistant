export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolResult {
  name: string;
  result: any;
  displayType: 'weather' | 'time' | 'calculation' | 'reminder' | 'system' | 'device' | 'news' | 'text';
}

export interface WSMessage {
  type: 'user_message' | 'assistant_chunk' | 'assistant_complete' | 'tool_result' | 'error' | 'status';
  data: any;
}

export interface DeviceState {
  id: string;
  name: string;
  type: 'light' | 'thermostat' | 'lock' | 'speaker';
  state: Record<string, any>;
}
