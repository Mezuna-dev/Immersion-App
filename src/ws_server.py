import asyncio
import json
import threading

import websockets
from websockets.server import serve

HOST = '127.0.0.1'
PORT = 8765


async def _handle(websocket):
    async for raw in websocket:
        try:
            msg = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue

        action = msg.get('action')
        msg_id = msg.get('id', '')

        if action == 'ping':
            await websocket.send(json.dumps({'id': msg_id, 'action': 'pong'}))
            continue

        if action != 'lookup':
            await websocket.send(json.dumps({
                'id': msg_id,
                'error': f'unknown action: {action}',
            }))
            continue

        text = msg.get('text', '')
        if not text:
            await websocket.send(json.dumps({'id': msg_id, 'matched': None, 'entries': []}))
            continue

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _lookup, text)
        result['id'] = msg_id
        await websocket.send(json.dumps(result, ensure_ascii=False))


def _lookup(text: str) -> dict:
    from dictionary.handler import get_dict_module
    module = get_dict_module()
    if not module.is_available:
        return {
            'error': 'Dictionary not available. Run scripts/build_jitendex.py to set it up.',
            'matched': None,
            'entries': [],
        }
    return module.lookup_text(text)


async def _run():
    # origins=None allows any Origin header (including moz-extension:// from Firefox).
    # websockets ≥12 defaults to rejecting connections that carry an unrecognised Origin.
    async with serve(_handle, HOST, PORT, origins=None):
        await asyncio.Future()


def start():
    """Start the WebSocket server in a background daemon thread."""
    def _thread():
        asyncio.run(_run())

    threading.Thread(target=_thread, daemon=True, name='ws-server').start()
