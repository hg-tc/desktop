"""
API routes for browser agent operations.
"""

import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

from agent import BrowserAgent


router = APIRouter()

agent_instance: Optional[BrowserAgent] = None


class TaskRequest(BaseModel):
    """Request model for task execution."""
    prompt: str
    browser_url: Optional[str] = None


class TaskResponse(BaseModel):
    """Response model for task execution."""
    success: bool
    output: str
    error: Optional[str] = None


class SetupRequest(BaseModel):
    """Request model for agent setup."""
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    model: str = "gpt-4o"
    browser_url: Optional[str] = None


class SyncRequest(BaseModel):
    """Request model for syncing with external server."""
    endpoint: str
    data: dict


@router.get("/config")
async def get_config() -> dict:
    """Get default configuration from environment variables."""
    # Force reload .env file to pick up changes without restart
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(dotenv_path=env_path, override=True)
    
    return {
        "api_key": os.getenv("OPENAI_API_KEY"),
        "api_base": os.getenv("OPENAI_API_BASE"),
        "model": os.getenv("OPENAI_MODEL"),
        "browser_url": os.getenv("CHROME_DEBUG_URL"),
    }


async def get_agent() -> BrowserAgent:
    """Get or create agent instance."""
    global agent_instance
    if agent_instance is None:
        raise HTTPException(status_code=400, detail="Agent not initialized. Call /setup first.")
    return agent_instance


@router.post("/setup")
async def setup_agent(request: SetupRequest) -> dict:
    """
    Initialize the browser agent with configuration.
    """
    global agent_instance

    browser_url = request.browser_url or os.getenv("CHROME_DEBUG_URL")

    if agent_instance and agent_instance.is_compatible_config(
        api_key=request.api_key,
        api_base=request.api_base,
        model=request.model,
        browser_url=browser_url,
    ):
        tools = await agent_instance.get_available_tools()
        return {
            "success": True,
            "message": "Agent already initialized",
            "available_tools": tools,
        }
    
    if agent_instance:
        await agent_instance.close()
    
    agent_instance = BrowserAgent(
        api_key=request.api_key,
        api_base=request.api_base,
        model=request.model,
    )
    
    await agent_instance.setup(browser_url=browser_url)
    try:
        tools = await agent_instance.get_available_tools()
    except Exception as e:
        # If getting tools fails, we should still consider it an error but maybe we can return what we have?
        # Actually, if setup succeeded but get_tools failed, it's weird.
        # But let's catch the whole block.
        raise e
    
    return {
        "success": True,
        "message": "Agent initialized successfully",
        "available_tools": tools,
    }


@router.post("/execute", response_model=TaskResponse)
async def execute_task(request: TaskRequest) -> TaskResponse:
    """
    Execute a browser automation task.
    """
    agent = await get_agent()
    
    try:
        result = await agent.execute(request.prompt)
        return TaskResponse(
            success=result["success"],
            output=result["output"],
        )
    except Exception as e:
        return TaskResponse(
            success=False,
            output="",
            error=str(e),
        )


@router.post("/clear-history")
async def clear_history() -> dict:
    """Clear agent chat history."""
    agent = await get_agent()
    agent.clear_history()
    return {"success": True, "message": "History cleared"}


@router.get("/tools")
async def get_tools() -> dict:
    """Get list of available tools."""
    agent = await get_agent()
    tools = await agent.get_available_tools()
    return {"tools": tools}


@router.get("/status")
async def get_status() -> dict:
    """Get agent status."""
    global agent_instance
    return {
        "initialized": agent_instance is not None,
        "connected": agent_instance.mcp_manager.is_connected if agent_instance else False,
    }


@router.websocket("/ws/task")
async def websocket_task(websocket: WebSocket):
    """
    WebSocket endpoint for streaming task execution.
    
    Send JSON: {"prompt": "your task description"}
    Receive streaming updates as JSON messages.
    """
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if "prompt" not in message:
                await websocket.send_json({"error": "Missing 'prompt' field"})
                continue
            
            agent = await get_agent()
            
            try:
                async for event in agent.execute_stream(message["prompt"]):
                    await websocket.send_json(event)
                
                await websocket.send_json({"type": "done"})
            
            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "error": str(e),
                })
    
    except WebSocketDisconnect:
        pass


@router.post("/shutdown")
async def shutdown_agent() -> dict:
    """Shutdown the agent and release resources."""
    global agent_instance
    
    if agent_instance:
        await agent_instance.close()
        agent_instance = None
    
    return {"success": True, "message": "Agent shutdown complete"}
