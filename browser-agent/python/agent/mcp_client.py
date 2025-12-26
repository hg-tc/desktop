"""
MCP Client Manager for chrome-devtools-mcp integration.

Uses client.session() for stateful tool usage to maintain snapshot state
across tool calls (required for chrome-devtools-mcp).
"""

import asyncio
import logging
import os
import shutil
import time
from typing import Any, Optional
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_core.tools import BaseTool, StructuredTool


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(handler)
logger.propagate = False


_TOOL_TIMEOUT_DEFAULT_SECONDS = int(os.getenv("TOOL_TIMEOUT_SECONDS", "20"))

_TOOL_TIMEOUTS_SECONDS: dict[str, int] = {
    "click": int(os.getenv("CLICK_TIMEOUT_SECONDS", "5")),
    "fill": int(os.getenv("FILL_TIMEOUT_SECONDS", "8")),
    "fill_form": int(os.getenv("FILL_FORM_TIMEOUT_SECONDS", "12")),
    "press_key": int(os.getenv("PRESS_KEY_TIMEOUT_SECONDS", "8")),
    "navigate_page": int(os.getenv("NAVIGATE_TIMEOUT_SECONDS", "15")),
}


def _wrap_tool_with_hard_timeout(tool: BaseTool, timeout_seconds: int) -> BaseTool:
    """Wrap an MCP tool with a hard timeout.

    Notes:
    - We intentionally do NOT use asyncio.wait_for(). If the underlying coroutine
      ignores cancellation, wait_for can still hang.
    - This wrapper returns on timeout regardless, so the agent can recover.
    """

    tool_name = getattr(tool, "name", "") or type(tool).__name__

    async def _invoke_with_timeout(**kwargs: Any) -> Any:
        start = time.time()
        logger.info("%s wrapper start timeout=%ss", tool_name, timeout_seconds)

        task = asyncio.create_task(tool.ainvoke(kwargs))

        def _swallow_task_result(t: asyncio.Task) -> None:
            try:
                _ = t.result()
            except Exception:
                return

        task.add_done_callback(_swallow_task_result)

        done, _pending = await asyncio.wait({task}, timeout=timeout_seconds)
        if task in done:
            result = await task
            logger.info("%s wrapper done in %.2fs", tool_name, time.time() - start)
            return result

        logger.warning("%s wrapper HARD TIMEOUT after %.2fs", tool_name, time.time() - start)
        task.cancel()
        return (
            f"Tool '{tool_name}' timed out after {timeout_seconds}s. "
            "The page may be loading, the target may be unclickable/unfillable, or the browser is blocked. "
            "Try take_snapshot and retry with a different target."
        )

    return StructuredTool.from_function(
        coroutine=_invoke_with_timeout,
        name=getattr(tool, "name", tool_name),
        description=getattr(tool, "description", ""),
        args_schema=getattr(tool, "args_schema", None),
    )


class MCPClientManager:
    """Manages MCP client connections to chrome-devtools-mcp server."""

    def __init__(self):
        self._client: Optional[MultiServerMCPClient] = None
        self._session: Any = None
        self._session_context: Any = None
        self._tools: list = []
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def tools(self) -> list:
        return self._tools

    async def connect(self, browser_url: Optional[str] = None) -> None:
        """
        Connect to chrome-devtools-mcp server with stateful session.
        
        Args:
            browser_url: Optional URL to connect to existing Chrome instance.
                        e.g., "http://127.0.0.1:9222"
        """
        if self._connected:
            return

        args = ["-y", "chrome-devtools-mcp@latest"]
        if browser_url:
            args.append(f"--browser-url={browser_url}")
        npx_cmd = os.getenv("MCP_NPX_COMMAND") or shutil.which("npx")

        if not npx_cmd:
            raise RuntimeError(
                "Cannot find 'npx' in PATH. Install Node.js (which provides npx), "
                "or set MCP_NPX_COMMAND environment variable."
            )

        command = npx_cmd
        command_args = args

        self._client = MultiServerMCPClient({
            "chrome": {
                "transport": "stdio",
                "command": command,
                "args": command_args,
            }
        })

        # Use client.session() for stateful tool usage
        # This maintains snapshot state across tool calls
        self._session_context = self._client.session("chrome")
        self._session = await self._session_context.__aenter__()
        
        # Load tools from the persistent session
        tools = await load_mcp_tools(self._session)

        # Apply hard timeouts to selected high-risk tools (can hang indefinitely)
        wrapped_tools: list[BaseTool] = []
        wrapped_names: list[str] = []
        for t in tools:
            name = getattr(t, "name", None)
            if name and name in _TOOL_TIMEOUTS_SECONDS:
                wrapped_tools.append(_wrap_tool_with_hard_timeout(t, _TOOL_TIMEOUTS_SECONDS[name]))
                wrapped_names.append(f"{name}={_TOOL_TIMEOUTS_SECONDS[name]}s")
            else:
                wrapped_tools.append(t)

        self._tools = wrapped_tools
        self._connected = True
        logger.info("MCP client connected (stateful session mode, %d tools)", len(self._tools))
        logger.info("tool timeouts enabled: %s", ", ".join(wrapped_names) if wrapped_names else "none")

    async def disconnect(self) -> None:
        """Disconnect from MCP server."""
        if self._session_context:
            try:
                await self._session_context.__aexit__(None, None, None)
            except Exception:
                pass
            self._session_context = None
            self._session = None
        self._client = None
        self._tools = []
        self._connected = False

    async def get_tool_names(self) -> list[str]:
        """Get list of available tool names."""
        return [tool.name for tool in self._tools]

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()
