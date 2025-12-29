"""
Browser Agent - LangChain 1.0 + MCP for Chrome automation.

Simple, clean implementation following LangChain best practices:
- Uses langchain-mcp-adapters for MCP tool integration
- Uses create_agent for agent creation
- Uses InMemorySaver for short-term memory
- Streaming support via astream with stream_mode="messages" for token streaming
"""

import asyncio
import logging
import os
import time
import uuid
from typing import Any, AsyncGenerator, Optional

from .mcp_client import MCPClientManager


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(handler)
logger.propagate = False


class BrowserAgent:
    """Pure MCP executor (no LLM).

    This class intentionally does NOT do any prompt planning or LLM inference.
    The server (Consult) is responsible for tool planning and calls the desktop
    worker to execute atomic MCP tools.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        model: str = "gpt-4o",
        temperature: float = 0.0,
    ):
        # Keep these fields for backward compatibility with existing setup payloads.
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.api_base = api_base or os.getenv("OPENAI_API_BASE")
        self.model_name = model or os.getenv("OPENAI_MODEL", "gpt-4o")
        self.temperature = temperature

        self.mcp_manager = MCPClientManager()
        self._thread_id = str(uuid.uuid4())
        self._browser_url: Optional[str] = None

    async def setup(self, browser_url: Optional[str] = None) -> None:
        """Initialize MCP connection (stateful session)."""
        self._browser_url = browser_url
        await self.mcp_manager.connect(browser_url)

        tools = list(self.mcp_manager.tools)
        tool_names = [getattr(t, "name", str(t)) for t in tools]
        logger.info("Loaded %d MCP tools (executor mode): %s", len(tools), tool_names)

    async def execute(self, task: str) -> dict[str, Any]:
        raise RuntimeError("LLM planning is disabled on desktop. Use call_tool instead.")

    async def execute_stream(self, task: str) -> AsyncGenerator[dict, None]:
        raise RuntimeError("LLM planning is disabled on desktop. Use call_tool instead.")

    def clear_history(self) -> None:
        """Clear chat history by creating a new thread."""
        self._thread_id = str(uuid.uuid4())

    async def get_available_tools(self) -> list[str]:
        """Get list of available tool names."""
        return await self.mcp_manager.get_tool_names()

    async def call_tool(self, tool_name: str, args: Optional[dict] = None) -> Any:
        if not self.mcp_manager.is_connected:
            raise RuntimeError("Executor not initialized. Call setup() first.")
        if not isinstance(tool_name, str) or not tool_name.strip():
            raise ValueError("Missing tool_name")
        safe_args = args if isinstance(args, dict) else {}

        tool = None
        for t in self.mcp_manager.tools:
            if getattr(t, "name", None) == tool_name:
                tool = t
                break
        if tool is None:
            raise ValueError(f"Unknown tool: {tool_name}")

        return await tool.ainvoke(safe_args)

    def is_compatible_config(
        self,
        api_key: Optional[str],
        api_base: Optional[str],
        model: str,
        browser_url: Optional[str],
    ) -> bool:
        """Check if current config matches the given config."""
        # In executor mode, we only care whether the MCP session is already connected.
        # We keep the signature for backward compatibility with existing callers.
        _ = api_key
        _ = api_base
        _ = model
        return self.mcp_manager.is_connected and (browser_url or os.getenv("CHROME_DEBUG_URL")) == self._browser_url

    async def close(self) -> None:
        """Clean up resources."""
        await self.mcp_manager.disconnect()
        self._browser_url = None

    async def __aenter__(self):
        await self.setup()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
