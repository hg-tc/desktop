import type { AgentConfig, AgentStatus, SetupResponse, TaskResponse, StreamEvent } from '../types';

const API_BASE = 'http://127.0.0.1:8765';

export async function setupAgent(config: AgentConfig): Promise<SetupResponse> {
  const response = await fetch(`${API_BASE}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      api_base: config.apiBase,
      model: config.model,
      browser_url: config.browserUrl,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Setup failed: ${response.statusText}`);
  }
  
  return response.json();
}

export async function executeTask(prompt: string): Promise<TaskResponse> {
  const response = await fetch(`${API_BASE}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  
  if (!response.ok) {
    throw new Error(`Execution failed: ${response.statusText}`);
  }
  
  return response.json();
}

export async function getStatus(): Promise<AgentStatus> {
  const response = await fetch(`${API_BASE}/api/status`);
  
  if (!response.ok) {
    throw new Error(`Status check failed: ${response.statusText}`);
  }
  
  return response.json();
}

export async function getEnvConfig(): Promise<Partial<AgentConfig>> {
  const response = await fetch(`${API_BASE}/api/config`);
  
  if (!response.ok) {
    console.warn('Failed to fetch env config');
    return {};
  }
  
  const data = await response.json();
  return {
    apiKey: data.api_key,
    apiBase: data.api_base,
    model: data.model,
    browserUrl: data.browser_url,
  };
}

export async function getTools(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/tools`);
  
  if (!response.ok) {
    throw new Error(`Failed to get tools: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.tools;
}

export async function clearHistory(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/clear-history`, {
    method: 'POST',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to clear history: ${response.statusText}`);
  }
}

export async function shutdownAgent(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/shutdown`, {
    method: 'POST',
  });
  
  if (!response.ok) {
    throw new Error(`Shutdown failed: ${response.statusText}`);
  }
}

export function createTaskWebSocket(
  onMessage: (event: StreamEvent) => void,
  onError: (error: Error) => void,
  onClose: () => void
): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:8765/api/ws/task`);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as StreamEvent;
      onMessage(data);
    } catch (e) {
      onError(new Error('Failed to parse message'));
    }
  };
  
  ws.onerror = () => {
    onError(new Error('WebSocket error'));
  };
  
  ws.onclose = onClose;
  
  return ws;
}
