# Yomitan Integration Plan

Status: **audit phase complete, ready for Phase 3 (bundling)**.
Last updated: 2026-04-17.

This document is the handoff for embedding Yomitan into Immersion-App so the
hover popup behaves 1:1 with the Chrome extension. Read the "TL;DR" first; the
rest is reference for whoever picks this up.

---

## TL;DR

- We're going with **Plan B**: fork Yomitan, strip its extension shell, run the
  remaining JS inside our QWebEngine WebView. The fork is intentionally
  frozen — Yomitan is mature enough that we don't need upstream tracking.
- Yomitan is cloned (shallow, gitignored) at `vendor/yomitan/` from upstream
  HEAD `3a7c5e5` ("Hash media names instead of using date when sending to
  Anki", #2370).
- **Big win discovered during audit**: the actual lookup engine
  (`ext/js/language/translator.js`, 2517 lines) and storage
  (`ext/js/dictionary/dictionary-database.js`, 883 lines) have **zero**
  `chrome.*` API calls. They're pure JS over IndexedDB. The chrome.* surface
  only matters for the surrounding extension shell (settings sync, options
  storage, hotkeys, badges, cross-frame popup positioning, Anki integration).
  This means we can call `Translator` directly without shimming most of the
  extension API.
- Estimate revised down: ~1–2 weeks of focused work for popup parity (was 2–4).
  Settings UI parity, Anki, and audio download are larger and out of scope for
  the first cut.

---

## Why we're doing this

The current stack (`src/dictionary/jitendex.py` + `web/dictionary/overlay.js`)
gets close but not 1:1 with Yomitan for ranking, deinflection edge cases, and
display formatting. The user explicitly wants 1:1 with Chrome Yomitan output
for every word. Re-implementing Yomitan's translator is years of work; embedding
it is days-to-weeks. The user accepted the trade-off of maintaining a frozen
fork.

Prior attempts in this repo:
- Frequency ranking via JMdict priority tags only — works for some homophones
  but missed the JPDBv2 frequency dataset Yomitan uses for finer ordering.
- The example that exposed this: 「の」 should rank the **particle** first; ours
  ranked 野 first because we lacked frequency data.

---

## Current state of the repo

- `vendor/` is gitignored (`.gitignore` line 60). Yomitan lives at
  `vendor/yomitan/`. **Re-clone with `git clone --depth=1
  https://github.com/yomidevs/yomitan.git vendor/yomitan` if missing.** Pin to
  `3a7c5e5` if drift becomes an issue.
- The Python dictionary backends (`src/dictionary/jitendex.py`,
  `src/dictionary/jmdict.py`) were optimized in the prior session (persistent
  SQLite connection, batched UNION query, LRU cache, `_merge_reading_variants`,
  `_entry_score` tag-based ranking, `ORDER BY entry_id` to fix UNION's
  lexicographic-DISTINCT default). These remain the active code path and stay
  active until Phase 6 cuts over.
- `web/dictionary/overlay.js` is the active popup. It was tuned for
  responsiveness (DEBOUNCE_MS 80→16, JS lookup cache, real-height popup
  measurement, `caretRangeFromPoint` off-by-one probe, max-height 320,
  follow-cursor on same-chunk). This is what gets replaced in Phase 6.

---

## Audit findings

### Build system

Yomitan has **no production bundler**. `dev/bin/build.js` (293 lines) just
zips `ext/` for the webstore. Modules load natively as ES modules from
extension URLs. Implication: we can either bundle ourselves with esbuild
(already a Yomitan devDep) **or** serve `vendor/yomitan/ext/` as-is via a
custom URL scheme handler and load `js/app/content-script-main.js` as a
`<script type="module">`. The second path is much simpler given QWebEngine
already supports custom schemes — recommend starting there.

### chrome.* API surface (252 calls across 34 files)

Distribution is heavily skewed:
- **`backend.js` alone: 99 calls.** This is the service worker. We're not
  using it — `Translator` is callable directly.
- **`extension/web-extension.js` (137 lines)**: thin chrome.runtime wrapper
  that's already factored. Easy to swap for a no-op or in-process equivalent.
- **`app/content-script-main.js` (48 lines)**: clean entry point, calls
  `Application.main(false, async (application) => {...})`. The body wires up
  `HotkeyHandler`, `PopupFactory`, `Frontend`. This is what we want to load.
- **`app/frontend.js` (1056 lines)**: 3 chrome.* calls. The popup driver.
  Minor shim work.
- **`app/popup.js` (1246 lines)**: 2 chrome.* calls. The popup itself. Minor
  shim work.
- **`language/`**: 0 chrome.* calls. Pure portable code.
- **`dictionary/`**: 0 chrome.* calls. Pure portable code.

Per-API call counts (top 15):

| API                            | Calls | Purpose                                    |
| ------------------------------ | ----- | ------------------------------------------ |
| `chrome.runtime.lastError`     | 44    | Error checking after async chrome calls    |
| `chrome.runtime.getURL`        | 25    | Resolve extension-relative URLs            |
| `chrome.tabs.Tab` (type)       | 14    | TS types only (no runtime cost)            |
| `chrome.runtime.getManifest`   | 12    | Read name/version                          |
| `chrome.runtime.onMessage`     | 11    | Cross-context messaging                    |
| `chrome.runtime.Port` (type)   | 8     | TS types                                   |
| `chrome.storage.session`       | 6     | Welcome-page state (skippable)             |
| `chrome.permissions.*`         | 16    | Optional perms UI (skippable)              |
| `chrome.windows.*`             | 11    | Pop-out window mode (skippable)            |
| `chrome.commands.*`            | 9     | Keyboard shortcut config UI (skippable)    |
| `chrome.declarativeNetRequest` | 9     | CORS bypass for audio (defer)              |
| `chrome.scripting.*`           | 5     | Cross-frame inject (skippable, single doc) |
| `chrome.action.*`              | 5     | Toolbar badge (N/A)                        |
| `chrome.contextMenus.*`        | 3     | Right-click menu (skippable)               |
| `chrome.offscreen.*`           | 2     | MV3 audio playback (defer)                 |

The **must-shim minimum** for popup parity:
1. `chrome.runtime.getURL(path)` → resolves to our custom scheme
   (`immersion://yomitan/${path}` or `file://`).
2. `chrome.runtime.getManifest()` → return a synthetic manifest
   (`{name: 'Immersion-Yomitan', version: '<our-version>', manifest_version: 3}`).
3. `chrome.runtime.onMessage` / `sendMessage` → in-process EventDispatcher
   wrapper (since there's no service worker).
4. `chrome.storage.local` / `.session` → wrap `localStorage` / a Map; the data
   here is the options object.
5. `chrome.runtime.lastError` → null (no real chrome API to error from).

Everything else can throw "not implemented" at first and be filled in only
where popup paths actually hit it. Use in-browser testing to find the gaps.

### Module structure / entry points

- Content side (what we want): `ext/js/app/content-script-main.js` →
  `Application.main()` → wires `HotkeyHandler` + `PopupFactory` + `Frontend`.
- Background side (what we **don't** want): `ext/sw.js` → 17-line import of
  `js/background/background-main.js` → `Backend` (3002 lines, all the
  chrome.* surface). The Backend's role is to host the database/translator
  and serve API requests. We replace it with **direct in-process instantiation**
  of `DictionaryDatabase` + `Translator`.

The `comm/api.js` layer is the contract between content and backend. It
expects async message round-trips. We keep the same API contract but resolve
calls locally — saves rewriting all callers.

### Dictionary data

Yomitan stores dictionaries in **IndexedDB** (Dexie). Our existing dicts are
**SQLite** in `data/dicts/jmdict.sqlite` and `data/dicts/jitendex.sqlite`,
built by `scripts/build_jmdict.py` / `scripts/build_jitendex.py` from Yomitan
ZIP exports.

Two paths:
- **Path A (recommended)**: Run Yomitan's own `DictionaryImporter`
  (`ext/js/dictionary/dictionary-importer.js`, 1015 lines) on the original
  ZIPs to populate IndexedDB on first launch. The user keeps the ZIPs in
  `data/dicts/`. This gets us identical data shape.
- **Path B**: Write a SQLite→IndexedDB transformer. Complex, fragile, no
  upside — only saves the user from re-importing once.

Pick Path A. The importer is portable (zero chrome.* calls in
`dictionary/`).

---

## Phases

| #  | Phase                  | Status | Notes                                       |
| -- | ---------------------- | ------ | ------------------------------------------- |
| 1  | Clone Yomitan          | ✅      | `vendor/yomitan/` @ 3a7c5e5                 |
| 2  | Audit                  | ✅      | This document                               |
| 3  | Serve Yomitan to view  | ⬜      | Custom URL scheme handler in PyQt           |
| 4  | Shim chrome.* APIs     | ⬜      | Minimum 5 APIs above                        |
| 5  | Dictionary import      | ⬜      | Run DictionaryImporter on data/dicts/*.zip  |
| 6  | Cut over popup         | ⬜      | Replace overlay.js + immersion:// content   |
| 7  | Settings UI decision   | ⬜      | Reuse Yomitan's, ours, or hardcode defaults |
| 8  | Verify against Chrome  | ⬜      | Side-by-side test pages                     |

### Phase 3: Serve Yomitan to the WebView

Add a `QWebEngineUrlSchemeHandler` for an `immersion://yomitan/...` scheme
(or extend the existing one) that maps to `vendor/yomitan/ext/`. Set MIME
types correctly (`.js` → `text/javascript`). Load
`immersion://yomitan/js/app/content-script-main.js` as a module script in
the page that currently loads `web/dictionary/overlay.js`.

### Phase 4: Shim the 5 must-have chrome APIs

Create `web/dictionary/yomitan-shim.js` that runs **before** any Yomitan
script and assigns a fake `window.chrome` object. Implement the 5 APIs above.
Keep the shim small — every other chrome.* call should throw
`Error('not implemented: chrome.X')` so we discover what we're missing during
testing rather than silently no-oping.

### Phase 5: Dictionary import

Replace the in-process `Backend` with a thin host that:
- Instantiates `DictionaryDatabase`, calls `prepare()`.
- On first launch, runs `DictionaryImporter` over each ZIP in `data/dicts/`.
- Instantiates `Translator(database)` and exposes it via the same API surface
  `comm/api.js` expects.

### Phase 6: Cut over popup

Stop loading `web/dictionary/overlay.js`. The Yomitan content script takes
over. Disable the Python lookup endpoint or leave it as a fallback during
verification.

### Phase 7: Settings UI

Yomitan's settings UI is the largest single piece of code in the project
(many `pages/settings/*` files). Three options:
1. Hardcode sensible defaults, no UI. Fastest. Defer until users complain.
2. Build a tiny PyQt settings panel that writes to the same options shape
   Yomitan expects. Native feel, lots of work.
3. Embed Yomitan's options page in another QWebEngine view. Most parity, more
   chrome.* shimming.

Recommend (1) for v1, (3) eventually if the user wants tunable themes/scan
behavior/Anki integration.

### Phase 8: Verification

Run side-by-side: Chrome with Yomitan + Immersion-App on the same paragraph
of Japanese text. Capture the top 5 entries for each token and diff. The
known divergence points to test:
- Particle homophones (の, は, に, と, で, へ, から).
- Common verbs with many entries (する, なる, いう).
- Conjugated forms exercising the deinflector.
- Mixed kana/kanji (おもう vs 思う).

---

## Where things live

**In our repo:**
- `vendor/yomitan/` — gitignored fork (re-clone if missing).
- `src/dictionary/jitendex.py`, `src/dictionary/jmdict.py` — current Python
  backends. Stay active until Phase 6.
- `web/dictionary/overlay.js` — current popup. Replaced in Phase 6.
- `data/dicts/*.zip` — Yomitan-format dictionary ZIPs (used by both current
  build scripts and Phase 5 importer).
- `scripts/build_jmdict.py`, `scripts/build_jitendex.py` — current SQLite
  builders. Become unused after Phase 5 but keep around as fallback.

**In Yomitan (read these to extend the plan):**
- `ext/js/app/content-script-main.js` (48 lines) — entry point.
- `ext/js/application.js` (293 lines) — bootstrap; calls
  `Application.main()`.
- `ext/js/extension/web-extension.js` (137 lines) — already-factored
  chrome.runtime wrapper; replace this whole class with our shim.
- `ext/js/comm/api.js` — the API contract between content and backend; we
  wire its handlers to in-process instances.
- `ext/js/language/translator.js` (2517 lines) — the actual lookup engine.
  Pure JS, no chrome.*.
- `ext/js/dictionary/dictionary-database.js` (883 lines) — IndexedDB layer.
  Pure JS, no chrome.*.
- `ext/js/dictionary/dictionary-importer.js` (1015 lines) — ZIP importer.
  Pure JS.
- `ext/js/background/backend.js` (3002 lines) — **the thing we're replacing**.
  Read it for the wiring patterns it uses to instantiate Translator/Database.
- `ext/sw.js` (17 lines) — service worker entry; ignore.
- `ext/js/background/background-main.js` (32 lines) — same; ignore.

---

## Risks / unknowns

- **Custom-scheme + ES modules + import maps**: QWebEngine's behavior with
  module imports under a custom scheme isn't fully verified. If module
  resolution breaks, fall back to bundling with esbuild (Yomitan ships it as
  a devDep already).
- **WASM**: `dictionary-database.js` imports `lib/resvg-wasm.js` for SVG
  rendering. Confirm WASM loads under our scheme (or skip if it's only used
  for Anki).
- **IndexedDB quota in QWebEngine**: Yomitan's full dataset is hundreds of MB.
  Verify QWebEngine doesn't impose a stricter quota than Chromium default.
- **Fonts/CSS**: Yomitan's popup uses extension-relative URLs in CSS too
  (`url(/images/...)` etc.). The custom scheme must serve these, not just JS.
- **Cross-frame popup**: Yomitan supports popup-in-iframe via cross-frame
  messaging. We have a single document so this is moot — `useProxyPopup:
  false` in `content-script-main.js` is correct for us.

---

## Quick reference for the next session

If you're picking this up cold, do these in order:
1. Confirm `vendor/yomitan/` exists; if not, re-clone (instructions above).
2. Read this doc top-to-bottom.
3. Read `vendor/yomitan/ext/js/app/content-script-main.js` (48 lines) and
   `vendor/yomitan/ext/js/application.js` (293 lines) to internalize the
   bootstrap flow.
4. Start Phase 3.
