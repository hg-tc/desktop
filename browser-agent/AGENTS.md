# Browser Agent

基于 LangChain + MCP 的 Chrome 浏览器自动化桌面应用。

## 概述

使用 LangChain 1.0 和 [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp) 实现 LLM 控制 Chrome 浏览器。

### 架构

```
模式 A：本地 UI（开发态，Electron 加载本地 Vite 页面）

┌─────────────────────────────────────────────────────────────┐
│                   Electron Desktop App                       │
├─────────────────────────────────────────────────────────────┤
│  Local UI (Vite/React)                                       │
│  └── WebSocket/HTTP ──► Python Worker (FastAPI)              │
│                              └── LangChain Agent             │
│                                   └── langchain-mcp-adapters │
│                                        └── chrome-devtools-mcp
│                                             └── Chrome Browser
└─────────────────────────────────────────────────────────────┘

模式 B：远程 UI（生产态，Electron 加载远程 Consult 网页，B-Remote + IPC）

┌──────────────────────────────────────────────────────────────────────────────┐
│                              Remote Web UI (Consult)                          │
│                         https://...  (Next.js Web App)                         │
│                               └── window.browserAgent.*                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ contextBridge / IPC (Electron)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Electron Desktop App (Shell)                         │
│  - BrowserWindow 加载远程 URL                                                  │
│  - preload.cjs 暴露 window.browserAgent                                        │
│  - main.cjs ipcMain.handle(...) 代理到本机 Worker                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP: http://127.0.0.1:8765/api/*
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Local Python Worker (FastAPI)             │
│                              └── LangChain Agent             │
│                                   └── chrome-devtools-mcp     │
│                                             └── Chrome        │
└─────────────────────────────────────────────────────────────┘
```

### 核心协作方式（B-Remote + IPC）

- **远程端（Consult Web）**
  - 负责 UI/权限/业务流程
  - 在桌面端运行时通过 `window.browserAgent` 调用本机能力
- **桌面端（Electron）**
  - 负责承载 Web UI + 注入桥接能力
  - 通过 `contextBridge` 安全暴露有限 API（不开放 Node 能力）
  - 通过 IPC 把请求转发到本机 Worker
- **本机 Worker（FastAPI + LangChain）**
  - 负责调用 LLM、连接 MCP、控制 Chrome
  - 提供 `/api/*` HTTP 接口（给 Electron 转发）

### 技术栈

| 层级 | 技术 |
|------|------|
| Desktop | Electron |
| Frontend | React 19 + TypeScript + TailwindCSS 4 |
| Backend | Python 3.11+ + FastAPI + LangChain 1.0 |
| MCP | langchain-mcp-adapters + chrome-devtools-mcp |
| LLM | OpenAI-compatible API |

## 快速开始

### 一键启动

```bash
./start.sh   # 启动 Chrome + 本机 Worker + Electron
./stop.sh    # 停止所有服务（保留 Chrome）
```

默认情况下，`start.sh` 会在没有显式设置远程 URL 时，自动设置：

```bash
CONSULT_WEB_URL="https://ai.ibraintech.top"
```

你也可以在启动时覆盖远程 URL：

```bash
CONSULT_WEB_URL="https://your-domain" ./start.sh
```

### 手动启动

```bash
# 1. 启动 Chrome (带远程调试)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=~/.browser-agent-chrome

# 2. 启动后端
cd python && source .venv/bin/activate && python main.py

# 3A. 启动 Electron（本地 UI 开发态：会自动启动前端 dev server）
pnpm dev:electron

# 3B. 启动 Electron（远程 UI：不启动本地前端 dev server）
pnpm dev:electron:remote
```

### 环境配置

复制 `python/.env.example` 到 `python/.env`：

```bash
OPENAI_API_KEY=your-api-key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
SERVER_HOST=127.0.0.1
SERVER_PORT=8765
CHROME_DEBUG_URL=http://127.0.0.1:9222  # 可选，连接已有 Chrome
```

