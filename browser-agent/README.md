# Browser Agent

基于 LangChain + MCP 的 Chrome 浏览器自动化桌面应用。

## Features

- 🤖 **AI 驱动**: 使用 LangChain 1.0 + OpenAI 兼容 API
- 🌐 **浏览器控制**: 通过 chrome-devtools-mcp 实现完整的 Chrome 控制
- 🖥️ **桌面应用**: Tauri 2.x 构建，轻量高效
- 🔄 **数据互通**: 支持与现有网站服务器同步数据

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Rust (for Tauri)
- Chrome browser

### Installation

```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node dependencies
pnpm install

# Install Python dependencies
cd python && pip install -r requirements.txt

# Copy environment config
cp .env.example .env
# Edit .env with your API key
```

### Development

```bash
# Terminal 1: Start Python backend
cd python && python main.py

# Terminal 2: Start Tauri app
pnpm tauri dev
```

## Documentation

See [AGENTS.md](./AGENTS.md) for detailed project documentation.

## Tech Stack

- **Desktop**: Tauri 2.x
- **Frontend**: React 19 + TypeScript + TailwindCSS
- **Backend**: Python + FastAPI + LangChain
- **Browser**: chrome-devtools-mcp

## License

MIT
