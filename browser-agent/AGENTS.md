# Browser Agent

基于 LangChain + MCP 的 Chrome 浏览器自动化桌面应用。

## 概述

使用 LangChain 1.0 和 [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp) 实现 LLM 控制 Chrome 浏览器。

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Electron Desktop App                       │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript + TailwindCSS)                │
│  └── WebSocket/HTTP ──► Python Backend (FastAPI)            │
│                              └── LangChain Agent            │
│                                   └── langchain-mcp-adapters │
│                                        └── chrome-devtools-mcp
│                                             └── Chrome Browser
└─────────────────────────────────────────────────────────────┘
```

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
./start.sh   # 启动 Chrome + 后端 + 前端
./stop.sh    # 停止所有服务（保留 Chrome）
```

### 手动启动

```bash
# 1. 启动 Chrome (带远程调试)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=~/.browser-agent-chrome

# 2. 启动后端
cd python && source .venv/bin/activate && python main.py

# 3. 启动 Electron (会自动启动前端 dev server)
pnpm dev:electron
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
