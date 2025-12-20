import { useAgent } from './hooks/useAgent';
import { SetupPanel, ChatPanel, Sidebar } from './components';

import React from 'react';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('UI crashed:', error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen bg-[var(--bg-primary)] items-center justify-center p-8">
          <div className="max-w-xl w-full bg-[var(--bg-secondary)] border border-[var(--bg-tertiary)] rounded-2xl p-6">
            <div className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              UI Error
            </div>
            <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
              {this.state.errorMessage}
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <button
                onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const {
    status,
    messages,
    isLoading,
    availableTools,
    error,
    setup,
    executeTaskStream,
    clearHistory,
    shutdown,
    clearError,
  } = useAgent();

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-[var(--bg-primary)]">
        <Sidebar
          status={status}
          availableTools={availableTools}
          onClearHistory={clearHistory}
          onShutdown={shutdown}
        />

        <main className="flex-1 flex flex-col">
          {error && (
            <div className="bg-[var(--error)] text-white px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button onClick={clearError} className="text-white hover:opacity-80">
                ✕
              </button>
            </div>
          )}

          {!status.initialized ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <SetupPanel onSetup={setup} isLoading={isLoading} />
            </div>
          ) : (
            <ChatPanel
              messages={messages}
              onSendMessage={executeTaskStream}
              isLoading={isLoading}
            />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
