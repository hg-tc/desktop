export interface AgentConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  browserUrl?: string;
}

export interface TaskMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface StreamEvent {
  type: 'token' | 'tool_start' | 'tool_end' | 'done' | 'error';
  content?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface AgentStatus {
  initialized: boolean;
  connected: boolean;
}

export interface SetupResponse {
  success: boolean;
  message: string;
  available_tools: string[];
}

export interface TaskResponse {
  success: boolean;
  output: string;
  error?: string;
}