桌面端（Electron）使用的环境变量（通常在 shell 里 `export`，或由 `start.sh` 注入）：

```bash
# 远程 UI URL（二选一）
CONSULT_WEB_URL=https://ai.ibraintech.top
# BROWSER_AGENT_REMOTE_URL=https://ai.ibraintech.top

# 本机 Worker 地址（可选，默认 http://127.0.0.1:8765）
BROWSER_AGENT_WORKER_URL=http://127.0.0.1:8765
```

## 关键数据流

### 远程 UI 调用本机执行（同步）

1. Consult 网页调用：`window.browserAgent.execute({ prompt })`
2. Electron `preload.cjs` 将调用转为 `ipcRenderer.invoke('browserAgent:execute', payload)`
3. Electron `main.cjs` 的 `ipcMain.handle('browserAgent:execute', ...)` 将请求转发到本机 Worker：
   - `POST http://127.0.0.1:8765/api/execute`
4. Worker 执行 LangChain Agent -> MCP -> Chrome，返回结果
5. Electron 把结果回传给网页

### 远程 UI 授权（P2 Desktop Grant）

远程 UI（Consult）在调用本机能力前，会先完成一次“服务端签发短期授权 → 桌面端校验并缓存授权”的流程：

1. Consult 调用后端：`POST /api/apps/desktop-grant` 获取短期 grant（JWT）
2. Consult 调用桌面端：`window.browserAgent.authorize({ access_token, grant })`
3. Electron 主进程调用后端：`POST /api/apps/desktop-grant/verify` 校验 grant
4. 校验通过后，Electron 在本地缓存本次授权状态，后续 `window.browserAgent.*` 调用才会放行

后端 `verify` 会返回可观测性 headers：

- **`X-Grant-Issuer`**：签发/校验所在实例标识（hostname:pid）
- **`X-Secret-Fp`**：服务端 `SECRET_KEY` 指纹（用于排查不同实例密钥不一致）
- **`X-Server-Now`**：服务端当前 Unix 时间戳（用于排查时钟/时区问题）

常见失败原因：

- **`reason=expired`**：grant 过期。若 “刚签发立刻 expired”，通常是服务端签发时的 `iat/exp` 时间戳计算错误（时区/naive datetime）。服务端签发应使用 Unix 时间戳（如 `time.time()`）生成 `iat/exp`。
- **`reason=decode_error`**：验签失败（通常是密钥不一致/token 被污染）。

### IPC Bridge（window.browserAgent）

桌面端会注入以下 API（远程 UI 可直接使用）：

- **`browserAgent.status()`** -> `GET /api/status`
- **`browserAgent.config()`** -> `GET /api/config`（Electron 会做脱敏：不直接暴露 `api_key`，返回 `has_api_key`）
- **`browserAgent.setup(payload)`** -> `POST /api/setup`
- **`browserAgent.execute({ prompt })`** -> `POST /api/execute`
- **`browserAgent.tools()`** -> `GET /api/tools`
- **`browserAgent.clearHistory()`** -> `POST /api/clear-history`
- **`browserAgent.shutdown()`** -> `POST /api/shutdown`

另外保留：

- **`browserAgentDesktop.openExternal(url)`**
- **`browserAgentDesktop.getAppVersion()`**

## 项目结构

```
browser-agent/
├── electron/                  # Electron 主进程/Preload
│   ├── main.cjs               # Electron main
│   └── preload.cjs            # Electron preload
├── python/                    # Python 后端
│   ├── agent/
│   │   ├── browser_agent.py   # LangChain Agent 核心
│   │   └── mcp_client.py      # MCP 客户端封装
│   ├── api/
│   │   └── routes.py          # FastAPI 路由
│   └── main.py                # 服务入口
├── src/                       # React 前端
│   ├── components/            # UI 组件
│   ├── hooks/useAgent.ts      # Agent 状态管理
│   ├── lib/api.ts             # API 客户端
│   └── types/                 # TypeScript 类型
├── start.sh / stop.sh         # 启动/停止脚本
└── AGENTS.md                  # 本文件

consult/frontend/               # 远程 Web UI（Next.js）
├── app/ai/page.tsx             # AI 能力中心页（已注入 DesktopBridgePanel）
└── components/desktop-bridge-panel.tsx  # 桌面桥接测试面板（仅桌面端显示）
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/setup` | 初始化 Agent |
| POST | `/api/execute` | 执行任务 (同步) |
| WS | `/api/ws/task` | 执行任务 (流式) |
| GET | `/api/status` | 获取状态 |
| GET | `/api/tools` | 获取工具列表 |
| POST | `/api/clear-history` | 清除对话历史 |
| POST | `/api/shutdown` | 关闭 Agent |

