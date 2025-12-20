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

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, ToolMessage, AIMessage, AIMessageChunk
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

from .mcp_client import MCPClientManager


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(handler)
logger.propagate = False


@tool
async def wait(seconds: int) -> str:
    """Wait for specified seconds. Useful for waiting for page loads or animations."""
    seconds = max(0, min(seconds, 60))
    await asyncio.sleep(seconds)
    return f"Waited {seconds} seconds"


SYSTEM_PROMPT = """You are a browser automation assistant with Chrome DevTools access.

Available capabilities:
- Navigate to URLs (navigate_page, new_page)
- Interact with elements (click, fill, hover, press_key)
- Capture page state (take_snapshot for DOM tree, take_screenshot for visual)
- Analyze content (evaluate_script, list_console_messages)
- Monitor network (list_network_requests)

Guidelines:
1. For browser tasks, first navigate to the target URL if needed
2. Use take_snapshot to get the page's accessibility tree with element UIDs
3. Use the UID from snapshot to interact with elements (click, fill)
4. If you get "No snapshot found" error, call take_snapshot first then retry
5. Wait for page loads before interacting
6. For simple questions or chat, respond directly without using browser tools

Be concise and efficient. Report errors clearly."""


class BrowserAgent:
    """LangChain agent with chrome-devtools-mcp tools for browser automation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        model: str = "gpt-4o",
        temperature: float = 0.0,
    ):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.api_base = api_base or os.getenv("OPENAI_API_BASE")
        self.model_name = model or os.getenv("OPENAI_MODEL", "gpt-4o")
        self.temperature = temperature

        self.mcp_manager = MCPClientManager()
        self._agent = None
        self._checkpointer = InMemorySaver()
        self._thread_id = str(uuid.uuid4())

    async def setup(self, browser_url: Optional[str] = None) -> None:
        """Initialize MCP connection and create agent."""
        await self.mcp_manager.connect(browser_url)

        llm = ChatOpenAI(
            api_key=self.api_key,
            base_url=self.api_base,
            model=self.model_name,
            temperature=self.temperature,
        )

        # Get MCP tools and add custom wait tool
        tools = list(self.mcp_manager.tools) + [wait]
        
        tool_names = [getattr(t, "name", str(t)) for t in tools]
        logger.info("Loaded %d tools: %s", len(tools), tool_names)

        self._agent = create_agent(
            llm,
            tools,
            system_prompt=SYSTEM_PROMPT,
            checkpointer=self._checkpointer,
        )

    async def execute(self, task: str) -> dict[str, Any]:
        """Execute a browser automation task."""
        if not self._agent:
            raise RuntimeError("Agent not initialized. Call setup() first.")

        result = await self._agent.ainvoke(
            {"messages": [HumanMessage(content=task)]},
            {"configurable": {"thread_id": self._thread_id}},
        )

        return {
            "success": True,
            "output": result["messages"][-1].content,
        }

    async def execute_stream(self, task: str) -> AsyncGenerator[dict, None]:
        """Execute task with streaming output using stream_mode='messages'."""
        if not self._agent:
            raise RuntimeError("Agent not initialized. Call setup() first.")

        start_time = time.time()
        logger.info("⏱️ Task started: %s", task[:100])
        
        accumulated_content = ""
        current_tool_call = None
        tool_start_time = None
        last_node = None
        
        async for msg, metadata in self._agent.astream(
            {"messages": [HumanMessage(content=task)]},
            {"configurable": {"thread_id": self._thread_id}},
            stream_mode="messages",
        ):
            node = metadata.get("langgraph_node", "unknown")
            elapsed = time.time() - start_time
            
            # Log node transitions
            if node != last_node:
                logger.info("⏱️ [%.2fs] Node: %s", elapsed, node)
                last_node = node
            
            # Handle different message types
            if isinstance(msg, AIMessageChunk):
                # Check for tool call chunks
                if hasattr(msg, "tool_call_chunks") and msg.tool_call_chunks:
                    for tc_chunk in msg.tool_call_chunks:
                        tool_name = tc_chunk.get("name")
                        if tool_name and tool_name != current_tool_call:
                            # New tool call starting
                            current_tool_call = tool_name
                            tool_start_time = time.time()
                            logger.info("⏱️ [%.2fs] Tool call: %s", elapsed, tool_name)
                            yield {
                                "type": "tool_start",
                                "tool": tool_name,
                                "input": tc_chunk.get("args", ""),
                            }
                
                # Stream text content tokens
                if msg.content:
                    accumulated_content += msg.content
                    yield {"type": "token", "content": msg.content}
            
            elif isinstance(msg, ToolMessage):
                # Tool execution completed
                tool_elapsed = time.time() - tool_start_time if tool_start_time else 0
                logger.info("⏱️ [%.2fs] Tool result (took %.2fs): %s", elapsed, tool_elapsed, str(msg.content)[:80])
                yield {"type": "tool_end", "output": msg.content}
                current_tool_call = None
                tool_start_time = None
            
            elif isinstance(msg, AIMessage) and not isinstance(msg, AIMessageChunk):
                # Final AI message (non-chunk)
                if msg.content and msg.content != accumulated_content:
                    logger.info("⏱️ [%.2fs] Final response: %s", elapsed, msg.content[:80])
                    # Only emit if we haven't already streamed this content
                    if not accumulated_content:
                        yield {"type": "token", "content": msg.content}
        
        total_time = time.time() - start_time
        logger.info("⏱️ Task completed in %.2fs", total_time)

    def clear_history(self) -> None:
        """Clear chat history by creating a new thread."""
        self._thread_id = str(uuid.uuid4())

    async def get_available_tools(self) -> list[str]:
        """Get list of available tool names."""
        return await self.mcp_manager.get_tool_names()

    def is_compatible_config(
        self,
        api_key: Optional[str],
        api_base: Optional[str],
        model: str,
        browser_url: Optional[str],
    ) -> bool:
        """Check if current config matches the given config."""
        return (
            self._agent is not None
            and (api_key or os.getenv("OPENAI_API_KEY")) == self.api_key
            and (api_base or os.getenv("OPENAI_API_BASE")) == self.api_base
            and (model or "gpt-4o") == self.model_name
        )

    async def close(self) -> None:
        """Clean up resources."""
        await self.mcp_manager.disconnect()
        self._agent = None

    async def __aenter__(self):
        await self.setup()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
