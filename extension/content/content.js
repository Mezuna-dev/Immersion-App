(function () {
  'use strict';

  // Guard against double-injection on SPA navigations.
  if (window.__immDictLoaded) return;
  window.__immDictLoaded = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const SCAN_LEN    = 25;   // characters to extract from the caret position
  const DEBOUNCE_MS = 16;   // ~one frame — coalesces rapid mousemoves
  const CACHE_MAX   = 512;  // LRU cap for lookup results

  // ── State ──────────────────────────────────────────────────────────────────
  let shadowHost        = null;
  let shadowRoot        = null;
  let popupEl           = null;
  let debounceTimer     = null;
  let hideTimer         = null;
  let shiftHeld         = false;
  let popupHovered      = false;
  let lastChunk         = null;   // chunk currently shown / in flight
  let latestLookupChunk = null;   // staleness guard for async responses
  let lastShownKey      = null;   // identity of rendered content (avoids redundant innerHTML)
  const _cache          = new Map();

  // ── Japanese character detection ───────────────────────────────────────────
  function isJapanese(ch) {
    const c = ch.charCodeAt(0);
    return (
      (c >= 0x3040 && c <= 0x30FF) || // Hiragana + Katakana
      (c >= 0x4E00 && c <= 0x9FFF) || // CJK unified ideographs
      (c >= 0x3400 && c <= 0x4DBF) || // CJK Extension A
      (c >= 0xFF65 && c <= 0xFF9F)    // Halfwidth Katakana
    );
  }

  // ── Inline element set — text flows through these without a block break ────
  const _INLINE = new Set([
    'A','ABBR','B','BDI','BDO','CITE','CODE','DATA','DFN','EM','FONT',
    'I','KBD','MARK','Q','RUBY','S','SAMP','SMALL','SPAN','STRONG',
    'SUB','TIME','U','VAR','WBR','INS','DEL',
  ]);

  // ── Walk DOM forward from startNode to gather up to maxLen characters ──────
  function collectForwardText(startNode, maxLen) {
    let root = startNode.parentNode;
    while (root && root !== document.body && _INLINE.has(root.nodeName)) {
      root = root.parentNode;
    }
    if (!root) root = document.body;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let el = node.parentNode;
        while (el && el !== root) {
          if (el.nodeName === 'RT' || el.nodeName === 'RP') return NodeFilter.FILTER_REJECT;
          el = el.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    walker.currentNode = startNode;
    let text = '';
    while (text.length < maxLen && walker.nextNode()) {
      text += walker.currentNode.textContent.slice(0, maxLen - text.length);
    }
    return text;
  }

  // ── Cross-browser caret-at-point ───────────────────────────────────────────
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.collapse(true);
      return r;
    }
    return null;
  }

  // ── Extract the Japanese text chunk starting at the cursor position ─────────
  function getChunkAtPoint(x, y) {
    const range = caretAt(x, y);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    let node = range.startContainer.parentNode;
    while (node && node !== document.body) {
      if (node.nodeName === 'RT' || node.nodeName === 'RP') return null;
      node = node.parentNode;
    }

    const textNode = range.startContainer;
    let   offset   = range.startOffset;

    // caretRangeFromPoint places the caret between glyphs — probe the previous
    // character's bounding box and step back if the cursor is visually inside it.
    if (offset > 0) {
      try {
        const probe = document.createRange();
        probe.setStart(textNode, offset - 1);
        probe.setEnd(textNode, offset);
        const pr = probe.getBoundingClientRect();
        if (pr.width > 0 && pr.height > 0 &&
            x >= pr.left && x <= pr.right &&
            y >= pr.top  && y <= pr.bottom) {
          offset -= 1;
        }
      } catch (_) {}
    }

    let chunk = textNode.textContent.slice(offset, offset + SCAN_LEN);
    if (chunk.length < SCAN_LEN) {
      chunk += collectForwardText(textNode, SCAN_LEN - chunk.length);
    }

    if (!chunk || !isJapanese(chunk[0])) return null;
    return { chunk, textNode, offset };
  }

  // ── LRU cache ─────────────────────────────────────────────────────────────
  function cacheGet(key) {
    if (!_cache.has(key)) return undefined;
    const v = _cache.get(key);
    _cache.delete(key);
    _cache.set(key, v);
    return v;
  }

  function cachePut(key, value) {
    _cache.set(key, value);
    if (_cache.size > CACHE_MAX) {
      _cache.delete(_cache.keys().next().value);
    }
  }

  // ── HTML escaping ──────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Gloss cleanup ──────────────────────────────────────────────────────────
  const _POS_TERMS = new Set([
    'noun','verb','adjective','adverb','particle','conjunction','copula',
    'interjection','pronoun','prefix','suffix','counter','expression',
    'transitive','intransitive','auxiliary','prenominal','adnominal',
    '1-dan','5-dan','ichidan','godan','irregular','suru','kana',
    'na-adjective','i-adjective','no-adjective',
    'archaic','colloquial','honorific','humble','formal','informal',
    'slang','literary','dated','rare','vulgar','familiar','male',
    'female','polite','derogatory','abbreviation','onomatopoeia',
  ]);

  const _NOISE = new Set([
    'jmdict','see also','also written as','note','notes',
    'used with','★','priority','form','forms','links',
    'tatoeba','this','|','—','-','/','language of origin','man','boy',
  ]);

  function _hasJP(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF) ||
          (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xFF00 && c <= 0xFFEF)) return true;
    }
    return false;
  }

  function _isNoise(s) {
    if (_NOISE.has(s.toLowerCase())) return true;
    if (_hasJP(s)) return true;
    if (s.length <= 2 && !/^[a-zA-Z]{1,2}$/.test(s)) return true;
    if (/^\[\d+\]$/.test(s)) return true;
    if (/[.!?]$/.test(s) && s.split(/\s+/).length >= 2) return true;
    if (/^[A-Z][a-z]/.test(s) && s.split(/\s+/).length >= 4) return true;
    if (/^[A-Z][a-z]+:\s/.test(s)) return true;
    return false;
  }

  function _cleanSense(sense) {
    const tags = [];
    const defs = [];

    for (const p of (sense.pos || [])) {
      const lp = p.toLowerCase().trim();
      if (_POS_TERMS.has(lp)) tags.push(p);
    }

    for (const g of (sense.glosses || [])) {
      const t = g.trim();
      if (!t) continue;
      const lo = t.toLowerCase();
      if (_POS_TERMS.has(lo))  { tags.push(t); continue; }
      if (_isNoise(t))         continue;
      const cleaned = t.replace(/^[①-⑳]\s*/, '');
      if (cleaned && !_isNoise(cleaned)) defs.push(cleaned);
    }

    const seen = new Set();
    const uniqueTags = [];
    for (const t of tags) {
      const lo = t.toLowerCase();
      if (!seen.has(lo)) { seen.add(lo); uniqueTags.push(t); }
    }

    return { tags: uniqueTags, defs };
  }

  // ── Tag colour class ───────────────────────────────────────────────────────
  function _tagClass(label) {
    const l = label.toLowerCase();
    if (l === 'common')         return 'etag-common';
    if (l === 'news')           return 'etag-news';
    if (l === 'loanword')       return 'etag-loan';
    if (l.startsWith('top '))   return 'etag-freq';
    if (l === 'spec')           return 'etag-spec';
    if (l === 'priority form')  return 'etag-prio';
    return 'etag-misc';
  }

  // ── Ruby token rendering ───────────────────────────────────────────────────
  function _renderRuby(tokens) {
    if (!tokens || !tokens.length) return '';
    let out = '';
    for (const t of tokens) {
      if (typeof t === 'string') {
        out += esc(t);
      } else if (Array.isArray(t) && t.length >= 2) {
        out += `<ruby>${esc(t[0])}<rt>${esc(t[1])}</rt></ruby>`;
      }
    }
    return out;
  }

  function _renderHeadword(kanji, readings) {
    if (kanji.length && readings.length) {
      let html = `<ruby class="head-ruby">${esc(kanji[0])}<rt>${esc(readings[0])}</rt></ruby>`;
      if (kanji.length > 1) {
        html += `<span class="alt-kanji">${kanji.slice(1, 3).map(esc).join('・')}</span>`;
      }
      return html;
    }
    const all = kanji.length ? kanji : readings;
    return `<span class="head-plain">${all.slice(0, 3).map(esc).join('・')}</span>`;
  }

  // ── Forms table ────────────────────────────────────────────────────────────
  const _FORM_PRIORITY_LABEL = {
    'form-pri':   'high priority',
    'form-valid': 'valid',
    'form-rare':  'rare',
    'form-irreg': 'irregular',
    'form-sk':    'search only',
  };

  function _renderForms(forms) {
    if (!forms) return '';
    const kanji    = forms.kanji    || [];
    const readings = forms.readings || [];
    if (!kanji.length && !readings.length) return '';

    let html = '<div class="forms"><div class="forms-label">forms</div>';
    if (kanji.length) {
      html += `<div class="forms-kanji">${kanji.map(esc).join('、')}</div>`;
    }
    if (readings.length) {
      html += '<div class="forms-readings">';
      for (const r of readings) {
        const cls   = r.priority ? ` ${esc(r.priority)}` : '';
        const title = r.priority ? ` title="${esc(_FORM_PRIORITY_LABEL[r.priority] || r.priority)}"` : '';
        html += `<span class="form-reading${cls}"${title}>${esc(r.text)}</span>`;
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── Examples ───────────────────────────────────────────────────────────────
  function _renderExamples(examples) {
    if (!examples || !examples.length) return '';
    let html = '<div class="examples">';
    examples.slice(0, 2).forEach(ex => {
      const ja = _renderRuby(ex.ja);
      if (!ja && !ex.en) return;
      html += '<div class="example">';
      if (ja)    html += `<div class="example-ja">${ja}</div>`;
      if (ex.en) html += `<div class="example-en">${esc(ex.en)}</div>`;
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── Render entry list HTML ─────────────────────────────────────────────────
  function renderEntries(data) {
    const { entries, error, reason, source } = data;

    if (error) return `<div class="error">${esc(error)}</div>`;
    if (!entries || !entries.length) return '';

    let html = '<div class="list">';

    for (const entry of entries) {
      html += '<div class="entry">';

      const kanji    = entry.kanji_forms   || [];
      const readings = entry.reading_forms || [];

      html += '<div class="word-head"><div class="kanji-row">';
      html += _renderHeadword(kanji.slice(0, 3), readings.slice(0, 3));
      if (reason) html += `<span class="reason">${esc(reason)}</span>`;
      html += '</div></div>';

      const entryTags = entry.tags || [];
      if (entryTags.length) {
        html += '<div class="entry-tags">';
        entryTags.forEach(t => {
          html += `<span class="etag ${_tagClass(t)}">${esc(t)}</span>`;
        });
        html += '</div>';
      }

      html += '<div class="senses">';
      (entry.senses || []).slice(0, 6).forEach((sense, i) => {
        const { tags, defs } = _cleanSense(sense);
        if (!tags.length && !defs.length) return;
        html += '<div class="sense">';
        if (tags.length) {
          html += '<div class="pos-row">';
          tags.forEach(t => { html += `<span class="pos">${esc(t)}</span>`; });
          html += '</div>';
        }
        if (defs.length) {
          html += '<div class="gloss-list">';
          defs.slice(0, 5).forEach(g => {
            html += `<div class="gloss"><span class="gloss-num">${i + 1}.</span> ${esc(g)}</div>`;
          });
          html += '</div>';
        }
        html += _renderExamples(sense.examples);
        html += '</div>';
      });
      html += '</div>';

      html += _renderForms(entry.forms);
      html += '</div>';
    }

    if (source) html += `<div class="source">${esc(source)}</div>`;
    html += '</div>';
    return html;
  }

  // ── Popup CSS (injected into shadow root — isolated from page styles) ───────
  const POPUP_CSS = `
    :host { all: initial; }

    #popup {
      position: fixed;
      width: 440px;
      max-height: 320px;
      background: #1a1726;
      border: 1px solid rgba(120, 100, 180, 0.18);
      border-radius: 14px;
      box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.35),
        0 16px 48px rgba(0, 0, 0, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 14px;
      color: #ddd;
      overflow: hidden;
      display: none;
      z-index: 2147483647;
    }

    .list { max-height: 320px; overflow-y: auto; }
    .list::-webkit-scrollbar       { width: 6px; }
    .list::-webkit-scrollbar-track { background: transparent; }
    .list::-webkit-scrollbar-thumb { background: rgba(120,100,180,.25); border-radius: 3px; }
    .list::-webkit-scrollbar-thumb:hover { background: rgba(120,100,180,.4); }

    .entry { padding: 14px 20px 16px; border-bottom: 1px solid rgba(120,100,180,.10); }
    .entry:last-child { border-bottom: none; }

    .word-head { margin-bottom: 10px; }
    .kanji-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }

    .head-ruby { font-size: 26px; font-weight: 700; color: #f0e6ff; letter-spacing: .02em; ruby-position: over; line-height: 1.1; }
    .head-ruby rt { font-size: 11px; font-weight: 500; color: rgba(180,160,220,.70); letter-spacing: .04em; }
    .head-plain { font-size: 26px; font-weight: 700; color: #f0e6ff; letter-spacing: .02em; }
    .alt-kanji  { font-size: 14px; color: rgba(200,185,230,.55); align-self: center; }

    .reason {
      display: inline-block; padding: 2px 8px 3px; font-size: 10px; font-weight: 600;
      color: rgba(180,160,220,.80); background: rgba(120,100,180,.13);
      border: 1px solid rgba(120,100,180,.10); border-radius: 5px;
      letter-spacing: .3px; text-transform: lowercase; white-space: nowrap;
    }

    .entry-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
    .etag { font-size: 10px; font-weight: 700; padding: 2px 8px 3px; border-radius: 4px; letter-spacing: .3px; text-transform: lowercase; white-space: nowrap; }
    .etag-common { color: #7ee8a8; background: rgba(60,190,120,.14);  border: 1px solid rgba(60,190,120,.20); }
    .etag-freq   { color: #e8c86e; background: rgba(210,180,60,.12);  border: 1px solid rgba(210,180,60,.18); }
    .etag-news   { color: #7ec4e8; background: rgba(60,160,210,.12);  border: 1px solid rgba(60,160,210,.18); }
    .etag-loan   { color: #d8a0e8; background: rgba(180,100,220,.12); border: 1px solid rgba(180,100,220,.18); }
    .etag-spec   { color: #b0a8c0; background: rgba(150,140,170,.12); border: 1px solid rgba(150,140,170,.15); }
    .etag-misc   { color: #b0a8c0; background: rgba(150,140,170,.10); border: 1px solid rgba(150,140,170,.12); }
    .etag-prio   { color: #f0c878; background: rgba(230,180,80,.12);  border: 1px solid rgba(230,180,80,.20); }

    .senses { display: flex; flex-direction: column; gap: 10px; }
    .sense  { line-height: 1.55; }

    .pos-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
    .pos {
      font-size: 10px; color: #c4b5f0; text-transform: lowercase; letter-spacing: .3px;
      font-weight: 600; padding: 3px 9px; background: rgba(100,80,180,.18);
      border: 1px solid rgba(140,115,220,.22); border-radius: 5px; white-space: nowrap;
    }

    .gloss-list { display: flex; flex-direction: column; gap: 2px; }
    .gloss      { color: rgba(230,222,245,.90); font-size: 13.5px; line-height: 1.55; padding-left: 4px; }
    .gloss-num  { color: rgba(160,145,200,.55); font-size: 12px; font-weight: 600; margin-right: 2px; }

    .examples {
      margin: 6px 0 0 4px; display: flex; flex-direction: column; gap: 6px;
      border-left: 2px solid rgba(120,100,180,.18); padding: 4px 0 4px 10px;
    }
    .example-ja { font-size: 13px; color: rgba(230,222,245,.85); line-height: 1.9; }
    .example-ja ruby rt { font-size: 9px; color: rgba(180,160,220,.60); font-weight: 400; }
    .example-en { font-size: 12px; color: rgba(190,180,215,.65); font-style: italic; line-height: 1.5; margin-top: 1px; }

    .forms {
      margin-top: 12px; padding: 8px 10px;
      background: rgba(120,100,180,.06); border: 1px solid rgba(120,100,180,.12); border-radius: 6px;
    }
    .forms-label    { font-size: 9.5px; font-weight: 700; color: rgba(180,160,220,.50); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 4px; }
    .forms-kanji    { font-size: 14px; color: #e8dcff; font-weight: 600; margin-bottom: 4px; }
    .forms-readings { display: flex; flex-wrap: wrap; gap: 6px; }
    .form-reading   { font-size: 12px; color: rgba(210,200,235,.65); padding: 1px 6px; border-radius: 4px; background: rgba(120,100,180,.10); border: 1px solid rgba(120,100,180,.12); }
    .form-reading.form-pri  { color: #f0c878; background: rgba(230,180,80,.10); border-color: rgba(230,180,80,.22); }
    .form-reading.form-rare { color: rgba(180,160,220,.45); }

    .source {
      padding: 8px 20px 10px; font-size: 10px; color: rgba(160,145,200,.40);
      text-align: right; letter-spacing: .3px; border-top: 1px solid rgba(120,100,180,.08);
    }
    .error { padding: 18px 20px; color: #f08080; font-size: 13px; line-height: 1.6; }
  `;

  // ── Word highlight (CSS Custom Highlight API) ──────────────────────────────
  // The ::highlight(immersion-match) rule lives in content.css (page-level).
  function applyHighlight(textNode, offset, length) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    try {
      const r = document.createRange();
      r.setStart(textNode, offset);
      r.setEnd(textNode, Math.min(offset + length, textNode.length));
      CSS.highlights.set('immersion-match', new Highlight(r));
    } catch (_) {}
  }

  function clearHighlight() {
    try {
      if (window.CSS && CSS.highlights) CSS.highlights.delete('immersion-match');
    } catch (_) {}
  }

  // ── Popup DOM setup ────────────────────────────────────────────────────────
  function ensurePopup() {
    if (shadowHost && document.body.contains(shadowHost)) return;

    shadowHost = document.createElement('div');
    shadowHost.id = '__imm_dict_host';
    Object.assign(shadowHost.style, {
      position: 'fixed', top: '0', left: '0',
      width: '0', height: '0',
      zIndex: '2147483647', pointerEvents: 'none',
    });
    document.body.appendChild(shadowHost);

    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = POPUP_CSS;
    shadowRoot.appendChild(style);

    popupEl = document.createElement('div');
    popupEl.id = 'popup';
    shadowRoot.appendChild(popupEl);

    popupEl.addEventListener('mouseenter', () => {
      popupHovered = true;
      clearTimeout(hideTimer);
    });
    popupEl.addEventListener('mouseleave', () => {
      popupHovered = false;
      if (!shiftHeld) scheduleHide(200);
    });
  }

  // ── Show / position / hide ─────────────────────────────────────────────────
  function showPopup(data, x, y, textNode, offset) {
    ensurePopup();

    const renderKey = (data.matched || '') + '|' + (data.reason || '');
    const wasHidden = popupEl.style.display === 'none' || popupEl.style.display === '';

    if (renderKey !== lastShownKey || wasHidden) {
      const html = renderEntries(data);
      if (!html) { hidePopup(); return; }
      if (wasHidden) {
        popupEl.style.left = '-9999px';
        popupEl.style.top  = '-9999px';
      }
      popupEl.innerHTML = html;
      lastShownKey = renderKey;
    }

    if (data.matched && textNode != null && offset != null) {
      applyHighlight(textNode, offset, data.matched.length);
    }

    popupEl.style.display = 'block';
    shadowHost.style.pointerEvents = 'auto';
    positionPopup(x, y, textNode, offset);
  }

  function positionPopup(x, y, textNode, offset) {
    if (!popupEl || popupEl.style.display === 'none') return;

    const GAP = 8, MARGIN = 10;
    const popupRect = popupEl.getBoundingClientRect();
    const W = popupRect.width  || 440;
    const H = popupRect.height || 200;

    let lineBottom = y + 20;
    let lineTop    = y;
    let anchorLeft = x;

    if (textNode != null && offset != null) {
      try {
        const r = document.createRange();
        r.setStart(textNode, offset);
        r.setEnd(textNode, Math.min(offset + 1, textNode.length));
        const rect = r.getBoundingClientRect();
        if (rect.height > 0) {
          lineBottom = rect.bottom;
          lineTop    = rect.top;
          anchorLeft = rect.left;
        }
      } catch (_) {}
    }

    let left = anchorLeft;
    if (left + W > window.innerWidth - MARGIN) left = window.innerWidth - W - MARGIN;
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = window.innerHeight - lineBottom - GAP - MARGIN;
    const spaceAbove = lineTop - GAP - MARGIN;
    let top;
    if      (H <= spaceBelow)          top = lineBottom + GAP;
    else if (H <= spaceAbove)          top = lineTop - H - GAP;
    else if (spaceBelow >= spaceAbove) top = lineBottom + GAP;
    else                               top = lineTop - H - GAP;

    if (top < MARGIN) top = MARGIN;
    if (top + H > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - H - MARGIN);

    popupEl.style.left = left + 'px';
    popupEl.style.top  = top  + 'px';
  }

  function scheduleHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePopup, delay);
  }

  function hidePopup() {
    if (popupEl)    { popupEl.style.display = 'none'; }
    if (shadowHost) { shadowHost.style.pointerEvents = 'none'; }
    popupHovered = false;
    lastChunk    = null;
    lastShownKey = null;
    clearHighlight();
  }

  // ── Lookup via background WebSocket connection ─────────────────────────────
  async function doLookup(chunk, x, y, textNode, offset) {
    latestLookupChunk = chunk;

    const cached = cacheGet(chunk);
    if (cached !== undefined) {
      onResult(cached, chunk, x, y, textNode, offset);
      return;
    }

    let result;
    try {
      result = await chrome.runtime.sendMessage({ action: 'lookup', text: chunk });
    } catch (_) {
      return;
    }

    cachePut(chunk, result ?? null);
    onResult(result, chunk, x, y, textNode, offset);
  }

  // ── Result handler ────────────────────────────────────────────────────────
  function onResult(data, chunk, x, y, textNode, offset) {
    if (chunk !== latestLookupChunk) return;  // stale response — a newer hover won
    if (!data || (!data.entries?.length && !data.error)) {
      if (!popupHovered) hidePopup();
      return;
    }
    showPopup(data, x, y, textNode, offset);
  }

  // ── Event wiring ───────────────────────────────────────────────────────────
  document.addEventListener('mousemove', (e) => {
    shiftHeld = e.shiftKey;

    if (!e.shiftKey) {
      clearTimeout(debounceTimer);
      if (popupEl && popupEl.style.display === 'block' && !popupHovered) {
        scheduleHide(150);
      }
      return;
    }

    const x = e.clientX;
    const y = e.clientY;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const hit = getChunkAtPoint(x, y);
      if (!hit) {
        lastChunk = null;
        if (!popupHovered) hidePopup();
        return;
      }
      // Same chunk still under the cursor — reposition without re-fetching.
      if (hit.chunk === lastChunk && popupEl && popupEl.style.display === 'block') {
        positionPopup(x, y, hit.textNode, hit.offset);
        return;
      }
      lastChunk = hit.chunk;
      doLookup(hit.chunk, x, y, hit.textNode, hit.offset);
    }, DEBOUNCE_MS);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (!popupHovered) scheduleHide(200);
    }
  });

  // Dismiss on click outside the popup.
  document.addEventListener('click', () => {
    if (!popupHovered) hidePopup();
  }, true);

  // Dismiss on scroll — popup position becomes stale.
  document.addEventListener('scroll', () => {
    if (!popupHovered) hidePopup();
  }, true);

})();
