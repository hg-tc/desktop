import asyncio
import os
import sys

# Add current directory to path so we can import agent modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.mcp_client import MCPClientManager

async def test_connect():
    print("Testing MCP connection...")
    manager = MCPClientManager()
    try:
        await manager.connect()
        print("Connected successfully!")
        tools = await manager.get_tool_names()
        print(f"Available tools: {tools}")
        await manager.disconnect()
    except Exception as e:
        print(f"Connection failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connect())
