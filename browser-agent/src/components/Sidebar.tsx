import type { AgentStatus } from '../types';

interface SidebarProps {
  status: AgentStatus;
  availableTools: string[];
  onClearHistory: () => void;
  onShutdown: () => void;
}

export function Sidebar({ status, availableTools, onClearHistory, onShutdown }: SidebarProps) {
  return (
    <div className="w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col h-full transition-all duration-300">
      <div className="p-6 border-b border-[var(--border)] bg-[var(--bg-secondary)]/40 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl" />
          <div>
            <h1 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Browser Agent</h1>
            <p className="text-[10px] text-[var(--text-secondary)] font-medium tracking-wider">LANGCHAIN + MCP</p>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-[var(--border)]">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3 px-1">
          System Status
        </h2>
        <div className="space-y-2 bg-[var(--bg-tertiary)] p-2 rounded-xl border border-[var(--border)]">
          <StatusItem label="Agent Core" active={status.initialized} />
          <StatusItem label="Browser Link" active={status.connected} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[var(--bg-tertiary)] scrollbar-track-transparent">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3 px-1 flex justify-between items-center">
          <span>Active Tools</span>
          <span className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-[10px] px-1.5 py-0.5 rounded-full">
            {availableTools.length}
          </span>
        </h2>
        
        {availableTools.length > 0 ? (
          <div className="grid grid-cols-1 gap-1.5">
            {availableTools.map((tool) => (
              <div
                key={tool}
                className="group flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] px-2 py-1.5 rounded transition-colors cursor-default"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-50 group-hover:opacity-100 transition-opacity"></span>
                <span className="truncate font-mono">{tool}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--text-secondary)] opacity-50 text-center py-4 italic">
            No tools connected
          </div>
        )}
      </div>

      <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-secondary)] space-y-2">
        <button
          onClick={onClearHistory}
          disabled={!status.initialized}
          className="w-full py-2.5 px-3 text-xs font-medium bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/70 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-primary)] rounded-xl transition-all flex items-center justify-center gap-2 group border border-[var(--border)]"
        >
          <svg className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Clear History
        </button>
        <button
          onClick={onShutdown}
          disabled={!status.initialized}
          className="w-full py-2.5 px-3 text-xs font-medium bg-[var(--error)]/10 hover:bg-[var(--error)] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-[var(--error)] rounded-xl transition-all flex items-center justify-center gap-2 group border border-[var(--error)]/20 hover:border-transparent"
        >
          <svg className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Shutdown Agent
        </button>
      </div>
    </div>
  );
}

function StatusItem({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${active ? 'bg-[var(--success)]' : 'bg-[var(--text-secondary)]/50'}`} />
        <span className={`text-[10px] font-medium ${active ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'}`}>
          {active ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
    </div>
  );
}
