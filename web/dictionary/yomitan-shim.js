// Yomitan content-script shim.
//
// Runs at DocumentCreation in every frame (MainWorld, all subframes). Three
// modes, picked from window.location:
//
//   BACKEND  — the hidden  immersion://yomitan/immersion/backend.html  frame.
//              Hosts the handler registry + DictionaryDatabase + Translator.
//              Workers constructed from Yomitan modules resolve to
//              immersion://yomitan/js/...  here — same origin, they load.
//              Receives RPC via postMessage from its parent (the top frame).
//
//   TOP      — any top-level page (google.com, youtube.com, a tab's real
//              page, etc.). No handlers here. Forwards all RPC — its own and
//              its subframes' — to the backend iframe. Fans broadcasts from
//              the backend out to every child frame EXCEPT the backend.
//
//   SUBFRAME — anything else (Yomitan's popup iframe, site iframes).
//              Forwards sendMessage to window.parent via postMessage; the
//              top frame routes from there. Receives broadcasts and feeds
//              them to its local onMessage listeners.
//
// Wire protocol:
//   {type: 'immersion-rpc',       id, message}          — child → parent
//   {type: 'immersion-rpc-reply', id, result | error}   — parent → child
//   {type: 'immersion-broadcast', message}              — parent → child
//   {type: 'immersion-backend-shim-ready'}              — backend → parent
//   {type: 'immersion-backend-ready'}                   — backend → parent
//                                                        (sent by yomitan-backend.js
//                                                         after TLA)