## 常见问题排查

### 点击执行没效果 / 本机 Worker 返回 400

如果本机 Worker 日志出现：

- `GET /api/tools 400 Bad Request`
- `POST /api/execute 400 Bad Request`

通常是因为 **Agent 尚未初始化**：Worker 侧要求先调用 `POST /api/setup`，否则 `/api/tools`、`/api/execute` 会返回：`Agent not initialized. Call /setup first.`

建议的最短验证顺序：

1. `window.browserAgent.status()` 确认 `initialized`
2. `window.browserAgent.setup({ ... })` 初始化
3. `window.browserAgent.tools()` / `window.browserAgent.execute({ prompt })`

### Console 最小自检脚本（远程 UI 模式）

在 Electron 窗口 DevTools Console 执行：

```js
await window.browserAgent.status();
await window.browserAgent.setup({});
await window.browserAgent.execute({ prompt: "打开 https://example.com 并告诉我标题" });
```

如果 `setup/execute` 返回对象包含 `error` 字段，优先根据该错误排查：

- OpenAI API Key/模型配置是否存在（`python/.env`）
- Chrome 调试端口是否可用（默认 `http://127.0.0.1:9222`）

### Network 面板看不到 verify 请求

Electron 主进程发起的网络请求不会出现在渲染进程 DevTools 的 Network 面板。

如需抓包查看 `/api/apps/desktop-grant/verify` 返回的 `reason`/headers，可在 Console 里用 `fetch(...)` 从页面发起请求，或在主进程打印日志。

## MCP 工具

通过 chrome-devtools-mcp 提供的工具：

| 类别 | 工具 |
|------|------|
| **输入** | `click`, `fill`, `fill_form`, `hover`, `press_key`, `drag` |
| **导航** | `navigate_page`, `new_page`, `close_page`, `list_pages`, `select_page` |
| **快照** | `take_snapshot` (DOM 树), `take_screenshot` (截图) |
| **调试** | `evaluate_script`, `list_console_messages` |
| **网络** | `list_network_requests`, `get_network_request` |
| **自定义** | `wait` (等待指定秒数) |

### 工具使用最佳实践

1. **先 snapshot 后交互**：`click`/`fill` 等工具需要先调用 `take_snapshot` 获取元素 UID
2. **遇到 "No snapshot found" 错误**：调用 `take_snapshot` 后重试
3. **闲聊不触发工具**：简单问答直接回复，不调用浏览器工具

## 开发指南

### 代码风格

**Python**
- async/await 用于所有 I/O 操作
- 类型注解必须
- PEP 8 命名规范

**TypeScript**
- 函数式组件 + Hooks
- `type` 优于 `interface`
- TailwindCSS + CSS 变量

### 常见任务

**添加 API 端点**
1. `python/api/routes.py` 添加路由
2. `src/lib/api.ts` 添加客户端函数
3. `src/types/index.ts` 添加类型定义

**修改 Agent 行为**
- 编辑 `python/agent/browser_agent.py` 中的 `SYSTEM_PROMPT`

## 安全注意事项

- 不要提交包含真实 API Key 的 `.env` 文件
- Agent 有完整浏览器控制权限，避免在敏感页面运行
- WebSocket 默认仅本地访问
- 远程 UI 模式下，Electron 会对允许导航的 origin 做白名单限制；非白名单链接会在系统浏览器中打开
