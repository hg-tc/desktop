# Browser Agent

基于 LangChain + MCP 的 Chrome 浏览器自动化桌面应用。

## Features

- 🤖 **AI 驱动**: 使用 LangChain 1.0 + OpenAI 兼容 API
- 🌐 **浏览器控制**: 通过 chrome-devtools-mcp 实现完整的 Chrome 控制
- 🖥️ **桌面应用**: Electron 桌面壳，支持加载本地 UI 或远程 Consult UI
- 🔄 **远程 UI + 本机能力**: 远程 Web（Consult）通过 Electron bridge 调用本机 Worker 能力

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Chrome browser

### Installation

```bash
# Install Node dependencies
pnpm install

# (Dev only) Install Python dependencies
cd python && pip install -r requirements.txt

# (Dev only) Copy environment config
cp .env.example .env
# Edit python/.env with your API key
```

## 启动方式

本项目有两种运行模式：

- **开发模式（本地 UI）**：Electron 加载本地 Vite 页面，适合开发/调试桌面端 UI。
- **生产模式（远程 UI）**：Electron 加载远程 Consult 页面（Next.js），桌面端只提供 bridge + 本机 Worker/MCP 能力。

### 方式 A：一键启动（推荐）

`start.sh` 会负责：

- 启动/复用带远程调试的 Chrome（默认端口 `9222`）
- 启动 Python Worker（默认端口 `8765`）
- 启动 Electron

```bash
./start.sh
```

它会根据环境变量自动选择 Electron 模式：

- 如果设置了 `CONSULT_WEB_URL`（或 `BROWSER_AGENT_REMOTE_URL`），则走 **生产模式（远程 UI）**
- 否则走 **开发模式（本地 UI）**

示例：强制使用远程 Consult UI

```bash
CONSULT_WEB_URL="https://ai.ibraintech.top" ./start.sh
```

### 方式 B：开发模式（本地 UI）

适合开发桌面端本地 UI。

```bash
# 1) 启动 Python Worker
cd python && source .venv/bin/activate && python main.py

# 2) 启动 Electron（会同时启动 Vite 并等待 http://localhost:1420）
pnpm dev:electron
```

### 方式 C：生产模式（远程 Consult UI）

适合验证“远程 Consult + 桌面端 bridge + 本机 Worker”的完整链路。

```bash
# 1) 启动 Python Worker
cd python && source .venv/bin/activate && python main.py

# 2) 启动 Electron（不启动 Vite，本地窗口会加载远程 URL）
CONSULT_WEB_URL="https://ai.ibraintech.top" pnpm dev:electron:remote
```

## 打包（生产安装包）

打包会将 Electron、`python/`、以及必要的 `resources/*` 一起打入安装包。

### 从 git clone 到打包产物（按平台分别打包）

本项目**不建议跨平台打包**：

- 在 **macOS** 上打包得到 macOS 产物（`.zip` 包含 `.app`）
- 在 **Windows** 上打包得到 Windows 产物（`portable` 单文件 `.exe`）

因为打包过程会准备/内置与平台相关的资源（例如嵌入式 Python runtime、`xiaohongshu-mcp` 二进制等），跨平台打包容易导致产物在目标系统上无法运行。

#### macOS 打包（生成 `.zip`）

```bash
# 1) 获取代码
git clone <your-repo-url>
cd browser-agent

# 2) 安装依赖
pnpm install

# 3) 打包
pnpm dist:app
```

产物输出目录：

- `./release/`

典型产物文件名示例：

- `browser-agent-<version>-arm64-mac.zip`

#### Windows 打包（生成 `portable` 单文件 `.exe`）

在 Windows 机器上（PowerShell / CMD 均可）执行：

```bash
# 1) 获取代码
git clone <your-repo-url>
cd browser-agent

# 2) 安装依赖
pnpm install

# 3) 打包
pnpm dist:app
```

产物输出目录：

- `./release/`

典型产物文件名示例：

- `browser-agent-<version>.exe`

如果你的仓库中包含 `xiaohongshu-mcp` 源码并希望在打包时一并构建它，则 Windows 打包机需要安装 `go`（否则会跳过该二进制的构建）。

```bash
# 生成 release 目录（不生成安装包）
pnpm pack

# 生成安装包（dmg/exe 等）
pnpm dist
```

### 内部测试打包（免安装分发）

当前 `electron-builder` 配置已针对内部测试做了默认产物选择：

- **macOS**：输出 `zip`（包含 `.app`，解压即可运行）
- **Windows**：输出 `portable`（单文件 `.exe`，免安装）

在对应平台执行：

```bash
pnpm dist:app
```

产物输出目录：

- `./release/`

分发说明：

- **macOS**：把 `release/` 下生成的 `*.zip` 发给同事，解压后双击 `.app` 运行（未签名内测包可能需要右键“打开”一次）。
- **Windows**：把 `release/` 下生成的 `*.exe` 发给同事，双击运行即可。

注意事项：

- **需要安装 Chrome**（通过 remote debugging + MCP 控制浏览器）。
- **桌面端不需要配置 LLM Key**：桌面 Worker 只负责执行原子 MCP tools，规划/推理由服务端（Consult）统一完成。

如果你修改了 `python/` 或 `resources/*`（比如 routes、内置 python-site-packages、xiaohongshu-mcp 二进制等），并且你在用 **已安装的打包 App** 测试，那么需要重新 `pnpm dist` 才会生效。

## Documentation

See [AGENTS.md](./AGENTS.md) for detailed project documentation.

## Tech Stack

- **Desktop**: Electron
- **Frontend**: React 19 + TypeScript + TailwindCSS
- **Backend**: Python + FastAPI + LangChain
- **Browser**: chrome-devtools-mcp

## License

MIT
