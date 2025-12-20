#!/bin/bash

# Browser Agent 清理脚本
# 停止所有相关进程，释放端口

echo "🛑 正在停止 Browser Agent 相关进程..."

# 停止 Python 后端服务器 (端口 8765)
echo "停止 Python 后端服务器..."
pkill -f "python main.py" 2>/dev/null || true

# 停止前端开发服务器 (端口 1420)
echo "停止前端开发服务器..."
pkill -f "vite" 2>/dev/null || true
pkill -f "pnpm dev" 2>/dev/null || true

# 停止 Tauri 进程
echo "停止 Tauri 进程..."
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "cargo run" 2>/dev/null || true

# 停止 Chrome 调试实例 (端口 9222)
if [[ "${STOP_CHROME:-0}" == "1" ]]; then
  echo "停止 Chrome 调试实例..."
  pkill -f "remote-debugging-port=9222" 2>/dev/null || true
else
  echo "跳过停止 Chrome 调试实例 (设置 STOP_CHROME=1 可强制关闭)..."
fi

# 清理端口占用
echo "清理端口占用..."
lsof -ti:1420 | xargs kill -9 2>/dev/null || true
lsof -ti:8765 | xargs kill -9 2>/dev/null || true
if [[ "${STOP_CHROME:-0}" == "1" ]]; then
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
fi

echo "✅ 清理完成！"
echo ""
echo "现在可以重新启动应用："
echo "  pnpm tauri dev"
