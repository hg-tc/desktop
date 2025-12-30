"""
API routes for browser agent operations.
"""

import json
import os
from pathlib import Path
from typing import Optional

import logging

from dotenv import load_dotenv
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Body
from pydantic import BaseModel

import httpx

from agent import BrowserAgent


router = APIRouter()

logger = logging.getLogger(__name__)

agent_instance: Optional[BrowserAgent] = None

DEFAULT_APP_ID = "desktop-browser-agent"
XHS_APP_ID = "desktop-xiaohongshu"


class TaskRequest(BaseModel):
    """Request model for task execution."""
    prompt: str
    browser_url: Optional[str] = None


class TaskResponse(BaseModel):
    """Response model for task execution."""
    success: bool
    output: str
    error: Optional[str] = None


class CallToolRequest(BaseModel):
    tool: str
    args: dict = {}


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


class XiaohongshuExecuteRequest(BaseModel):
    op: str
    params: dict = {}


def _ensure_supported_app_id(app_id: str) -> str:
    normalized = (app_id or "").strip()
    if normalized not in {DEFAULT_APP_ID, XHS_APP_ID}:
        raise HTTPException(status_code=404, detail="Unknown app")
    return normalized


def _xhs_base_url() -> str:
    raw = os.getenv("XIAOHONGSHU_MCP_BASE_URL") or os.getenv("XHS_MCP_BASE_URL") or "http://127.0.0.1:18060"
    return raw.rstrip("/")


def _xhs_is_headless() -> bool:
    # Electron starts xiaohongshu-mcp in headed mode by default unless XHS_MCP_HEADLESS=1
    return (os.getenv("XHS_MCP_HEADLESS") == "1") or (os.getenv("XIAOHONGSHU_MCP_HEADLESS") == "1")


async def _xhs_request(method: str, path: str, payload: Optional[dict] = None) -> dict:
    url = f"{_xhs_base_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.request(method, url, json=payload)
        res.raise_for_status()
        return res.json()


def _xhs_tools() -> list[str]:
    return [
        "check_login_status",
        "get_login_qrcode",
        "delete_cookies",
        "list_feeds",
        "search_feeds",
        "get_feed_detail",
        "user_profile",
        "my_profile",
        "publish_content",
        "publish_video",
        "post_comment_to_feed",
        "reply_comment_in_feed",
    ]


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


@router.get("/apps")
async def list_apps() -> dict:
    return {
        "apps": [
            {
                "id": DEFAULT_APP_ID,
                "name": "Desktop Browser Agent",
                "runtime": "desktop",
                "capabilities": [
                    {
                        "capability": "browser_automation",
                        "actions": [
                            "status",
                            "config",
                            "tools",
                            "setup",
                            "execute",
                            "clearHistory",
                            "shutdown",
                        ],
                    }
                ],
            }
            ,
            {
                "id": XHS_APP_ID,
                "name": "Xiaohongshu Operator",
                "runtime": "desktop",
                "capabilities": [
                    {
                        "capability": "xiaohongshu_mcp",
                        "actions": [
                            "status",
                            "config",
                            "tools",
                            "setup",
                            "execute",
                            "clearHistory",
                            "shutdown",
                        ],
                    }
                ],
            },
        ]
    }


async def get_agent() -> BrowserAgent:
    """Get or create agent instance."""
    global agent_instance
    if agent_instance is None:
        raise HTTPException(status_code=400, detail="Agent not initialized. Call /setup first.")
    return agent_instance


async def _get_agent_for_app(app_id: str) -> BrowserAgent:
    _ensure_supported_app_id(app_id)
    return await get_agent()


async def _xhs_status() -> dict:
    try:
        data = await _xhs_request("GET", "/health")
        return {
            "initialized": True,
            "connected": bool(data and data.get("success") is True),
            "health": data,
        }
    except Exception as e:
        return {
            "initialized": False,
            "connected": False,
            "error": str(e),
        }