(() => {
    const IS_TOP = window === window.top;
    // Non-special custom schemes (`immersion://`) don't always populate
    // location.host / location.pathname the way http(s) URLs do, so match on
    // the full href prefix instead. This is the hidden backend iframe that
    // hosts DictionaryDatabase + the handler registry.
    const IS_BACKEND = !IS_TOP && window.location.href.startsWith(
        'immersion://yomitan/immersion/backend.html');
    const IS_SUBFRAME = !IS_TOP && !IS_BACKEND;

    // ── Diagnostic fallback (probe) ──────────────────────────────────────
    const seen = new Set();
    const log = (path) => {
        if (seen.has(path)) return;
        seen.add(path);
        console.warn('[chrome-probe] ' + path);
    };

    const PASSTHROUGH = new Set([
        'then', 'catch', 'finally',
        'toJSON', 'toString', 'valueOf',
        'constructor', 'prototype',
        'length', 'name',
        'nodeType', 'tagName', 'splice',
        Symbol.toPrimitive, Symbol.iterator, Symbol.asyncIterator,
    ]);

    const make = (path) => {
        const target = function () {};
        return new Proxy(target, {
            get(_t, prop) {
                if (typeof prop === 'symbol') return undefined;
                if (PASSTHROUGH.has(prop)) return undefined;
                const sub = path + '.' + String(prop);
                log(sub);
                return make(sub);
            },
            apply(_t, _this, args) {
                log(path + '(' + args.length + ')');
                return make(path + '()');
            },
            construct(_t, args) {
                log('new ' + path + '(' + args.length + ')');
                return make('new ' + path + '()');
            },
            has() { return true; },
        });
    };

    // ── Shared pieces ────────────────────────────────────────────────────
    const YOMITAN_BASE = 'immersion://yomitan/';
    const EXTENSION_ID = 'immersion-yomitan';
    const MANIFEST = {
        name: 'Immersion-Yomitan',
        version: '0.1.0',
        manifest_version: 3,
    };

    const messageListeners = new Set();
    const dispatchToLocalListeners = (message, sender) => {
        for (const cb of messageListeners) {
            try {
                cb(message, sender || {id: EXTENSION_ID}, () => {});
            } catch (e) {
                console.error('[yomitan-shim] listener error', e);
            }
        }
    };

    const serializeError = (err) => ({
        name: (err && err.name) || 'Error',
        message: (err && err.message) || String(err),
        stack: (err && err.stack) || '',
        data: null,
    });

    // sendMessageImpl is the per-mode implementation; installed below.
    let sendMessageImpl;

    // ── BACKEND MODE ─────────────────────────────────────────────────────
    if (IS_BACKEND) {
        const handlers = Object.create(null);

        handlers.requestBackendReadySignal = async () => {
            // Every frame's Application.main awaits onMessage for
            // applicationBackendReady. Broadcast via parent fan-out.
            console.error('[yomitan-shim:backend] requestBackendReadySignal → queueing applicationBackendReady broadcast');
            queueMicrotask(() => {
                console.error('[yomitan-shim:backend] broadcasting applicationBackendReady');
                publicApi.broadcast({action: 'applicationBackendReady', params: {}});
            });
            return undefined;
        };
        handlers.frameInformationGet = async () => ({tabId: 1, frameId: 0});
        handlers.applicationReady = async () => undefined;
        handlers.applicationIsReady = async () => true;
        handlers.heartbeat = async () => undefined;
        handlers.logGenericErrorBackend = async () => undefined;
        handlers.getEnvironmentInfo = async () => ({
            browser: 'chrome',
            platform: {os: 'win'},
        });

        handlers.broadcastTab = async (params) => {
            const msg = params && params.message;
            if (!msg) return undefined;
            console.error('[yomitan-shim:backend] broadcastTab action='
                + (msg && msg.action));
            publicApi.broadcast(msg);
            return undefined;
        };

        const invoke = (action, params) => {
            const handler = handlers[action];
            if (handler) {
                try { return Promise.resolve(handler(params)); }
                catch (e) { return Promise.reject(e); }
            }
            log('chrome.runtime.sendMessage[unhandled] action=' + action);
            return Promise.resolve(undefined);
        };

        // The backend frame's own sendMessage (from yomitan-backend.js or any
        // Yomitan module loaded here) dispatches locally.
        sendMessageImpl = (message) => invoke(
            message && message.action,
            message && message.params,
        );

        // RPC server: parent (top frame) forwards child-tab messages here.
        window.addEventListener('message', (ev) => {
            if (ev.source !== window.parent) return;
            const d = ev.data;
            if (!d || typeof d !== 'object' || d.type !== 'immersion-rpc') return;
            const {id, message} = d;
            const action = message && message.action;
            const params = message && message.params;
            invoke(action, params).then(
                (result) => {
                    try {
                        window.parent.postMessage(
                            {type: 'immersion-rpc-reply', id, result}, '*');
                    } catch (_) {}
                },
                (err) => {
                    console.error('[yomitan-shim:backend] handler error for '
                        + action + ': ' + ((err && err.message) || err));
                    try {
                        window.parent.postMessage(
                            {type: 'immersion-rpc-reply', id,
                             error: serializeError(err)}, '*');
                    } catch (_) {}
                },
            );
        });

        var publicApi = {
            registerHandler(action, fn) { handlers[action] = fn; },
            emit: dispatchToLocalListeners,
            broadcast: (msg) => {
                dispatchToLocalListeners(msg);
                try {
                    window.parent.postMessage(
                        {type: 'immersion-broadcast', message: msg}, '*');
                } catch (_) {}
            },
            listenerCount() { return messageListeners.size; },
        };
        window.__immersionYomitan = publicApi;

        // Tell the parent we're live and listening for RPC. Full DB readiness
        // is separately signaled by yomitan-backend.js (immersion-backend-ready).
        try {
            console.error('[yomitan-shim:backend] posting immersion-backend-shim-ready to parent');
            window.parent.postMessage(
                {type: 'immersion-backend-shim-ready'}, '*');
        } catch (e) {
            console.error('[yomitan-shim:backend] post failed: ' + ((e && e.message) || e));
        }
    }

    // ── TOP MODE (pure router to backend iframe) ─────────────────────────
    if (IS_TOP) {
        /** @type {Window|null} */
        let backendWin = null;
        let resolveShimReady;
        const backendShimReady = new Promise((r) => { resolveShimReady = r; });

        const pendingOutbound = new Map();  // id → {resolve, reject}
        let nextOutId = 0;

        // Child RPC → backend. We keep a mapping so we can route the reply
        // back to the original child frame.
        const inFlightFromChild = new Map();  // forwardedId → {sourceWin, childId}
        let nextForwardId = 0;

        const postToChildren = (message, except) => {
            for (let i = 0; i < window.frames.length; i++) {
                const child = window.frames[i];
                if (child === except || child === backendWin) continue;
                try {
                    child.postMessage(
                        {type: 'immersion-broadcast', message}, '*');
                } catch (_) { /* cross-origin or gone */ }
            }
        };

        window.addEventListener('message', (ev) => {
            const d = ev.data;
            if (!d || typeof d !== 'object') return;

            if (d.type && String(d.type).startsWith('immersion-')) {
                console.error('[yomitan-shim:top] recv type=' + d.type
                    + ' sourceIsBackend=' + (ev.source === backendWin)
                    + ' hasBackendWin=' + (backendWin !== null)
                    + ' sourceIsWindow=' + (ev.source instanceof Window));
            }

            // ── From backend iframe ─────────────────────────────────────
            if (ev.source === backendWin) {
                if (d.type === 'immersion-rpc-reply') {
                    // Either reply to our own sendMessage, or a forwarded
                    // one from a child. Check inFlightFromChild first.
                    const forwarded = inFlightFromChild.get(d.id);
                    if (forwarded) {
                        inFlightFromChild.delete(d.id);
                        const reply = {
                            type: 'immersion-rpc-reply',
                            id: forwarded.childId,
                        };
                        if ('error' in d) reply.error = d.error;
                        else reply.result = d.result;
                        try { forwarded.sourceWin.postMessage(reply, '*'); }
                        catch (_) {}
                        return;
                    }
                    const slot = pendingOutbound.get(d.id);
                    if (!slot) return;
                    pendingOutbound.delete(d.id);
                    if ('error' in d) {
                        const e = new Error(
                            (d.error && d.error.message) || 'Remote error');
                        if (d.error) {
                            e.name = d.error.name || 'Error';
                            if (d.error.stack) e.stack = d.error.stack;
                        }
                        slot.reject(e);
                    } else {
                        slot.resolve(d.result);
                    }
                    return;
                }
                if (d.type === 'immersion-broadcast') {
                    // Backend wants every frame in the tab to get this.
                    console.error('[yomitan-shim:top] broadcast action='
                        + (d.message && d.message.action)
                        + ' listeners=' + messageListeners.size);
                    dispatchToLocalListeners(d.message);
                    postToChildren(d.message);
                    return;
                }
                if (d.type === 'immersion-backend-shim-ready') {
                    console.error('[yomitan-shim:top] backend shim ready');
                    resolveShimReady();
                    return;
                }
                return;
            }

            // ── From child frame: forward RPC to backend ────────────────
            if (d.type !== 'immersion-rpc') return;
            if (!ev.source) return;
            const action = d.message && d.message.action;
            console.error('[yomitan-shim:top] child RPC action=' + action);
            (async () => {
                await backendShimReady;
                if (!backendWin) return;
                const forwardId = ++nextForwardId;
                inFlightFromChild.set(forwardId, {
                    sourceWin: ev.source,
                    childId: d.id,
                });
                try {
                    backendWin.postMessage({
                        type: 'immersion-rpc',
                        id: forwardId,
                        message: d.message,
                    }, '*');
                } catch (e) {
                    inFlightFromChild.delete(forwardId);
                    try {
                        ev.source.postMessage({
                            type: 'immersion-rpc-reply',
                            id: d.id,
                            error: serializeError(e),
                        }, '*');
                    } catch (_) {}
                }
            })();
        });

        sendMessageImpl = (message) => new Promise((resolve, reject) => {
            const action = message && message.action;
            (async () => {
                await backendShimReady;
                if (!backendWin) {
                    reject(new Error('backend iframe not registered'));
                    return;
                }
                const id = ++nextOutId;
                pendingOutbound.set(id, {resolve, reject});
                try {
                    backendWin.postMessage(
                        {type: 'immersion-rpc', id, message}, '*');
                } catch (e) {
                    pendingOutbound.delete(id);
                    reject(e);
                }
            })().catch(reject);
        });

        // Hook the bootstrap uses after it creates the hidden iframe.
        window.__immersionYomitan = {
            setBackendFrame(win) {
                backendWin = win;
                console.error('[yomitan-shim:top] backend frame registered');
            },
            // Handler registry no longer lives here. Retained as a stub so
            // any top-frame code that still calls it doesn't crash — but
            // anything registered here is dead weight.
            registerHandler() {
                console.error('[yomitan-shim:top] registerHandler called in '
                    + 'top frame — IGNORED. Register handlers in the backend '
                    + 'iframe instead.');
            },
            emit: dispatchToLocalListeners,
            broadcast: (msg) => {
                dispatchToLocalListeners(msg);
                postToChildren(msg);
            },
            listenerCount() { return messageListeners.size; },
        };
    }

    // ── SUBFRAME MODE ────────────────────────────────────────────────────
    if (IS_SUBFRAME) {
        const pending = new Map();
        let nextId = 0;

        window.addEventListener('message', (ev) => {
            if (ev.source !== window.parent) return;
            const d = ev.data;
            if (!d || typeof d !== 'object') return;
            if (d.type === 'immersion-rpc-reply') {
                const slot = pending.get(d.id);
                if (!slot) return;
                pending.delete(d.id);
                if (d.error) {
                    const e = new Error(d.error.message || 'Remote error');
                    e.name = d.error.name || 'Error';
                    if (d.error.stack) e.stack = d.error.stack;
                    slot.reject(e);
                } else {
                    slot.resolve(d.result);
                }
            } else if (d.type === 'immersion-broadcast') {
                dispatchToLocalListeners(d.message);
            }
        });

        sendMessageImpl = (message) => new Promise((resolve, reject) => {
            const id = ++nextId;
            const action = message && message.action;
            console.error('[yomitan-shim:subframe] forwarding action=' + action);
            pending.set(id, {resolve, reject});
            try {
                window.parent.postMessage(
                    {type: 'immersion-rpc', id, message}, '*');
            } catch (e) {
                pending.delete(id);
                reject(e);
            }
        });

        window.__immersionYomitan = {
            registerHandler() {},
            emit: dispatchToLocalListeners,
            broadcast: dispatchToLocalListeners,
            listenerCount() { return messageListeners.size; },
        };
    }

    // ── chrome.runtime / chrome.storage shim (installed in all modes) ────
    const runtime = {
        getURL(p) {
            return YOMITAN_BASE + String(p).replace(/^\//, '');
        },
        getManifest() { return MANIFEST; },
        get lastError() { return null; },
        get id() { return EXTENSION_ID; },
        onMessage: {
            addListener(cb) { messageListeners.add(cb); },
            removeListener(cb) { messageListeners.delete(cb); },
            hasListener(cb) { return messageListeners.has(cb); },
            hasListeners() { return messageListeners.size > 0; },
        },
        sendMessage(...args) {
            // Full signature surface:
            //   sendMessage(message [, options] [, callback])
            //   sendMessage(extensionId, message [, options] [, callback])
            let callback = null;
            if (args.length > 0 && typeof args[args.length - 1] === 'function') {
                callback = args[args.length - 1];
                args = args.slice(0, -1);
            }
            const message = (args.length >= 2 && typeof args[0] === 'string')
                ? args[1] : args[0];
            const resultPromise = sendMessageImpl(message);

            // API._invoke expects the envelope {result} on success or
            // {error: <serialized>} on failure — it unwraps `.result` and
            // deserializes `.error`. Raw values make it destructure undefined.
            if (callback) {
                resultPromise.then(
                    (result) => {
                        try { callback({result}); }
                        catch (e) { console.error('[yomitan-shim] callback threw', e); }
                    },
                    (err) => {
                        const action = message && message.action;
                        console.error('[yomitan-shim] handler error for '
                            + action + ': ' + ((err && err.message) || err));
                        try { callback({error: serializeError(err)}); }
                        catch (e) { console.error('[yomitan-shim] callback threw', e); }
                    },
                );
            }
            return resultPromise;
        },
        connect() {
            log('chrome.runtime.connect[stub]');
            return make('chrome.runtime.connect()');
        },
        onConnect: {
            addListener() {}, removeListener() {}, hasListener() { return false; },
        },
    };

    const makeStorageArea = (label) => {
        const data = new Map();
        return {
            async get(keys) {
                if (keys === null || keys === undefined) {
                    const out = {};
                    for (const [k, v] of data) out[k] = v;
                    return out;
                }
                if (typeof keys === 'string') {
                    return data.has(keys) ? {[keys]: data.get(keys)} : {};
                }
                if (Array.isArray(keys)) {
                    const out = {};
                    for (const k of keys) if (data.has(k)) out[k] = data.get(k);
                    return out;
                }
                const out = {};
                for (const k of Object.keys(keys)) {
                    out[k] = data.has(k) ? data.get(k) : keys[k];
                }
                return out;
            },
            async set(items) {
                for (const [k, v] of Object.entries(items)) data.set(k, v);
            },
            async remove(keys) {
                const ks = typeof keys === 'string' ? [keys] : keys;
                for (const k of ks) data.delete(k);
            },
            async clear() { data.clear(); },
            onChanged: {
                addListener() {}, removeListener() {}, hasListener() { return false; },
            },
        };
    };

    const storage = {
        local:   makeStorageArea('local'),
        session: makeStorageArea('session'),
        sync:    makeStorageArea('sync'),
        onChanged: {
            addListener() {}, removeListener() {}, hasListener() { return false; },
        },
    };

    const chromeShim = {runtime, storage};

    // Known Chrome extension namespaces — we wrap unknown accesses to these
    // with the diagnostic Proxy so Yomitan paths surface. Anything else
    // (chrome.toJSON, chrome.app, chrome.send, etc.) falls through to the
    // real chrome object so page scripts aren't broken.
    const EXT_NAMESPACES = new Set([
        'runtime', 'storage', 'tabs', 'windows', 'action', 'permissions',
        'commands', 'contextMenus', 'scripting', 'declarativeNetRequest',
        'offscreen', 'i18n', 'alarms', 'webNavigation', 'webRequest',
        'cookies', 'bookmarks', 'history', 'browserAction', 'pageAction',
        'management', 'downloads', 'identity', 'notifications',
        'extension',
    ]);

    const existing = window.chrome || {};
    window.chrome = new Proxy(existing, {
        get(target, prop) {
            if (typeof prop === 'symbol') return target[prop];
            if (prop in chromeShim) return chromeShim[prop];
            if (prop in target) return target[prop];
            if (EXT_NAMESPACES.has(String(prop))) {
                const sub = 'chrome.' + String(prop);
                log(sub);
                return make(sub);
            }
            return undefined;
        },
        has() { return true; },
    });

    // Surface silent async failures so we can see what Yomitan chokes on.
    window.addEventListener('unhandledrejection', (ev) => {
        const r = ev.reason;
        const msg = (r && (r.stack || r.message)) || String(r);
        console.error('[yomitan-shim] unhandledrejection: ' + msg);
    });
    window.addEventListener('error', (ev) => {
        const file = ev.filename || '(no filename)';
        const line = typeof ev.lineno === 'number' ? ev.lineno : '?';
        console.error('[yomitan-shim] window error: ' + file + ':' + line
            + '  ' + (ev.message || '(no message)'));
        if (ev.error && ev.error.stack) {
            console.error('[yomitan-shim] error stack: ' + ev.error.stack);
        }
    });

    // Worker construction diagnostics. In BACKEND mode the worker URL now
    // resolves same-origin (immersion://yomitan/js/...), which is the whole
    // point of this architecture. In TOP/SUBFRAME we keep logging in case a
    // rogue Worker construction slips in — it will still fail there, but at
    // least we'll see it.
    const OriginalWorker = window.Worker;
    if (typeof OriginalWorker === 'function') {
        const LoggingWorker = function(url, options) {
            const urlStr = String(url);
            const type = (options && options.type) || 'classic';
            console.error('[yomitan-shim] new Worker(' + urlStr
                + ', type=' + type + ') in ' + window.location.href);
            try {
                const w = new OriginalWorker(url, options);
                w.addEventListener('error', (ev) => {
                    console.error('[yomitan-shim] Worker error '
                        + urlStr + ': ' + (ev.message || '(no message)')
                        + ' @ ' + (ev.filename || '?') + ':' + (ev.lineno || '?'));
                });
                w.addEventListener('messageerror', () => {
                    console.error('[yomitan-shim] Worker messageerror ' + urlStr);
                });
                return w;
            } catch (e) {
                console.error('[yomitan-shim] Worker ctor threw for '
                    + urlStr + ': ' + ((e && (e.stack || e.message)) || e));
                throw e;
            }
        };
        LoggingWorker.prototype = OriginalWorker.prototype;
        try { window.Worker = LoggingWorker; } catch (_) {}
    }

    // Subframe document-lifecycle trace — handy when a popup iframe or other
    // subframe hangs and we need to know whether it ran at all.
    if (IS_SUBFRAME || IS_BACKEND) {
        const label = IS_BACKEND ? 'backend' : 'subframe';
        const trace = (stage) => console.error('[yomitan-shim:' + label + '] '
            + stage + ' (readyState=' + document.readyState
            + ' @ ' + window.location.href + ')');
        trace('doc: script-start');
        document.addEventListener('readystatechange',
            () => trace('doc: readystatechange'));
        document.addEventListener('DOMContentLoaded',
            () => trace('doc: DOMContentLoaded'));
        window.addEventListener('load', () => trace('doc: load'));
    }

    const mode = IS_BACKEND ? 'backend' : (IS_TOP ? 'top' : 'subframe');
    console.error('[yomitan-shim] installed (' + mode
        + ' @ ' + window.location.href
        + '; real: ' + Object.keys(chromeShim).join(',')
        + '; existing: ' + Object.keys(existing).join(',') + ')');
})();
