import { useState, useRef, useEffect } from 'react';
import type { TaskMessage, ToolCall } from '../types';

interface ChatPanelProps {
  messages: TaskMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function ChatPanel({ messages, onSendMessage, isLoading }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div className="h-14 px-6 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)]/70 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)]" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--text-primary)]">Workspace</div>
            <div className="text-[10px] text-[var(--text-secondary)]">Describe a task and I’ll drive Chrome via MCP</div>
          </div>
        </div>

        <div className="text-[10px] text-[var(--text-secondary)] opacity-80">
          {isLoading ? 'Running…' : 'Idle'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-[var(--bg-tertiary)] scrollbar-track-transparent">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center select-none">
            <p className="text-xl font-semibold text-[var(--text-primary)] mb-2">Browser Agent</p>
            <p className="text-sm text-center max-w-sm text-[var(--text-secondary)]">
              Try: “Open Google and search for Electron security best practices, then summarize the top 3 points.”
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
           <div className="flex justify-start animate-pulse">
             <div className="bg-[var(--bg-secondary)] rounded-2xl rounded-tl-none px-4 py-3 text-[var(--text-secondary)] text-sm">
               Thinking...
             </div>
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
        <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto flex gap-3 items-end">
          <div className="relative flex-1 bg-[var(--bg-primary)] rounded-2xl border border-[var(--border)] focus-within:border-transparent focus-within:ring-2 focus-within:ring-[var(--accent)] transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the browser task..."
              disabled={isLoading}
              rows={1}
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-secondary)] resize-none focus:outline-none max-h-[120px] rounded-2xl"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="h-[46px] px-6 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-2xl transition-colors flex items-center justify-center min-w-[110px]"
          >
            {isLoading ? (
              <LoadingSpinner />
            ) : (
              <span className="flex items-center gap-2">
                Send 
                <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </span>
            )}
          </button>
        </form>
        <div className="text-center mt-2">
           <p className="text-[10px] text-[var(--text-secondary)] opacity-60">
             Press Enter to send, Shift + Enter for new line
           </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: TaskMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
          <span>🔔</span> {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm transition-all ${
          isUser
            ? 'bg-[var(--accent)] text-white rounded-br-none'
            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-bl-none border border-[var(--bg-tertiary)]'
        }`}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed text-sm">
          {message.content || (hasToolCalls ? <span className="italic opacity-70">Executing tools...</span> : '')}
        </div>
        
        {hasToolCalls && (
          <div className="mt-3 space-y-2">
            {message.toolCalls!.map((tool, idx) => (
              <ToolCallItem key={idx} tool={tool} />
            ))}
          </div>
        )}
        
        {message.timestamp && (
          <div className={`text-[10px] mt-1.5 text-right opacity-50 ${isUser ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const [isOpen, setIsOpen] = useState(false);
  const isCompleted = tool.status === 'completed';
  const isError = tool.status === 'error';

  const safeStringify = (value: unknown) => {
    try {
      return JSON.stringify(
        value,
        (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
        2
      );
    } catch {
      try {
        return String(value);
      } catch {
        return '<unserializable>';
      }
    }
  };
  
  return (
    <div className="rounded-lg overflow-hidden border border-[var(--bg-tertiary)] bg-[var(--bg-primary)]/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors text-left"
      >
        <div className="flex items-center gap-2 font-mono text-[var(--text-primary)]">
          <span className="opacity-70">λ</span>
          <span className="font-semibold text-[var(--accent)]">{tool.tool}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
            {tool.status}
          </span>
          {isCompleted ? '✅' : isError ? '❌' : '⏳'}
        </div>
      </button>
      
      {isOpen && (
        <div className="border-t border-[var(--bg-tertiary)] text-xs font-mono">
          {!!tool.input && (
            <div className="p-2 bg-[var(--bg-tertiary)]/20 border-b border-[var(--bg-tertiary)]">
              <span className="text-[var(--text-secondary)] block mb-1">Input:</span>
              <pre className="overflow-x-auto text-[var(--text-primary)]">
                {safeStringify(tool.input)}
              </pre>
            </div>
          )}
          {!!tool.output && (
             <div className="p-2 bg-[var(--bg-tertiary)]/20">
               <span className="text-[var(--text-secondary)] block mb-1">Output:</span>
               <pre className="overflow-x-auto text-[var(--text-primary)] whitespace-pre-wrap">
                 {typeof tool.output === 'string' ? tool.output : safeStringify(tool.output)}
               </pre>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2">
      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span className="text-sm">Processing</span>
    </div>
  );
}
