"""
MCP Client Manager for chrome-devtools-mcp integration.

Uses client.session() for stateful tool usage to maintain snapshot state
across tool calls (required for chrome-devtools-mcp).
"""

import logging
from typing import Any, Optional
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools


logger = logging.getLogger(__name__)


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

        self._client = MultiServerMCPClient({
            "chrome": {
                "transport": "stdio",
                "command": "/opt/homebrew/bin/node",
                "args": ["/opt/homebrew/bin/npx"] + args,
            }
        })

        # Use client.session() for stateful tool usage
        # This maintains snapshot state across tool calls
        self._session_context = self._client.session("chrome")
        self._session = await self._session_context.__aenter__()
        
        # Load tools from the persistent session
        self._tools = await load_mcp_tools(self._session)
        self._connected = True
        logger.info("MCP client connected (stateful session mode, %d tools)", len(self._tools))

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
