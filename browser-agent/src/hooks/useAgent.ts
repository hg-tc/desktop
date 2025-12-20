import { useState, useCallback, useRef } from 'react';
import type { AgentConfig, AgentStatus, TaskMessage, StreamEvent, ToolCall } from '../types';
import * as api from '../lib/api';

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus>({ initialized: false, connected: false });
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const currentMessageRef = useRef<TaskMessage | null>(null);

  const setup = useCallback(async (config: AgentConfig) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.setupAgent(config);
      setStatus({ initialized: true, connected: true });
      setAvailableTools(response.available_tools);
      
      setMessages([{
        id: crypto.randomUUID(),
        role: 'system',
        content: `Agent initialized with ${response.available_tools.length} tools available.`,
        timestamp: new Date(),
      }]);
      
      return response;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Setup failed';
      setError(errorMsg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const executeTask = useCallback(async (prompt: string) => {
    if (!status.initialized) {
      setError('Agent not initialized');
      return;
    }

    setIsLoading(true);
    setError(null);

    const userMessage: TaskMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await api.executeTask(prompt);
      
      const assistantMessage: TaskMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.output,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      
      if (!response.success && response.error) {
        setError(response.error);
      }
      
      return response;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Execution failed';
      setError(errorMsg);
      
      const errorMessage: TaskMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${errorMsg}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [status.initialized]);

  const executeTaskStream = useCallback((prompt: string) => {
    if (!status.initialized) {
      setError('Agent not initialized');
      return;
    }

    setIsLoading(true);
    setError(null);

    const userMessage: TaskMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    const assistantMessage: TaskMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      toolCalls: [],
    };
    currentMessageRef.current = assistantMessage;
    setMessages(prev => [...prev, assistantMessage]);

    const ws = api.createTaskWebSocket(
      (event: StreamEvent) => {
        if (!currentMessageRef.current) return;

        switch (event.type) {
          case 'token':
            currentMessageRef.current.content += event.content || '';
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...currentMessageRef.current! };
              }
              return updated;
            });
            break;

          case 'tool_start':
            const toolCall: ToolCall = {
              tool: event.tool || '',
              input: event.input,
              status: 'running',
            };
            currentMessageRef.current.toolCalls = [
              ...(currentMessageRef.current.toolCalls || []),
              toolCall,
            ];
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...currentMessageRef.current! };
              }
              return updated;
            });
            break;

          case 'tool_end':
            if (currentMessageRef.current.toolCalls) {
              const lastToolIdx = currentMessageRef.current.toolCalls.length - 1;
              if (lastToolIdx >= 0) {
                currentMessageRef.current.toolCalls[lastToolIdx].output = event.output;
                currentMessageRef.current.toolCalls[lastToolIdx].status = 'completed';
              }
            }
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...currentMessageRef.current! };
              }
              return updated;
            });
            break;

          case 'done':
            setIsLoading(false);
            currentMessageRef.current = null;
            break;

          case 'error':
            setError(event.error || 'Unknown error');
            setIsLoading(false);
            currentMessageRef.current = null;
            break;
        }
      },
      (error) => {
        setError(error.message);
        setIsLoading(false);
      },
      () => {
        setIsLoading(false);
      }
    );

    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ prompt }));
    };
  }, [status.initialized]);

  const clearHistory = useCallback(async () => {
    try {
      await api.clearHistory();
      setMessages([]);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to clear history';
      setError(errorMsg);
    }
  }, []);

  const shutdown = useCallback(async () => {
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      await api.shutdownAgent();
      setStatus({ initialized: false, connected: false });
      setMessages([]);
      setAvailableTools([]);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Shutdown failed';
      setError(errorMsg);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const newStatus = await api.getStatus();
      setStatus(newStatus);
      return newStatus;
    } catch {
      setStatus({ initialized: false, connected: false });
      return { initialized: false, connected: false };
    }
  }, []);

  return {
    status,
    messages,
    isLoading,
    availableTools,
    error,
    setup,
    executeTask,
    executeTaskStream,
    clearHistory,
    shutdown,
    checkStatus,
    clearError: () => setError(null),
  };
}
