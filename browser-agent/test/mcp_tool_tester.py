import argparse
import asyncio
import json
import os
from typing import Any

from python.agent.mcp_client import MCPClientManager


async def _run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--browser-url",
        default=os.getenv("CHROME_DEBUG_URL"),
        help="Chrome remote debugging url, e.g. http://127.0.0.1:9222 (or set CHROME_DEBUG_URL)",
    )
    args = parser.parse_args()

    mgr = MCPClientManager()
    await mgr.connect(browser_url=args.browser_url)

    tools_by_name = {t.name: t for t in mgr.tools}

    print("Connected. Available tools:")
    for name in sorted(tools_by_name.keys()):
        print(f"- {name}")

    print("\nCommands:")
    print("  list")
    print("  desc <tool_name>")
    print('  call <tool_name> <json_args>   e.g. call take_snapshot {}')
    print("  quit")

    while True:
        try:
            line = input("mcp> ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not line:
            continue

        if line in {"q", "quit", "exit"}:
            break

        if line == "list":
            for name in sorted(tools_by_name.keys()):
                print(name)
            continue

        if line.startswith("desc "):
            name = line.split(" ", 1)[1].strip()
            tool = tools_by_name.get(name)
            if not tool:
                print(f"Unknown tool: {name}")
                continue
            print(getattr(tool, "description", ""))
            schema = getattr(tool, "args_schema", None)
            if schema is not None:
                try:
                    print(schema.model_json_schema())
                except Exception:
                    print(str(schema))
            continue

        if line.startswith("call "):
            parts = line.split(" ", 2)
            if len(parts) < 3:
                print("Usage: call <tool_name> <json_args>")
                continue
            name = parts[1]
            raw_args = parts[2]

            tool = tools_by_name.get(name)
            if not tool:
                print(f"Unknown tool: {name}")
                continue

            try:
                parsed_args: Any = json.loads(raw_args)
                if not isinstance(parsed_args, dict):
                    raise ValueError("json_args must be an object")
            except Exception as e:
                print(f"Invalid json_args: {e}")
                continue

            try:
                result = await tool.ainvoke(parsed_args)
                print(json.dumps(result, ensure_ascii=False, indent=2) if isinstance(result, (dict, list)) else result)
            except Exception as e:
                print(f"Tool error: {type(e).__name__}: {e}")
            continue

        print("Unknown command. Try: list | desc <tool> | call <tool> <json> | quit")

    await mgr.disconnect()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
