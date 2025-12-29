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
import re
import time
import uuid
from hashlib import sha256
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
        self._last_snapshot_text: Optional[str] = None
        self._last_snapshot_hash: Optional[str] = None

    def _postprocess_snapshot_text(
        self,
        text: str,
        *,
        compact: bool,
        keywords: list[str],
        context_lines: int,
        max_chars: int,
        delta: bool,
    ) -> str:
        raw = text or ""
        raw_hash = sha256(raw.encode("utf-8", errors="ignore")).hexdigest()

        lines = raw.splitlines()

        def _is_interactive_line(line: str) -> bool:
            l = line.lower()
            return any(
                k in l
                for k in (
                    "button",
                    "link",
                    "textbox",
                    "input",
                    "checkbox",
                    "radio",
                    "combobox",
                    "select",
                    "menu",
                    "tab",
                    "dialog",
                    "option",
                )
            )

        kept_indices: set[int] = set()
        if compact:
            for i, line in enumerate(lines):
                if _is_interactive_line(line):
                    start = max(0, i - context_lines)
                    end = min(len(lines), i + context_lines + 1)
                    kept_indices.update(range(start, end))

        if keywords:
            try:
                pattern = re.compile("|".join(re.escape(k) for k in keywords), re.IGNORECASE)
            except re.error:
                pattern = None
            if pattern:
                for i, line in enumerate(lines):
                    if pattern.search(line):
                        start = max(0, i - context_lines)
                        end = min(len(lines), i + context_lines + 1)
                        kept_indices.update(range(start, end))

        if kept_indices:
            filtered_lines = [lines[i] for i in sorted(kept_indices)]
        else:
            filtered_lines = lines

        filtered = "\n".join(filtered_lines)
        truncated = False
        if max_chars > 0 and len(filtered) > max_chars:
            filtered = filtered[:max_chars]
            truncated = True

        if delta:
            prev_hash = self._last_snapshot_hash
            prev_text = self._last_snapshot_text or ""
            if prev_hash == raw_hash:
                out = "[snapshot:delta] no change"
            else:
                prev_set = set(prev_text.splitlines())
                now_set = set(filtered.splitlines())
                added = [l for l in filtered.splitlines() if l not in prev_set]
                removed = [l for l in prev_text.splitlines() if l not in now_set]

                out_parts = ["[snapshot:delta] changed"]
                if added:
                    out_parts.append("[added]")
                    out_parts.extend(added[:200])
                if removed:
                    out_parts.append("[removed]")
                    out_parts.extend(removed[:200])
                out = "\n".join(out_parts)

            self._last_snapshot_text = raw
            self._last_snapshot_hash = raw_hash

            if truncated:
                out += "\n[snapshot:truncated] true"
            return out

        self._last_snapshot_text = raw
        self._last_snapshot_hash = raw_hash

        if truncated:
            filtered += "\n[snapshot:truncated] true"
        return filtered

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

        wrapper_compact = bool(safe_args.pop("_compact", True))
        wrapper_delta = bool(safe_args.pop("_delta", False))
        wrapper_max_chars_raw = safe_args.pop("_max_chars", 12000)
        wrapper_context_lines_raw = safe_args.pop("_context_lines", 2)
        wrapper_keywords_raw = safe_args.pop("_keywords", [])

        try:
            wrapper_max_chars = int(wrapper_max_chars_raw)
        except Exception:
            wrapper_max_chars = 12000
        try:
            wrapper_context_lines = int(wrapper_context_lines_raw)
        except Exception:
            wrapper_context_lines = 2
        if wrapper_context_lines < 0:
            wrapper_context_lines = 0
        if wrapper_context_lines > 10:
            wrapper_context_lines = 10

        keywords: list[str] = []
        if isinstance(wrapper_keywords_raw, list):
            for k in wrapper_keywords_raw:
                if isinstance(k, str) and k.strip():
                    keywords.append(k.strip())
        elif isinstance(wrapper_keywords_raw, str) and wrapper_keywords_raw.strip():
            keywords = [wrapper_keywords_raw.strip()]

        tool = None
        for t in self.mcp_manager.tools:
            if getattr(t, "name", None) == tool_name:
                tool = t
                break
        if tool is None:
            raise ValueError(f"Unknown tool: {tool_name}")

        result = await tool.ainvoke(safe_args)

        if tool_name == "take_snapshot" and isinstance(result, str):
            return self._postprocess_snapshot_text(
                result,
                compact=wrapper_compact,
                keywords=keywords,
                context_lines=wrapper_context_lines,
                max_chars=wrapper_max_chars,
                delta=wrapper_delta,
            )

        return result

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