async def _xhs_config() -> dict:
    return {
        "base_url": _xhs_base_url(),
    }


async def _xhs_setup(_payload: dict) -> dict:
    status = await _xhs_status()
    if status.get("connected"):
        return {
            "success": True,
            "message": "Xiaohongshu MCP reachable",
        }
    return {
        "success": False,
        "error": status.get("error") or "Xiaohongshu MCP not reachable",
    }


async def _xhs_execute(request: XiaohongshuExecuteRequest) -> dict:
    op = (request.op or "").strip()
    params = request.params or {}

    if op == "check_login_status":
        data = await _xhs_request("GET", "/api/v1/login/status")
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "get_login_qrcode":
        data = await _xhs_request("GET", "/api/v1/login/qrcode")
        # In headed mode, the browser window already shows the QR code UI.
        # Returning the data:image payload is noisy and the QR expires quickly.
        if not _xhs_is_headless() and isinstance(data, dict):
            try:
                payload = json.loads(json.dumps(data))
                if isinstance(payload.get("data"), dict) and "img" in payload["data"]:
                    payload["data"].pop("img", None)
                    payload["data"]["img_omitted"] = True
                payload["message"] = "已打开登录窗口，请在弹出的浏览器中扫码/确认登录。完成后请回复：我已登录。"
                return {"success": True, "output": json.dumps(payload, ensure_ascii=False)}
            except Exception:
                return {"success": True, "output": "已打开登录窗口，请在弹出的浏览器中扫码/确认登录。完成后请回复：我已登录。"}

        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "delete_cookies":
        data = await _xhs_request("DELETE", "/api/v1/login/cookies")
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "list_feeds":
        data = await _xhs_request("GET", "/api/v1/feeds/list")
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "search_feeds":
        data = await _xhs_request("POST", "/api/v1/feeds/search", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "get_feed_detail":
        if not isinstance(params, dict):
            return {"success": False, "output": "", "error": "params must be an object"}
        feed_id = params.get("feed_id")
        xsec_token = params.get("xsec_token")
        if not isinstance(feed_id, str) or not feed_id.strip():
            return {"success": False, "output": "", "error": "Missing required param: feed_id"}
        if not isinstance(xsec_token, str) or not xsec_token.strip():
            return {"success": False, "output": "", "error": "Missing required param: xsec_token"}
        data = await _xhs_request("POST", "/api/v1/feeds/detail", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "user_profile":
        data = await _xhs_request("POST", "/api/v1/user/profile", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "my_profile":
        data = await _xhs_request("GET", "/api/v1/user/me")
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "publish_content":
        data = await _xhs_request("POST", "/api/v1/publish", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "publish_video":
        data = await _xhs_request("POST", "/api/v1/publish_video", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "post_comment_to_feed":
        data = await _xhs_request("POST", "/api/v1/feeds/comment", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    if op == "reply_comment_in_feed":
        data = await _xhs_request("POST", "/api/v1/feeds/comment/reply", params)
        return {"success": True, "output": json.dumps(data, ensure_ascii=False)}

    return {"success": False, "output": "", "error": f"Unknown op: {op}"}


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


@router.post("/apps/{app_id}/setup")
async def setup_app_agent(app_id: str, request: SetupRequest) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await setup_agent(request)
    return await _xhs_setup(request.model_dump(exclude_none=True))


@router.post("/execute", response_model=TaskResponse)
async def execute_task(request: TaskRequest) -> TaskResponse:
    """
    Execute a browser automation task.
    """
    raise HTTPException(
        status_code=410,
        detail="Desktop LLM execution is disabled. Use /call-tool to run atomic MCP tools.",
    )


@router.post("/call-tool")
async def call_tool(request: CallToolRequest) -> dict:
    agent = await get_agent()
    try:
        output = await agent.call_tool(request.tool, request.args)
        return {"success": True, "output": output}
    except Exception as e:
        return {"success": False, "output": "", "error": str(e)}


@router.post("/apps/{app_id}/execute")
async def execute_app_task(app_id: str, payload: dict = Body(default_factory=dict)) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    safe = payload if isinstance(payload, dict) else {}

    if normalized == DEFAULT_APP_ID:
        raise HTTPException(
            status_code=410,
            detail="Desktop LLM execution is disabled. Use /apps/{app_id}/call-tool to run atomic MCP tools.",
        )

    op = safe.get("op")
    params = safe.get("params")
    if not isinstance(op, str) or not op.strip():
        raise HTTPException(status_code=400, detail="Missing 'op'")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise HTTPException(status_code=400, detail="'params' must be an object")

    try:
        result = await _xhs_execute(XiaohongshuExecuteRequest(op=op, params=params))
        return {
            "success": bool(result.get("success")),
            "output": str(result.get("output") or ""),
            "error": result.get("error"),
        }
    except httpx.HTTPStatusError as e:
        detail = None
        try:
            detail = e.response.json()
        except Exception:
            try:
                detail = e.response.text
            except Exception:
                detail = None

        return {
            "success": False,
            "output": "",
            "error": json.dumps(
                {
                    "message": "xiaohongshu-mcp request failed",
                    "status_code": getattr(e.response, "status_code", None),
                    "url": str(getattr(e.request, "url", "")),
                    "detail": detail,
                },
                ensure_ascii=False,
            ),
        }
    except Exception as e:
        return {
            "success": False,
            "output": "",
            "error": f"Worker exception: {str(e)}",
        }


@router.post("/apps/{app_id}/call-tool")
async def call_app_tool(app_id: str, payload: dict = Body(default_factory=dict)) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    safe = payload if isinstance(payload, dict) else {}

    if normalized == DEFAULT_APP_ID:
        tool_name = safe.get("tool")
        args = safe.get("args")
        if not isinstance(tool_name, str) or not tool_name.strip():
            raise HTTPException(status_code=400, detail="Missing 'tool'")
        if args is None:
            args = {}
        if not isinstance(args, dict):
            raise HTTPException(status_code=400, detail="'args' must be an object")

        agent = await get_agent()
        try:
            output = await agent.call_tool(tool_name, args)
            return {"success": True, "output": output}
        except Exception as e:
            return {"success": False, "output": "", "error": str(e)}

    raise HTTPException(status_code=400, detail="Unsupported app_id")


@router.post("/clear-history")
async def clear_history() -> dict:
    """Clear agent chat history."""
    agent = await get_agent()
    agent.clear_history()
    return {"success": True, "message": "History cleared"}


@router.post("/apps/{app_id}/clear-history")
async def clear_app_history(app_id: str) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await clear_history()
    return {"success": True, "message": "History cleared"}


@router.get("/tools")
async def get_tools() -> dict:
    """Get list of available tools."""
    agent = await get_agent()
    tools = await agent.get_available_tools()
    try:
        tool_schemas = await agent.get_available_tool_schemas()
    except Exception:
        tool_schemas = []
    return {"tools": tools, "tool_schemas": tool_schemas}


@router.get("/apps/{app_id}/tools")
async def get_app_tools(app_id: str) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await get_tools()
    return {"tools": _xhs_tools()}


@router.get("/status")
async def get_status() -> dict:
    """Get agent status."""
    global agent_instance
    return {
        "initialized": agent_instance is not None,
        "connected": agent_instance.mcp_manager.is_connected if agent_instance else False,
    }


@router.get("/apps/{app_id}/status")
async def get_app_status(app_id: str) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await get_status()
    return await _xhs_status()


@router.get("/apps/{app_id}/config")
async def get_app_config(app_id: str) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await get_config()
    return await _xhs_config()


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


@router.post("/apps/{app_id}/shutdown")
async def shutdown_app(app_id: str) -> dict:
    normalized = _ensure_supported_app_id(app_id)
    if normalized == DEFAULT_APP_ID:
        return await shutdown_agent()
    return {"success": True, "message": "App shutdown complete"}
