const WS_URL = 'ws://127.0.0.1:8765';
const LOOKUP_TIMEOUT_MS = 5000;

// Live WebSocket instance, or null when disconnected.
let ws = null;
// In-flight connect Promise so concurrent callers share one attempt.
let connecting = null;
// Pending requests: id → resolve callback.
const pending = new Map();

function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
}

function onClose() {
  ws = null;
  connecting = null;
  for (const [id, resolve] of pending) {
    resolve({ id, error: 'Connection to Immersion Suite was lost.', matched: null, entries: [] });
  }
  pending.clear();
}

function connect() {
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      ws = socket;
      connecting = null;
      resolve(socket);
    };
    socket.onerror = (event) => {
      console.error('[immersion] WebSocket error:', event);
      connecting = null;
      reject(new Error('Could not connect to Immersion Suite. Is the app running?'));
    };
    socket.onclose = onClose;
    socket.onmessage = onMessage;
  });
  return connecting;
}

async function ensureConnected() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  return connect();
}

async function lookup(text) {
  let socket;
  try {
    socket = await ensureConnected();
  } catch (e) {
    return { error: e.message, matched: null, entries: [] };
  }

  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ id, error: 'Lookup timed out.', matched: null, entries: [] });
    }, LOOKUP_TIMEOUT_MS);

    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });

    socket.send(JSON.stringify({ id, action: 'lookup', text }));
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'lookup') {
    lookup(msg.text).then(sendResponse);
    return true; // keep the message channel open for the async reply
  }
});
