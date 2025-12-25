import { useState, useEffect } from 'react';
import type { AgentConfig } from '../types';
import { getEnvConfig } from '../lib/api';

interface SetupPanelProps {
  onSetup: (config: AgentConfig) => Promise<unknown>;
  isLoading: boolean;
}

export function SetupPanel({ onSetup, isLoading }: SetupPanelProps) {
  const [config, setConfig] = useState<AgentConfig>({
    apiKey: '',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    browserUrl: '',
  });

  useEffect(() => {
    const loadConfig = async () => {
      // 1. Load from localStorage
      const saved = localStorage.getItem('agent_config');
      let localConfig: Partial<AgentConfig> = {};
      if (saved) {
        try {
          localConfig = JSON.parse(saved);
        } catch (e) {
          // ignore invalid json
        }
      }

      // 2. Load from backend .env
      try {
        const envConfig = await getEnvConfig();
        
        setConfig(prev => ({
          ...prev,
          ...envConfig, // Apply env config first (defaults)
          ...localConfig, // Override with user saved config
          // If env has value and local doesn't, env wins.
          // If local has value, it wins (user override).
          // But wait, user wants .env to be read automatically. 
          // If the user explicitly saved something, we should probably respect it, 
          // OR we can prioritize env if the local key is empty.
          // Let's do a smart merge:
          apiKey: envConfig.apiKey || localConfig.apiKey || prev.apiKey,
          apiBase: envConfig.apiBase || localConfig.apiBase || prev.apiBase,
          model: envConfig.model || localConfig.model || prev.model,
          browserUrl: envConfig.browserUrl || localConfig.browserUrl || prev.browserUrl,
        }));
      } catch (e) {
        // If backend fetch fails, just use local
        if (Object.keys(localConfig).length > 0) {
           setConfig(prev => ({ ...prev, ...localConfig }));
        }
      }
    };

    loadConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('agent_config', JSON.stringify(config));
    await onSetup(config);
  };

  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl p-8 max-w-md w-full mx-auto border border-[var(--border)] shadow-[var(--shadow-soft)]">
      <div className="text-center mb-8">
        <div className="w-12 h-12 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-2xl flex items-center justify-center mx-auto mb-4 text-[var(--text-primary)] text-sm font-semibold">
          BA
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">
          Browser Agent Setup
        </h2>
        <p className="text-[var(--text-secondary)] mt-2 text-sm">
          Configure your LLM provider and browser connection
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            API Key <span className="text-[var(--error)]">*</span>
          </label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            className="w-full px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all"
            placeholder="sk-..."
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              API Base URL
            </label>
            <input
              type="url"
              value={config.apiBase}
              onChange={(e) => setConfig({ ...config, apiBase: e.target.value })}
              className="w-full px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              Model
            </label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all"
              placeholder="gpt-4o"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            Browser URL (Optional)
          </label>
          <input
            type="text"
            value={config.browserUrl}
            onChange={(e) => setConfig({ ...config, browserUrl: e.target.value })}
            className="w-full px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all"
            placeholder="http://127.0.0.1:9222"
          />
          <p className="text-xs text-[var(--text-secondary)] mt-1.5 opacity-80">
            Leave empty to launch a new Chrome instance automatically
          </p>
        </div>

        <button
          type="submit"
          disabled={isLoading || !config.apiKey}
          className="w-full py-3 px-4 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 mt-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Initializing...
            </>
          ) : (
            'Connect & Start'
          )}
        </button>
      </form>
    </div>
  );
}
