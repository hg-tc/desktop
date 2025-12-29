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
from difflib import SequenceMatcher
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
        self._last_snapshot_filtered_text: Optional[str] = None
        self._last_snapshot_filtered_hash: Optional[str] = None

    def _postprocess_snapshot_text(
        self,
        text: str,
        *,
        level: int,
        max_chars: int,
        delta_mode: str,
    ) -> str:
        raw = text or ""
        raw_hash = sha256(raw.encode("utf-8", errors="ignore")).hexdigest()

        lines = raw.splitlines()

        def _section_marker_kind(line: str) -> str:
            l = (line or "").strip().lower()
            if not l:
                return ""

            # Strong markers (title/structure)
            if "heading" in l:
                return "heading"
            if "dialog" in l or "modal" in l:
                return "dialog"

            # Medium markers (layout)
            if "header" in l or "banner" in l:
                return "header"
            if "navigation" in l or "nav" in l:
                return "navigation"
            if "main" in l:
                return "main"
            if "footer" in l or "contentinfo" in l:
                return "footer"
            if "tablist" in l:
                return "tablist"
            if "toolbar" in l:
                return "toolbar"
            return ""

        def _section_title(line: str) -> str:
            t = (line or "").strip()
            if len(t) > 160:
                t = t[:160]
            return t

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

        section_starts: list[int] = [0]
        section_titles: dict[int, str] = {0: ""}
        section_kinds: dict[int, str] = {0: ""}
        last_strong_heading_i: Optional[int] = None
        last_marker_i: Optional[int] = None

        for i, line in enumerate(lines):
            if i == 0:
                continue

            kind = _section_marker_kind(line)
            if not kind:
                continue

            # Always keep headings/dialogs as anchors.
            # For weaker layout markers (nav/main/footer...), avoid creating too many
            # sections when headings are already dense.
            if kind not in ("heading", "dialog"):
                if last_strong_heading_i is not None and (i - last_strong_heading_i) <= 20:
                    continue
                if last_marker_i is not None and (i - last_marker_i) <= 6:
                    continue

            section_starts.append(i)
            section_titles[i] = _section_title(line)
            section_kinds[i] = kind
            last_marker_i = i
            if kind == "heading":
                last_strong_heading_i = i

        section_starts = sorted(set(section_starts))
        sections: list[tuple[int, int, str, str]] = []
        for idx, start in enumerate(section_starts):
            end = section_starts[idx + 1] if idx + 1 < len(section_starts) else len(lines)
            title = section_titles.get(start, "")
            kind = section_kinds.get(start, "")
            sections.append((start, end, title, kind))

        interactive_indices: set[int] = set()
        interactive_sections: set[int] = set()
        dialog_sections: set[int] = set()
        for si, (start, end, _title, kind) in enumerate(sections):
            if kind == "dialog":
                dialog_sections.add(si)
            has_interactive = False
            for i in range(start, end):
                if _is_interactive_line(lines[i]):
                    interactive_indices.add(i)
                    has_interactive = True
            if has_interactive:
                interactive_sections.add(si)

        kept_indices: set[int] = set()
        if level <= 0:
            context_lines = 1
            for i in sorted(interactive_indices):
                start = max(0, i - context_lines)
                end = min(len(lines), i + context_lines + 1)
                kept_indices.update(range(start, end))
            # Add section anchors (titles) for navigation and dialog context.
            for si, (start, end, _title, kind) in enumerate(sections):
                if si in interactive_sections:
                    kept_indices.add(start)
                    if start - 1 >= 0:
                        kept_indices.add(start - 1)
                if si in dialog_sections:
                    kept_indices.update(range(start, end))
        elif level == 1:
            for si, (start, end, _title, _kind) in enumerate(sections):
                if si in interactive_sections or si in dialog_sections:
                    kept_indices.update(range(start, end))
        else:
            kept_indices.update(range(0, len(lines)))

        if kept_indices:
            filtered_lines = [lines[i] for i in sorted(kept_indices)]
        else:
            filtered_lines = lines

        filtered = "\n".join(filtered_lines)
        truncated = False
        if max_chars > 0 and len(filtered) > max_chars:
            filtered = filtered[:max_chars]
            truncated = True

        prev_filtered_hash = self._last_snapshot_filtered_hash
        prev_filtered_text = self._last_snapshot_filtered_text or ""
        filtered_hash = sha256(filtered.encode("utf-8", errors="ignore")).hexdigest()

        def _build_diff(prev_text: str, now_text: str) -> str:
            prev_lines = prev_text.splitlines()
            now_lines = now_text.splitlines()
            prev_set = set(prev_lines)
            now_set = set(now_lines)

            added = [l for l in now_lines if l not in prev_set]
            removed = [l for l in prev_lines if l not in now_set]

            out_parts = ["[snapshot:delta] changed"]
            if added:
                out_parts.append("[added]")
                out_parts.extend(added[:200])
            if removed:
                out_parts.append("[removed]")
                out_parts.extend(removed[:200])
            return "\n".join(out_parts)

        out: str
        if delta_mode == "off":
            out = filtered
        else:
            if prev_filtered_hash is not None and prev_filtered_hash == filtered_hash:
                out = "[snapshot:delta] no change"
            elif prev_filtered_hash is None:
                out = filtered
            elif delta_mode == "on":
                out = _build_diff(prev_filtered_text, filtered)
            else:
                ratio = SequenceMatcher(None, prev_filtered_text, filtered).ratio() if prev_filtered_text or filtered else 1.0
                prev_lines = prev_filtered_text.splitlines()
                now_lines = filtered.splitlines()
                prev_set = set(prev_lines)
                now_set = set(now_lines)
                changed_lines = len([l for l in now_lines if l not in prev_set]) + len([l for l in prev_lines if l not in now_set])
                total_lines = max(1, len(prev_lines) + len(now_lines))
                small_change = (changed_lines <= 60 and (changed_lines / total_lines) <= 0.12 and ratio >= 0.85)
                out = _build_diff(prev_filtered_text, filtered) if small_change else filtered

        self._last_snapshot_text = raw
        self._last_snapshot_hash = raw_hash
        self._last_snapshot_filtered_text = filtered
        self._last_snapshot_filtered_hash = filtered_hash

        if truncated:
            out += "\n[snapshot:truncated] true"
        return out

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

        wrapper_level_raw = safe_args.pop("_snapshot_level", None)
        wrapper_compact = bool(safe_args.pop("_compact", True))
        wrapper_delta_raw = safe_args.pop("_delta", None)
        wrapper_max_chars_raw = safe_args.pop("_max_chars", None)
        _ = safe_args.pop("_context_lines", None)
        _ = safe_args.pop("_keywords", None)

        if wrapper_level_raw is None:
            wrapper_level_raw = 1 if wrapper_compact else 2
        try:
            wrapper_level = int(wrapper_level_raw)
        except Exception:
            wrapper_level = 1
        if wrapper_level < 0:
            wrapper_level = 0
        if wrapper_level > 2:
            wrapper_level = 2

        if wrapper_max_chars_raw is None:
            wrapper_max_chars_raw = 6000 if wrapper_level <= 0 else (12000 if wrapper_level == 1 else 20000)
        try:
            wrapper_max_chars = int(wrapper_max_chars_raw)
        except Exception:
            wrapper_max_chars = 12000
        if wrapper_max_chars < 2000:
            wrapper_max_chars = 2000
        if wrapper_max_chars > 80000:
            wrapper_max_chars = 80000

        if wrapper_delta_raw is None:
            delta_mode = "auto"
        else:
            delta_mode = "auto" if bool(wrapper_delta_raw) else "off"

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
                max_chars=wrapper_max_chars,
                level=wrapper_level,
                delta_mode=delta_mode,
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
