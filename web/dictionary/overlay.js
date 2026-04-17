/**
 * Immersion Suite — Dictionary Overlay
 *
 * Injected into every browser-tab page via QWebEngineScript (ApplicationWorld).
 * ApplicationWorld isolates this script from the page's own JavaScript and
 * bypasses page Content-Security-Policy for the fetch() calls we make to the
 * custom immersion:// URL scheme.
 *
 * Triggers:
 *   • Shift + hover over Japanese text  →  show popup
 *   • Right-click selected text         →  Python calls window.__immersionLookup()
 */
(function () {
  'use strict';

  // Guard against double-injection on SPA navigations that re-run scripts.
  if (window.__immDictLoaded) return;
  window.__immDictLoaded = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const LOOKUP_URL   = 'immersion://dict/lookup?text=';
  const SCAN_LEN     = 25;   // max characters extracted from the cursor position
  const DEBOUNCE_MS  = 80;   // ms to wait after last mousemove before querying

  // ── State ──────────────────────────────────────────────────────────────────
  let shadowHost  = null;
  let shadowRoot  = null;
  let popupEl     = null;
  let debounceTimer  = null;
  let hideTimer      = null;
  let currentAbort   = null;
  let popupHovered   = false;
  let shiftHeld      = false;

  // Highlight state
  let _hlSheet = null;   // CSSStyleSheet for ::highlight rule

  // ── Japanese character detection ───────────────────────────────────────────
  function isJapanese(ch) {
    const c = ch.charCodeAt(0);
    return (
      (c >= 0x3040 && c <= 0x30FF) || // Hiragana + Katakana
      (c >= 0x4E00 && c <= 0x9FFF) || // CJK unified ideographs (common)
      (c >= 0x3400 && c <= 0x4DBF) || // CJK Extension A
      (c >= 0xFF65 && c <= 0xFF9F)    // Halfwidth Katakana
    );
  }

  // ── Inline element set (text flows through these without breaking) ─────────
  const _INLINE = new Set([
    'A','ABBR','B','BDI','BDO','CITE','CODE','DATA','DFN','EM','FONT',
    'I','KBD','MARK','Q','RUBY','S','SAMP','SMALL','SPAN','STRONG',
    'SUB','TIME','U','VAR','WBR','INS','DEL',
  ]);

  // ── Collect text forward across element boundaries ────────────────────────
  function collectForwardText(startNode, maxLen) {
    // Find the nearest block-level ancestor as walking boundary.
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

    // Position walker at startNode, then advance past it.
    walker.currentNode = startNode;
    let text = '';
    while (text.length < maxLen && walker.nextNode()) {
      text += walker.currentNode.textContent.slice(0, maxLen - text.length);
    }
    return text;
  }

  // ── Get Japanese text chunk at cursor position ─────────────────────────────
  function getChunkAtPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    // Skip <rt>/<rp> elements (furigana readings).
    let node = range.startContainer.parentNode;
    while (node && node !== document.body) {
      if (node.nodeName === 'RT' || node.nodeName === 'RP') return null;
      node = node.parentNode;
    }

    const textNode = range.startContainer;
    const offset   = range.startOffset;

    // Get text from the current node, then walk forward if we need more.
    let chunk = textNode.textContent.slice(offset, offset + SCAN_LEN);
    if (chunk.length < SCAN_LEN) {
      chunk += collectForwardText(textNode, SCAN_LEN - chunk.length);
    }

    if (!chunk || !isJapanese(chunk[0])) return null;
    return { chunk, textNode, offset };
  }

  // ── Fetch lookup result from Python via the custom URL scheme ──────────────
  async function fetchLookup(text, signal) {
    const url = LOOKUP_URL + encodeURIComponent(text);
    const res  = await fetch(url, signal ? { signal } : {});
    if (!res.ok) return null;
    return res.json();
  }

  // ── HTML escaping ──────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Gloss cleanup (POS / noise detection) ──────────────────────────────────
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
    'used with','\u2605','priority','form','forms','links',
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
    // Known noise terms
    if (_NOISE.has(s.toLowerCase())) return true;
    // Contains Japanese characters (example fragments, cross-refs)
    if (_hasJP(s)) return true;
    // Very short non-word strings (separators, single chars)
    if (s.length <= 2 && !/^[a-zA-Z]{1,2}$/.test(s)) return true;
    // Section markers like [1], [2]
    if (/^\[\d+\]$/.test(s)) return true;
    // Sentences: ends with . ! ? → example sentence (glosses never end with these)
    if (/[.!?]$/.test(s) && s.split(/\s+/).length >= 2) return true;
    // Starts with uppercase + looks like a sentence (4+ words)
    if (/^[A-Z][a-z]/.test(s) && s.split(/\s+/).length >= 4) return true;
    // Metadata patterns: "Chinese: ...", "Japanese: ...", etc.
    if (/^[A-Z][a-z]+:\s/.test(s)) return true;
    return false;
  }

  function _cleanSense(sense) {
    const tags = [];
    const defs = [];

    // Pull real POS from the pos field (skip junk like star, priority, form)
    for (const p of (sense.pos || [])) {
      const lp = p.toLowerCase().trim();
      if (_POS_TERMS.has(lp)) tags.push(p);
    }

    // Scan glosses: extract POS terms, filter noise, keep real definitions
    for (const g of (sense.glosses || [])) {
      const t = g.trim();
      if (!t) continue;
      const lo = t.toLowerCase();
      if (_POS_TERMS.has(lo))   { tags.push(t); continue; }
      if (_isNoise(t))          continue;
      // Strip leading circled numbers
      const cleaned = t.replace(/^[\u2460-\u2473]\s*/, '');
      if (cleaned && !_isNoise(cleaned)) defs.push(cleaned);
    }

    // Deduplicate tags (case-insensitive)
    const seen = new Set();
    const uniqueTags = [];
    for (const t of tags) {
      const lo = t.toLowerCase();
      if (!seen.has(lo)) { seen.add(lo); uniqueTags.push(t); }
    }

    return { tags: uniqueTags, defs };
  }

  // ── Tag colour class ────────────────────────────────────────────────────────
  function _tagClass(label) {
    const l = label.toLowerCase();
    if (l === 'common')                return 'etag-common';
    if (l === 'news')                  return 'etag-news';
    if (l === 'loanword')              return 'etag-loan';
    if (l.startsWith('top '))          return 'etag-freq';
    if (l === 'spec')                  return 'etag-spec';
    if (l === 'priority form')         return 'etag-prio';
    return 'etag-misc';
  }

  // ── Ruby token rendering ───────────────────────────────────────────────────
  // A token is either a plain string or a [base, rt] pair.
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

  // Headword: ruby-annotated kanji (reading sits above the kanji).
  function _renderHeadword(kanji, readings) {
    if (kanji.length && readings.length) {
      const base = esc(kanji[0]);
      const rt   = esc(readings[0]);
      let html = `<ruby class="head-ruby">${base}<rt>${rt}</rt></ruby>`;
      if (kanji.length > 1) {
        html += `<span class="alt-kanji">${kanji.slice(1, 3).map(esc).join('\u30FB')}</span>`;
      }
      return html;
    }
    const all = kanji.length ? kanji : readings;
    return `<span class="head-plain">${all.slice(0, 3).map(esc).join('\u30FB')}</span>`;
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
      html += '<div class="forms-kanji">' +
              kanji.map(esc).join('\u3001') +
              '</div>';
    }
    if (readings.length) {
      html += '<div class="forms-readings">';
      for (const r of readings) {
        const cls = r.priority ? ` ${esc(r.priority)}` : '';
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
    // Show at most 2 examples per sense to keep the popup compact.
    let html = '<div class="examples">';
    examples.slice(0, 2).forEach(ex => {
      const ja = _renderRuby(ex.ja);
      if (!ja && !ex.en) return;
      html += '<div class="example">';
      if (ja) html += `<div class="example-ja">${ja}</div>`;
      if (ex.en) html += `<div class="example-en">${esc(ex.en)}</div>`;
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── Render entry list HTML (injected into shadow DOM) ─────────────────────
  function renderEntries(data) {
    const { entries, error, reason, source } = data;

    if (error) {
      return `<div class="error">${esc(error)}</div>`;
    }
    if (!entries || !entries.length) return '';

    let html = '<div class="list">';

    for (const entry of entries) {
      html += '<div class="entry">';

      // ── Word heading: kanji with reading as ruby furigana ─────────────────
      const kanji    = entry.kanji_forms   || [];
      const readings = entry.reading_forms || [];

      html += '<div class="word-head">';
      html += '<div class="kanji-row">';
      html += _renderHeadword(kanji.slice(0, 3), readings.slice(0, 3));
      if (reason) {
        html += `<span class="reason">${esc(reason)}</span>`;
      }
      html += '</div>';
      html += '</div>';

      // ── Entry-level tags (common, priority form, news, frequency, etc.) ───
      const entryTags = entry.tags || [];
      if (entryTags.length) {
        html += '<div class="entry-tags">';
        entryTags.forEach(t => {
          const cls = _tagClass(t);
          html += `<span class="etag ${cls}">${esc(t)}</span>`;
        });
        html += '</div>';
      }

      // ── Senses ────────────────────────────────────────────────────────────
      html += '<div class="senses">';
      const senses = entry.senses || [];
      senses.slice(0, 6).forEach((sense, i) => {
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
          defs.slice(0, 5).forEach((g, j) => {
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

    if (source) {
      html += `<div class="source">${esc(source)}</div>`;
    }

    html += '</div>';
    return html;
  }

  // ── Popup CSS (lives inside the shadow DOM — isolated from page styles) ────
  const POPUP_CSS = `
    :host {
      all: initial;
    }

    #popup {
      position: fixed;
      width: 440px;
      max-height: 520px;
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

    /* ── Scrollable entry list ─────────────────────────────────── */
    .list {
      max-height: 520px;
      overflow-y: auto;
    }

    .list::-webkit-scrollbar        { width: 6px; }
    .list::-webkit-scrollbar-track  { background: transparent; }
    .list::-webkit-scrollbar-thumb  {
      background: rgba(120, 100, 180, 0.25);
      border-radius: 3px;
    }
    .list::-webkit-scrollbar-thumb:hover {
      background: rgba(120, 100, 180, 0.4);
    }

    /* ── Each dictionary entry ─────────────────────────────────── */
    .entry {
      padding: 14px 20px 16px;
      border-bottom: 1px solid rgba(120, 100, 180, 0.10);
    }
    .entry:last-child { border-bottom: none; }

    /* ── Word heading (ruby: reading over kanji) ────────────────── */
    .word-head {
      margin-bottom: 10px;
    }

    .kanji-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .head-ruby {
      font-size: 26px;
      font-weight: 700;
      color: #f0e6ff;
      letter-spacing: 0.02em;
      ruby-position: over;
      line-height: 1.1;
    }

    .head-ruby rt {
      font-size: 11px;
      font-weight: 500;
      color: rgba(180, 160, 220, 0.70);
      letter-spacing: 0.04em;
    }

    .head-plain {
      font-size: 26px;
      font-weight: 700;
      color: #f0e6ff;
      letter-spacing: 0.02em;
    }

    .alt-kanji {
      font-size: 14px;
      color: rgba(200, 185, 230, 0.55);
      align-self: center;
    }

    .reason {
      display: inline-block;
      padding: 2px 8px 3px;
      font-size: 10px;
      font-weight: 600;
      color: rgba(180, 160, 220, 0.80);
      background: rgba(120, 100, 180, 0.13);
      border: 1px solid rgba(120, 100, 180, 0.10);
      border-radius: 5px;
      letter-spacing: 0.3px;
      text-transform: lowercase;
      white-space: nowrap;
    }

    /* ── Entry-level tag boxes (common, freq, news, …) ──────────── */
    .entry-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 10px;
    }

    .etag {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px 3px;
      border-radius: 4px;
      letter-spacing: 0.3px;
      text-transform: lowercase;
      white-space: nowrap;
    }

    .etag-common {
      color: #7ee8a8;
      background: rgba(60, 190, 120, 0.14);
      border: 1px solid rgba(60, 190, 120, 0.20);
    }
    .etag-freq {
      color: #e8c86e;
      background: rgba(210, 180, 60, 0.12);
      border: 1px solid rgba(210, 180, 60, 0.18);
    }
    .etag-news {
      color: #7ec4e8;
      background: rgba(60, 160, 210, 0.12);
      border: 1px solid rgba(60, 160, 210, 0.18);
    }
    .etag-loan {
      color: #d8a0e8;
      background: rgba(180, 100, 220, 0.12);
      border: 1px solid rgba(180, 100, 220, 0.18);
    }
    .etag-spec {
      color: #b0a8c0;
      background: rgba(150, 140, 170, 0.12);
      border: 1px solid rgba(150, 140, 170, 0.15);
    }
    .etag-misc {
      color: #b0a8c0;
      background: rgba(150, 140, 170, 0.10);
      border: 1px solid rgba(150, 140, 170, 0.12);
    }
    .etag-prio {
      color: #f0c878;
      background: rgba(230, 180, 80, 0.12);
      border: 1px solid rgba(230, 180, 80, 0.20);
    }

    /* ── Senses container ──────────────────────────────────────── */
    .senses {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sense {
      line-height: 1.55;
    }

    /* ── Part-of-speech tag boxes ─────────────────────────────── */
    .pos-row {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 6px;
    }

    .pos {
      font-size: 10px;
      color: #c4b5f0;
      text-transform: lowercase;
      letter-spacing: 0.3px;
      font-weight: 600;
      padding: 3px 9px;
      background: rgba(100, 80, 180, 0.18);
      border: 1px solid rgba(140, 115, 220, 0.22);
      border-radius: 5px;
      white-space: nowrap;
    }

    /* ── Gloss definitions (each on its own line) ──────────────── */
    .gloss-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .gloss {
      color: rgba(230, 222, 245, 0.90);
      font-size: 13.5px;
      line-height: 1.55;
      padding-left: 4px;
    }

    .gloss-num {
      color: rgba(160, 145, 200, 0.55);
      font-size: 12px;
      font-weight: 600;
      margin-right: 2px;
    }

    /* ── Example sentences (under each sense) ──────────────────── */
    .examples {
      margin: 6px 0 0 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-left: 2px solid rgba(120, 100, 180, 0.18);
      padding: 4px 0 4px 10px;
    }

    .example-ja {
      font-size: 13px;
      color: rgba(230, 222, 245, 0.85);
      line-height: 1.9;
    }

    .example-ja ruby rt {
      font-size: 9px;
      color: rgba(180, 160, 220, 0.60);
      font-weight: 400;
    }

    .example-en {
      font-size: 12px;
      color: rgba(190, 180, 215, 0.65);
      font-style: italic;
      line-height: 1.5;
      margin-top: 1px;
    }

    /* ── Forms table ────────────────────────────────────────────── */
    .forms {
      margin-top: 12px;
      padding: 8px 10px;
      background: rgba(120, 100, 180, 0.06);
      border: 1px solid rgba(120, 100, 180, 0.12);
      border-radius: 6px;
    }

    .forms-label {
      font-size: 9.5px;
      font-weight: 700;
      color: rgba(180, 160, 220, 0.50);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 4px;
    }

    .forms-kanji {
      font-size: 14px;
      color: #e8dcff;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .forms-readings {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .form-reading {
      font-size: 12px;
      color: rgba(210, 200, 235, 0.65);
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(120, 100, 180, 0.10);
      border: 1px solid rgba(120, 100, 180, 0.12);
    }

    .form-reading.form-pri {
      color: #f0c878;
      background: rgba(230, 180, 80, 0.10);
      border-color: rgba(230, 180, 80, 0.22);
    }

    .form-reading.form-rare {
      color: rgba(180, 160, 220, 0.45);
    }

    /* ── Source attribution footer ─────────────────────────────── */
    .source {
      padding: 8px 20px 10px;
      font-size: 10px;
      color: rgba(160, 145, 200, 0.40);
      text-align: right;
      letter-spacing: 0.3px;
      border-top: 1px solid rgba(120, 100, 180, 0.08);
    }

    .error {
      padding: 18px 20px;
      color: #f08080;
      font-size: 13px;
      line-height: 1.6;
    }
  `;

  // ── Word highlight (CSS Custom Highlight API) ─────────────────────────────
  function _ensureHighlightCSS() {
    if (_hlSheet) return;
    try {
      _hlSheet = new CSSStyleSheet();
      _hlSheet.replaceSync(
        '::highlight(immersion-match){background-color:rgba(150,150,150,.30);border-radius:2px}'
      );
      document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), _hlSheet];
    } catch (_) {
      // Fallback for pages that block adoptedStyleSheets
      if (!document.getElementById('__imm_hl_css')) {
        const s = document.createElement('style');
        s.id = '__imm_hl_css';
        s.textContent =
          '::highlight(immersion-match){background-color:rgba(150,150,150,.30)}';
        (document.head || document.documentElement).appendChild(s);
      }
    }
  }

  function applyHighlight(textNode, offset, length) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    _ensureHighlightCSS();
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
    // Re-create if the host was removed (SPA full-DOM replacements, etc.)
    if (shadowHost && document.body.contains(shadowHost)) return;

    shadowHost = document.createElement('div');
    shadowHost.id = '__imm_dict_host';
    Object.assign(shadowHost.style, {
      position:      'fixed',
      top:           '0',
      left:          '0',
      width:         '0',
      height:        '0',
      zIndex:        '2147483647',
      pointerEvents: 'none',
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

    const html = renderEntries(data);
    if (!html) { hidePopup(); return; }

    // Highlight the matched word in the page
    if (data.matched && textNode != null && offset != null) {
      applyHighlight(textNode, offset, data.matched.length);
    }

    popupEl.innerHTML = html;
    popupEl.style.display = 'block';
    shadowHost.style.pointerEvents = 'auto';

    // Position the popup directly below (or above) the hovered text line.
    // We use a single-character Range at the cursor offset to get the line's
    // bounding rect — more reliable than spanning the full matched word, which
    // can have irregular rects on flex/grid layouts or near line-breaks.
    const W = 440, H = 520, GAP = 8, MARGIN = 10;
    let lineBottom = y + 20;  // fallback: cursor y + small offset
    let lineTop    = y;
    let anchorLeft = x;       // fallback: cursor x

    if (textNode != null && offset != null) {
      try {
        const r = document.createRange();
        const safeEnd = Math.min(offset + 1, textNode.length);
        r.setStart(textNode, offset);
        r.setEnd(textNode, safeEnd);
        const rect = r.getBoundingClientRect();
        // Only trust the rect if it has non-zero size and is on-screen.
        if (rect.height > 0 && rect.bottom > 0 && rect.bottom < window.innerHeight + 200) {
          lineBottom = rect.bottom;
          lineTop    = rect.top;
          anchorLeft = rect.left;
        }
      } catch (_) {}
    }

    // Horizontal: anchor to the word's left edge, clamped so popup stays on screen.
    let left = anchorLeft;
    if (left + W > window.innerWidth - MARGIN) left = window.innerWidth - W - MARGIN;
    if (left < MARGIN) left = MARGIN;

    // Vertical: prefer below the text line; flip above only when there's
    // actually enough room there and not enough below.
    const spaceBelow = window.innerHeight - lineBottom - MARGIN;
    const spaceAbove = lineTop - MARGIN;
    let top;
    if (spaceBelow >= H || spaceBelow >= spaceAbove) {
      top = lineBottom + GAP;
    } else {
      top = lineTop - H - GAP;
    }
    if (top < MARGIN) top = MARGIN;
    if (top + H > window.innerHeight - MARGIN) top = window.innerHeight - H - MARGIN;

    popupEl.style.left = left + 'px';
    popupEl.style.top  = top  + 'px';
  }

  function scheduleHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePopup, delay);
  }

  function hidePopup() {
    if (popupEl)     popupEl.style.display = 'none';
    if (shadowHost)  shadowHost.style.pointerEvents = 'none';
    popupHovered = false;
    clearHighlight();
  }

  // ── Core lookup ────────────────────────────────────────────────────────────
  async function doLookup(text, x, y, textNode, offset) {
    if (currentAbort) currentAbort.abort();
    currentAbort = new AbortController();
    try {
      const data = await fetchLookup(text, currentAbort.signal);
      if (data) showPopup(data, x, y, textNode, offset);
    } catch (e) {
      if (e.name !== 'AbortError') {
        // Silently swallow network errors (dict may not be installed yet).
      }
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  // Shift + hover
  document.addEventListener('mousemove', (e) => {
    shiftHeld = e.shiftKey;

    if (!e.shiftKey) {
      clearTimeout(debounceTimer);
      if (popupEl && popupEl.style.display !== 'none' && !popupHovered) {
        scheduleHide(150);
      }
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const hit = getChunkAtPoint(e.clientX, e.clientY);
      if (!hit) {
        if (!popupHovered) hidePopup();
        return;
      }
      doLookup(hit.chunk, e.clientX, e.clientY, hit.textNode, hit.offset);
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

  // Dismiss on page scroll (popup position would become stale).
  document.addEventListener('scroll', () => {
    if (!popupHovered) hidePopup();
  }, true);

  // ── Right-click / external lookup (called by Python contextMenuEvent) ──────
  window.__immersionLookup = function (text) {
    if (!text) return;
    // Centre the popup in the viewport for right-click lookups.
    const x = Math.max(8, Math.floor(window.innerWidth  / 2) - 190);
    const y = Math.max(8, Math.floor(window.innerHeight / 2) - 220);
    doLookup(text, x, y);
  };

})();
