var bridge;
var cardTypes = [];
var decks = [];
var fieldCounter = 0;
var createCardPreselectedDeckId = null;
var currentAccent = '#9067C6';
var currentFontSize = 'medium';
var FONT_SIZE_MAP = { small: '1.5rem', medium: '2.5rem', large: '4rem' };
var collapsedDecks = new Set();
var deckCollapseInitialized = false;

new QWebChannel(qt.webChannelTransport, function(channel) {
    bridge = channel.objects.bridge;
    bridge.refreshStats();
    bridge.getAppSettings();
    bridge.getDecks();
    bridge.getMediaBaseUrl();
});

function applyAppSettings(settings) {
    currentAccent = settings.accent_color || '#9067C6';
    currentFontSize = settings.font_size || 'medium';
    document.documentElement.style.setProperty('--accent', currentAccent);
    document.documentElement.style.setProperty('--review-font-size', FONT_SIZE_MAP[currentFontSize] || '2.5rem');
    currentSRSDefaults = {
        new_cards_limit: settings.default_new_cards_limit !== undefined ? settings.default_new_cards_limit : 15,
        learning_steps: settings.default_learning_steps || '1 10',
        relearning_steps: settings.default_relearning_steps || '10',
        study_order: settings.default_study_order || 'new_first',
        day_start_hour: settings.day_start_hour !== undefined ? settings.day_start_hour : 4,
    };
    currentReviewBehavior = {
        autoplay_audio: settings.review_autoplay_audio !== undefined ? settings.review_autoplay_audio : true,
        shortcut_enabled: settings.review_shortcut_enabled !== undefined ? settings.review_shortcut_enabled : true,
        shortcut_key: settings.review_shortcut_key || 'Space',
        two_button_mode: settings.review_two_button_mode || false,
    };
    applyRatingButtonMode();
}

var currentSRSDefaults = { new_cards_limit: 15, learning_steps: '1 10', relearning_steps: '10', study_order: 'new_first', day_start_hour: 4 };
var currentReviewBehavior = { autoplay_audio: true, shortcut_enabled: true, shortcut_key: 'Space', two_button_mode: false };
var capturingKey = false;

function getKeyDisplayName(code) {
    if (code === 'Space') return 'Space';
    if (code === 'Enter') return 'Enter';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return { Left: '←', Right: '→', Up: '↑', Down: '↓' }[code.slice(5)] || code;
    return code;
}

function startKeyCapture() {
    if (capturingKey) return;
    capturingKey = true;
    var btn = document.getElementById('shortcut-key-btn');
    btn.textContent = 'Press a key…';
    btn.style.outline = '2px solid var(--accent)';
    function onKey(e) {
        if (e.code === 'Escape') {
            btn.textContent = getKeyDisplayName(currentReviewBehavior.shortcut_key);
            btn.style.outline = '';
            capturingKey = false;
            document.removeEventListener('keydown', onKey, true);
            return;
        }
        var disallowed = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight','Tab'];
        if (disallowed.includes(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        currentReviewBehavior.shortcut_key = e.code;
        btn.textContent = getKeyDisplayName(e.code);
        btn.style.outline = '';
        capturingKey = false;
        document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
}

function showAppSettings() {
    document.getElementById('settings-accent-color').value = currentAccent;
    document.getElementById('settings-accent-hex').textContent = currentAccent;
    document.getElementById('settings-font-size').value = currentFontSize;
    document.getElementById('srs-default-new-limit').value = currentSRSDefaults.new_cards_limit;
    document.getElementById('srs-default-learning-steps').value = currentSRSDefaults.learning_steps;
    document.getElementById('srs-default-relearning-steps').value = currentSRSDefaults.relearning_steps;
    document.getElementById('srs-default-study-order').value = currentSRSDefaults.study_order;
    var hourSelect = document.getElementById('srs-day-start-hour');
    if (hourSelect.options.length === 0) {
        for (var h = 0; h < 24; h++) {
            var opt = document.createElement('option');
            opt.value = h;
            var ampm = h === 0 ? '12:00 AM' : h < 12 ? h + ':00 AM' : h === 12 ? '12:00 PM' : (h - 12) + ':00 PM';
            opt.textContent = ampm;
            hourSelect.appendChild(opt);
        }
    }
    hourSelect.value = currentSRSDefaults.day_start_hour;
    document.getElementById('review-autoplay-audio').checked = currentReviewBehavior.autoplay_audio;
    document.getElementById('review-shortcut-enabled').checked = currentReviewBehavior.shortcut_enabled;
    document.getElementById('shortcut-key-btn').textContent = getKeyDisplayName(currentReviewBehavior.shortcut_key);
    document.getElementById('review-two-button-mode').checked = currentReviewBehavior.two_button_mode;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateDataInfo(info) {
    var pathEl = document.getElementById('data-db-path');
    if (pathEl) pathEl.textContent = info.db_path;
    var sizeEl = document.getElementById('data-db-size');
    if (sizeEl) sizeEl.textContent = formatBytes(info.db_size_bytes);
    var statsEl = document.getElementById('data-stats');
    if (statsEl) statsEl.textContent = info.deck_count + ' decks · ' + info.card_count + ' cards · ' + info.review_count + ' reviews';
}

function previewAccent(color) {
    document.documentElement.style.setProperty('--accent', color);
    document.getElementById('settings-accent-hex').textContent = color;
}

function applyRatingButtonMode() {
    var container = document.getElementById('review-rating-buttons');
    if (!container) return;
    var buttons = container.querySelectorAll('button');
    var twoBtn = currentReviewBehavior.two_button_mode;
    // buttons order: Again(1), Hard(3), Good(4), Easy(5)
    if (buttons.length >= 4) {
        buttons[1].style.display = twoBtn ? 'none' : '';  // Hard
        buttons[3].style.display = twoBtn ? 'none' : '';  // Easy
        // In two-button mode, Good gets accent color text; in four-button mode, Good is green text
        buttons[2].style.color = twoBtn ? 'var(--accent)' : '#27ae60';
    }
}

function buildSettings(overrides) {
    return Object.assign({
        accent_color: currentAccent,
        font_size: currentFontSize,
        default_new_cards_limit: currentSRSDefaults.new_cards_limit,
        default_learning_steps: currentSRSDefaults.learning_steps,
        default_relearning_steps: currentSRSDefaults.relearning_steps,
        default_study_order: currentSRSDefaults.study_order,
        day_start_hour: currentSRSDefaults.day_start_hour,
        review_autoplay_audio: currentReviewBehavior.autoplay_audio,
        review_shortcut_enabled: currentReviewBehavior.shortcut_enabled,
        review_shortcut_key: currentReviewBehavior.shortcut_key,
        review_two_button_mode: currentReviewBehavior.two_button_mode,
    }, overrides);
}

function saveAppSettings() {
    var newLimit = parseInt(document.getElementById('srs-default-new-limit').value, 10);
    var settings = buildSettings({
        accent_color: document.getElementById('settings-accent-color').value,
        font_size: document.getElementById('settings-font-size').value,
        default_new_cards_limit: isNaN(newLimit) ? 15 : newLimit,
        default_learning_steps: document.getElementById('srs-default-learning-steps').value.trim() || '1 10',
        default_relearning_steps: document.getElementById('srs-default-relearning-steps').value.trim() || '10',
        default_study_order: document.getElementById('srs-default-study-order').value,
        day_start_hour: parseInt(document.getElementById('srs-day-start-hour').value, 10),
        review_autoplay_audio: document.getElementById('review-autoplay-audio').checked,
        review_shortcut_enabled: document.getElementById('review-shortcut-enabled').checked,
        review_shortcut_key: currentReviewBehavior.shortcut_key,
        review_two_button_mode: document.getElementById('review-two-button-mode').checked,
    });
    applyAppSettings(settings);
    if (bridge) bridge.saveAppSettings(JSON.stringify(settings));
}

function resetAppearanceSettings() {
    var settings = buildSettings({ accent_color: '#9067C6', font_size: 'medium' });
    applyAppSettings(settings);
    showAppSettings();
    if (bridge) bridge.saveAppSettings(JSON.stringify(settings));
}

function resetSRSDefaults() {
    var settings = buildSettings({
        default_new_cards_limit: 15,
        default_learning_steps: '1 10',
        default_relearning_steps: '10',
        default_study_order: 'new_first',
        day_start_hour: 4,
    });
    applyAppSettings(settings);
    showAppSettings();
    if (bridge) bridge.saveAppSettings(JSON.stringify(settings));
}

function resetReviewBehavior() {
    var settings = buildSettings({
        review_autoplay_audio: true,
        review_shortcut_enabled: true,
        review_shortcut_key: 'Space',
        review_two_button_mode: false,
    });
    applyAppSettings(settings);
    showAppSettings();
    if (bridge) bridge.saveAppSettings(JSON.stringify(settings));
}

function importDeck() {
    if (bridge) {
        bridge.importDeck();
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

function showView(viewId) {
    document.documentElement.style.setProperty('--accent', currentAccent);
    document.querySelectorAll('.view-section').forEach(function(el) {
        el.classList.add('view-hidden');
    });
    document.getElementById(viewId + '-view').classList.remove('view-hidden');
    if (viewId !== 'review') {
        var cssEl = document.getElementById('review-card-css');
        if (cssEl) cssEl.textContent = '';
    }
    if (viewId !== 'card-preview') {
        var previewCssEl = document.getElementById('preview-card-css');
        if (previewCssEl) previewCssEl.textContent = '';
    }
    if (viewId === 'dashboard' && bridge) {
        bridge.refreshStats();
        populateRetentionDeckSelect();
        fetchRetentionStats();
        populateHeatmapDeckSelect();
        fetchHeatmap();
        if (decks.length === 0) bridge.getDecks();
    }
    if (viewId === 'srs' && bridge) bridge.getDecks();
    if (viewId === 'settings') { showAppSettings(); if (bridge) bridge.getDataInfo(); }
    if (viewId === 'card-types' && bridge) bridge.getCardTypes();
    if (viewId === 'create-card-type') initCreateCardTypeView();
    if (viewId === 'card-browser') {
        populateBrowseDeckSelect();
        if (bridge) { if (cardTypes.length === 0) bridge.getCardTypes(); }
        fetchBrowseCards();
    }
    if (viewId === 'edit-card' && bridge) {
        if (cardTypes.length === 0) bridge.getCardTypes();
    }
    if (viewId === 'create-deck') {
        populateParentDeckSelect('deck-parent-select');
    }
    if (viewId === 'create-card' && bridge) {
        if (cardTypes.length === 0) bridge.getCardTypes();
        else updateCardTypes(cardTypes);
        if (decks.length === 0) bridge.getDecks();
        else populateCardDeckSelect();
    }
}

function updateStats(due, newCards) {
    document.getElementById('due-cards').textContent = due;
    document.getElementById('new-cards').textContent = newCards;
}

function populateDeckSelectHierarchical(select, flat) {
    var frag = document.createDocumentFragment();
    flat.forEach(function(item) {
        var opt = document.createElement('option');
        opt.value = item.deck.id;
        var indent = '';
        for (var i = 0; i < item.depth; i++) indent += '\u00A0\u00A0\u00A0\u00A0';
        opt.textContent = indent + item.deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
}

function populateCardDeckSelect() {
    var select = document.getElementById('card-deck-select');
    if (!select) return;
    var preselect = createCardPreselectedDeckId !== null ? String(createCardPreselectedDeckId) : select.value;
    select.innerHTML = '';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    populateDeckSelectHierarchical(select, flat);
    if (preselect && decks.some(function(d) { return String(d.id) === preselect; })) {
        select.value = preselect;
    }
}

function populateRetentionDeckSelect() {
    var select = document.getElementById('retention-deck-select');
    if (!select) return;
    var prev = select.value;
    select.innerHTML = '<option value="0">All Decks</option>';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    populateDeckSelectHierarchical(select, flat);
    if (prev && (prev === '0' || decks.some(function(d) { return String(d.id) === prev; }))) {
        select.value = prev;
    }
}

function fetchRetentionStats() {
    if (!bridge) return;
    var deckSel = document.getElementById('retention-deck-select');
    var periodSel = document.getElementById('retention-period-select');
    if (!deckSel || !periodSel) return;
    bridge.getRetentionStats(String(deckSel.value || '0'), periodSel.value || 'last_month');
}

function updateRetentionStats(stats) {
    function fmtEl(elId, countId, s) {
        var el = document.getElementById(elId);
        var countEl = document.getElementById(countId);
        if (!s || s.rate === null || s.rate === undefined) {
            el.textContent = '—';
            el.style.color = '';
            if (countEl) countEl.textContent = '';
            return;
        }
        el.textContent = s.rate + '%';
        el.style.color = s.rate >= 90 ? '#27ae60' : s.rate >= 70 ? '#f39c12' : '#e74c3c';
        if (countEl) countEl.textContent = s.successful + ' / ' + s.total;
    }
    fmtEl('retention-young', 'retention-young-count', stats.young);
    fmtEl('retention-mature', 'retention-mature-count', stats.mature);
    fmtEl('retention-total', 'retention-total-count', stats.total);
}

function populateHeatmapDeckSelect() {
    var select = document.getElementById('heatmap-deck-select');
    if (!select) return;
    var prev = select.value;
    select.innerHTML = '<option value="0">All Decks</option>';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    populateDeckSelectHierarchical(select, flat);
    if (prev && (prev === '0' || decks.some(function(d) { return String(d.id) === prev; }))) {
        select.value = prev;
    }
}

function fetchHeatmap() {
    if (!bridge) return;
    var sel = document.getElementById('heatmap-deck-select');
    bridge.getDailyReviewCounts(String(sel ? sel.value : '0'));
}

function updateHeatmap(data) {
    document.getElementById('heatmap-current-streak').textContent = data.current_streak;
    document.getElementById('heatmap-longest-streak').textContent = data.longest_streak;
    document.getElementById('heatmap-year-total').textContent = data.year_total.toLocaleString();
    renderHeatmapSVG(data.counts);
}

function renderHeatmapSVG(counts) {
    var CELL = 11, GAP = 3, WEEKS = 53;
    var DAY_LABEL_W = 26, MONTH_LABEL_H = 18;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate the start date for the current year
    var startDay = new Date(today.getFullYear(), 0, 1); // January 1 of current year
    startDay.setDate(startDay.getDate() - startDay.getDay()); // rewind to Sunday

    var svgW = DAY_LABEL_W + WEEKS * (CELL + GAP);
    var svgH = MONTH_LABEL_H + 7 * (CELL + GAP);

    var svg = document.getElementById('heatmap-svg');
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', svgH);
    svg.innerHTML = '';

    var ac = currentAccent.length === 7 ? currentAccent : '#9067C6';
    var r0 = parseInt(ac.slice(1,3),16), g0 = parseInt(ac.slice(3,5),16), b0 = parseInt(ac.slice(5,7),16);
    var bgR = 30, bgG = 27, bgB = 46;
    function blend(t) {
        return 'rgb('+Math.round(bgR+(r0-bgR)*t)+','+Math.round(bgG+(g0-bgG)*t)+','+Math.round(bgB+(b0-bgB)*t)+')';
    }
    function cellColor(n) {
        if (!n)    return blend(0.15);
        if (n <= 3) return blend(0.35);
        if (n <= 7) return blend(0.60);
        if (n <= 14) return blend(0.80);
        return blend(1.0);
    }
    function toDateStr(d) {
        return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }

    var ns = 'http://www.w3.org/2000/svg';
    var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    var frag = document.createDocumentFragment();

    // Day-of-week labels (Mon, Wed, Fri)
    [[1,'Mon'],[3,'Wed'],[5,'Fri']].forEach(function(pair) {
        var txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', DAY_LABEL_W - 3);
        txt.setAttribute('y', MONTH_LABEL_H + pair[0] * (CELL + GAP) + CELL);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', '#777');
        txt.setAttribute('font-size', '9');
        txt.textContent = pair[1];
        frag.appendChild(txt);
    });

    var lastMonthW = -5;

    for (var w = 0; w < WEEKS; w++) {
        var weekX = DAY_LABEL_W + w * (CELL + GAP);
        var weekStart = new Date(startDay);
        weekStart.setDate(startDay.getDate() + w * 7);

        // Month label when 1st of month appears in this week
        for (var di = 0; di < 7; di++) {
            var probe = new Date(weekStart);
            probe.setDate(weekStart.getDate() + di);
            if (probe.getDate() === 1 && w - lastMonthW >= 3) {
                var mTxt = document.createElementNS(ns, 'text');
                mTxt.setAttribute('x', weekX);
                mTxt.setAttribute('y', MONTH_LABEL_H - 5);
                mTxt.setAttribute('fill', '#aaa');
                mTxt.setAttribute('font-size', '10');
                mTxt.textContent = MONTH_NAMES[probe.getMonth()];
                frag.appendChild(mTxt);
                lastMonthW = w;
                break;
            }
        }

        for (var d = 0; d < 7; d++) {
            var day = new Date(weekStart);
            day.setDate(weekStart.getDate() + d);

            var dStr = toDateStr(day);
            var cnt = counts[dStr] || 0;

            var rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', weekX);
            rect.setAttribute('y', MONTH_LABEL_H + d * (CELL + GAP));
            rect.setAttribute('width', CELL);
            rect.setAttribute('height', CELL);
            rect.setAttribute('rx', 2);
            rect.setAttribute('fill', cellColor(cnt));
            rect.dataset.date = dStr;
            rect.dataset.count = cnt;

            frag.appendChild(rect);
        }
    }

    svg.appendChild(frag);

    // Single delegated event listener for tooltips instead of one per cell
    svg.addEventListener('mouseenter', function(e) {
        if (e.target.tagName === 'rect' && e.target.dataset.date) {
            var tip = document.getElementById('heatmap-tooltip');
            var count = parseInt(e.target.dataset.count, 10);
            if (tip) tip.textContent = e.target.dataset.date + ': ' + count + (count === 1 ? ' review' : ' reviews');
        }
    }, true);
    svg.addEventListener('mouseleave', function(e) {
        if (e.target.tagName === 'rect' && e.target.dataset.date) {
            var tip = document.getElementById('heatmap-tooltip');
            if (tip) tip.textContent = '';
        }
    }, true);
}

function buildDeckTree(deckList) {
    var map = {};
    var roots = [];
    deckList.forEach(function(d) { map[d.id] = { deck: d, children: [] }; });
    deckList.forEach(function(d) {
        if (d.parent_id && map[d.parent_id]) {
            map[d.parent_id].children.push(map[d.id]);
        } else {
            roots.push(map[d.id]);
        }
    });
    // Sort children by position at each level
    function sortByPos(nodes) {
        nodes.sort(function(a, b) { return (a.deck.position || 0) - (b.deck.position || 0); });
        nodes.forEach(function(n) { sortByPos(n.children); });
    }
    sortByPos(roots);
    return roots;
}

function flattenDeckTree(nodes, depth, respectCollapse) {
    var result = [];
    nodes.forEach(function(node, idx) {
        var isCollapsed = respectCollapse && collapsedDecks.has(node.deck.id);
        result.push({ deck: node.deck, depth: depth, hasChildren: node.children.length > 0, collapsed: isCollapsed, siblingIndex: idx, siblingCount: nodes.length });
        if (!isCollapsed) {
            result = result.concat(flattenDeckTree(node.children, depth + 1, respectCollapse));
        }
    });
    return result;
}

function toggleDeckCollapse(deckId) {
    if (collapsedDecks.has(deckId)) {
        collapsedDecks.delete(deckId);
    } else {
        collapsedDecks.add(deckId);
    }
    renderDeckList();
}

function expandAllDecks() {
    collapsedDecks.clear();
    deckCollapseInitialized = true;
    renderDeckList();
}

function updateDecks(deckData) {
    decks = deckData;
    populateCardDeckSelect();
    populateRetentionDeckSelect();
    populateHeatmapDeckSelect();
    if (!document.getElementById('dashboard-view').classList.contains('view-hidden')) {
        fetchRetentionStats();
        fetchHeatmap();
    }
    // On first load, auto-collapse all parent decks
    if (!deckCollapseInitialized) {
        deckCollapseInitialized = true;
        decks.forEach(function(d) {
            if (decks.some(function(c) { return c.parent_id === d.id; })) {
                collapsedDecks.add(d.id);
            }
        });
    }
    renderDeckList();
}

function isDescendantOf(childId, ancestorId) {
    var queue = [ancestorId];
    while (queue.length) {
        var cur = queue.shift();
        for (var i = 0; i < decks.length; i++) {
            if (decks[i].parent_id === cur) {
                if (decks[i].id === childId) return true;
                queue.push(decks[i].id);
            }
        }
    }
    return false;
}

var deckDragId = null;

function renderDeckList() {
    var container = document.getElementById('deck-list');
    container.innerHTML = '';
    if (decks.length === 0) {
        container.innerHTML = '<p class="text">No decks found. Create or import a deck to get started.</p>';
        return;
    }
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0, true);
    var frag = document.createDocumentFragment();

    // Helper: create a reorder drop zone between sibling decks
    function makeSiblingDropZone(parentId, position, depth) {
        var zone = document.createElement('div');
        zone.className = 'deck-drop-zone';
        // Use padding for a large invisible hit area; the visible bar is drawn via border
        zone.style.cssText = 'padding:6px 0; margin:-6px 0; border-top:2px solid transparent; border-radius:4px; transition:border-color 0.15s ease; max-width:600px; box-sizing:content-box; position:relative; z-index:1;';
        if (depth > 0) {
            zone.style.marginLeft = (depth * 1.5) + 'rem';
            zone.style.maxWidth = (600 - depth * 24) + 'px';
        }
        zone.addEventListener('dragover', function(e) {
            if (!deckDragId) return;
            var dragged = decks.find(function(d) { return d.id === deckDragId; });
            if (!dragged) return;
            if (parentId && isDescendantOf(parentId, deckDragId)) return;
            if (parentId === deckDragId) return;
            var sameParent = (dragged.parent_id || 0) === (parentId || 0);
            if (sameParent && (dragged.position === position || dragged.position === position - 1)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.style.borderColor = currentAccent;
        });
        zone.addEventListener('dragleave', function() {
            zone.style.borderColor = 'transparent';
        });
        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            zone.style.borderColor = 'transparent';
            if (!deckDragId || !bridge) return;
            var dragged = decks.find(function(d) { return d.id === deckDragId; });
            if (!dragged) return;
            if (parentId && isDescendantOf(parentId, deckDragId)) return;
            if (parentId === deckDragId) return;
            // Adjust position if moving within the same parent and the deck was before the target
            var adjustedPos = position;
            var sameParent = (dragged.parent_id || 0) === (parentId || 0);
            if (sameParent && dragged.position < position) {
                adjustedPos = position - 1;
            }
            bridge.reorderDeck(deckDragId, parentId || 0, adjustedPos);
            deckDragId = null;
        });
        return zone;
    }

    // Top-level drop zone — reorder to position 0 at root
    frag.appendChild(makeSiblingDropZone(null, 0, 0));

    var pendingTrailingZones = []; // stack of {parentId, position, depth}

    flat.forEach(function(item, idx) {
        var deck = item.deck;
        var depth = item.depth;

        // Flush trailing zones for deeper/equal depth levels that are now closed
        while (pendingTrailingZones.length > 0 && pendingTrailingZones[pendingTrailingZones.length - 1].depth >= depth) {
            var z = pendingTrailingZones.pop();
            frag.appendChild(makeSiblingDropZone(z.parentId, z.position, z.depth));
        }

        // "Before" drop zone: first child in a subgroup, or between siblings
        if (item.siblingIndex === 0 && depth > 0) {
            frag.appendChild(makeSiblingDropZone(deck.parent_id, 0, depth));
        } else if (item.siblingIndex > 0) {
            frag.appendChild(makeSiblingDropZone(deck.parent_id, item.siblingIndex, depth));
        }
        var card = document.createElement('div');
        card.className = 'card text-white mb-3 deck-card';
        card.setAttribute('draggable', 'true');
        card.dataset.deckId = deck.id;
        card.style.backgroundColor = '#2d2a3e';
        card.style.borderTop = depth === 0 ? '3px solid ' + currentAccent : '1px solid #3d3a50';
        card.style.borderLeft = 'none';
        card.style.borderRight = 'none';
        card.style.borderBottom = '1px solid #3d3a50';
        card.style.cursor = 'pointer';
        card.style.maxWidth = '600px';
        card.style.transition = 'background-color 0.15s ease, outline 0.15s ease, opacity 0.15s ease';
        if (depth > 0) {
            card.style.marginLeft = (depth * 1.5) + 'rem';
            card.style.maxWidth = (600 - depth * 24) + 'px';
        }

        // --- Drag source ---
        card.addEventListener('dragstart', function(e) {
            deckDragId = deck.id;
            card.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(deck.id));
        });
        card.addEventListener('dragend', function() {
            card.style.opacity = '1';
            deckDragId = null;
        });

        // --- Drop target (reparent: drop onto center of card) ---
        card.addEventListener('dragover', function(e) {
            if (!deckDragId || deckDragId === deck.id) return;
            if (isDescendantOf(deck.id, deckDragId)) return;
            var dragged = decks.find(function(d) { return d.id === deckDragId; });
            if (dragged && dragged.parent_id === deck.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.style.outline = '2px solid ' + currentAccent;
            card.style.outlineOffset = '-2px';
        });
        card.addEventListener('dragleave', function() {
            card.style.outline = '';
            card.style.outlineOffset = '';
        });
        card.addEventListener('drop', function(e) {
            e.preventDefault();
            card.style.outline = '';
            card.style.outlineOffset = '';
            if (!deckDragId || deckDragId === deck.id) return;
            if (isDescendantOf(deck.id, deckDragId)) return;
            if (bridge) {
                bridge.setDeckParent(deckDragId, deck.id);
            }
            deckDragId = null;
        });

        var chevron = '';
        if (item.hasChildren) {
            var rotation = item.collapsed ? '0' : '90';
            chevron = '<span class="deck-collapse-toggle" data-deck-id="' + deck.id + '" style="cursor:pointer; margin-right:0.75rem; user-select:none; display:inline-flex; align-items:center; justify-content:center; width:2rem; height:2rem; border-radius:4px; transition:transform 0.15s ease, background-color 0.15s ease; transform:rotate(' + rotation + 'deg);">' +
                '<svg width="16" height="16" viewBox="0 0 12 12" fill="none" style="flex-shrink:0;"><path d="M3 1.5L8.5 6L3 10.5" stroke="#aaa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</span>';
        }
        var dueBadge = deck.due > 0
            ? '<span class="badge" style="background-color:' + currentAccent + '; font-size:0.82rem; padding:0.35rem 0.65rem;">' + deck.due + ' due</span>'
            : '';
        var newBadge = deck.new > 0
            ? '<span class="badge" style="background-color:#4a90d9; font-size:0.82rem; padding:0.35rem 0.65rem;">' + deck.new + ' new</span>'
            : '';
        var emptyLabel = (deck.due === 0 && deck.new === 0)
            ? '<span style="color:#666; font-size:0.85rem;">Nothing due</span>'
            : '';
        card.innerHTML =
            '<div class="card-body d-flex justify-content-between align-items-center" style="padding: 0.9rem 1.25rem;">' +
                '<div style="display:flex; align-items:center;">' +
                    chevron +
                    '<div>' +
                        '<h5 class="card-title mb-0" style="color: white; font-weight: 600;">' + deck.name + '</h5>' +
                        '<small style="color: #888; font-size: 0.78rem;">' + deck.total + ' card' + (deck.total !== 1 ? 's' : '') + '</small>' +
                    '</div>' +
                '</div>' +
                '<div class="d-flex gap-2 align-items-center">' +
                    dueBadge + newBadge + emptyLabel +
                '</div>' +
            '</div>';
        card.addEventListener('mouseenter', function() { if (!deckDragId) card.style.backgroundColor = '#35324a'; });
        card.addEventListener('mouseleave', function() { card.style.backgroundColor = '#2d2a3e'; });
        card.addEventListener('click', function(e) {
            // If the chevron toggle was clicked, collapse/expand instead of navigating
            var toggle = e.target.closest('.deck-collapse-toggle');
            if (toggle) {
                e.preventDefault();
                e.stopPropagation();
                toggleDeckCollapse(deck.id);
                return;
            }
            e.preventDefault();
            showDeckDetails(deck);
        });
        frag.appendChild(card);

        // If last sibling in group, schedule a trailing drop zone (placed after subtree)
        if (item.siblingIndex === item.siblingCount - 1) {
            pendingTrailingZones.push({ parentId: deck.parent_id, position: item.siblingIndex + 1, depth: depth });
        }
    });

    // Flush any remaining trailing zones
    while (pendingTrailingZones.length > 0) {
        var z = pendingTrailingZones.pop();
        frag.appendChild(makeSiblingDropZone(z.parentId, z.position, z.depth));
    }

    container.appendChild(frag);
}

function showCreateCard(deckId) {
    createCardPreselectedDeckId = (deckId !== undefined) ? deckId : null;
    showView('create-card');
}

function populateParentDeckSelect(selectId, excludeDeckId) {
    var select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="0">None (top level)</option>';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    // Collect IDs to exclude (the deck itself and all its descendants)
    var excludeIds = new Set();
    if (excludeDeckId) {
        excludeIds.add(excludeDeckId);
        var queue = [excludeDeckId];
        while (queue.length) {
            var cur = queue.shift();
            decks.forEach(function(d) {
                if (d.parent_id === cur) {
                    excludeIds.add(d.id);
                    queue.push(d.id);
                }
            });
        }
    }
    var frag = document.createDocumentFragment();
    flat.forEach(function(item) {
        if (excludeIds.has(item.deck.id)) return;
        var opt = document.createElement('option');
        opt.value = item.deck.id;
        var indent = '';
        for (var i = 0; i < item.depth; i++) indent += '\u00A0\u00A0\u00A0\u00A0';
        opt.textContent = indent + item.deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
}

function createDeck() {
    var name = document.getElementById('deck-name').value.trim();
    var description = document.getElementById('deck-description').value.trim();
    var parentId = parseInt(document.getElementById('deck-parent-select').value, 10) || 0;
    if (name === '') {
        showAlert('Please enter a deck name.');
        return;
    }
    if (bridge) {
        bridge.createDeck(name, description, parentId);
        document.getElementById('deck-name').value = '';
        document.getElementById('deck-description').value = '';
        document.getElementById('deck-parent-select').value = '0';
        showView('srs');
    }
}

function showDeckDetails(deck) {
    currentDeckForDetails = deck;
    var deckDetailsView = document.getElementById('deck-details-view');
    var remainingNew = Math.max(0, deck.total - deck.young - deck.mature);
    deckDetailsView.innerHTML = `
        <input type="hidden" id="current-deck-id" value="${deck.id}">
        <button class="btn btn-dark mb-3" onclick="showView('srs')" style="background-color: #3a3555 !important; font-weight: 600; padding: 0.35rem 0.85rem;">\u2190 Back</button>
        <div class="d-flex align-items-center justify-content-between mb-4" style="flex-wrap: wrap; gap: 1rem;">
            <h1 class="mb-0">${deck.name}</h1>
            <div class="d-flex" style="gap: 0.75rem; flex-wrap: wrap;">
                <button class="btn btn-dark btn-accent" onclick="startReview(${deck.id})" style="font-weight: 600; min-width: 9rem; height: 2.75rem;">Start Review</button>
                <button class="btn btn-dark btn-accent" onclick="showCreateCard(${deck.id})" style="font-weight: 600; height: 2.75rem;">Add Card</button>
                <button class="btn btn-dark" onclick="showDeckSettings()" style="background-color: #3a3555 !important; font-weight: 600; height: 2.75rem;">Settings</button>
            </div>
        </div>

        <div class="card mb-3 settings-card" style="max-width: 560px;">
            <div class="card-body text-white">
                <h2 class="settings-section-title">Card Stats</h2>
                <div class="row text-center g-0 mb-3">
                    <div class="col dash-stat-cell">
                        <div class="dash-stat-label">Due</div>
                        <div class="dash-stat-value" style="color: var(--accent);">${deck.due}</div>
                    </div>
                    <div class="col dash-stat-cell">
                        <div class="dash-stat-label">New</div>
                        <div class="dash-stat-value" style="color: #4a90d9;">${deck.new}</div>
                    </div>
                    <div class="col dash-stat-cell" style="border-right: none;">
                        <div class="dash-stat-label">Total</div>
                        <div class="dash-stat-value">${deck.total}</div>
                    </div>
                </div>
                <hr style="border-color: #3d3a50; margin: 0 0 0.75rem;">
                <div class="row text-center g-0">
                    <div class="col dash-stat-cell">
                        <div class="dash-stat-label">Young</div>
                        <div class="dash-stat-value" style="font-size: 1.4rem;">${deck.young}</div>
                    </div>
                    <div class="col dash-stat-cell" style="border-right: none;">
                        <div class="dash-stat-label">Mature</div>
                        <div class="dash-stat-value" style="font-size: 1.4rem; color: #27ae60;">${deck.mature}</div>
                    </div>
                </div>
            </div>
        </div>

        ${deck.total > 0 ? `
        <div class="card mb-3 settings-card" style="max-width: 560px;">
            <div class="card-body text-white">
                <h2 class="settings-section-title">Breakdown</h2>
                <div id="deck-pie-chart"></div>
            </div>
        </div>` : ''}

        ${deck.description ? `
        <div class="card mb-3 settings-card" style="max-width: 560px;">
            <div class="card-body text-white">
                <h2 class="settings-section-title">Description</h2>
                <p style="font-size: 0.95rem; opacity: 0.85; margin-bottom: 0;">${deck.description}</p>
            </div>
        </div>` : ''}
    `;
    showView('deck-details');
    if (deck.total > 0 && typeof Plotly !== 'undefined') {
        var sliceValues  = [deck.young,   deck.mature,  remainingNew];
        var sliceLabels  = ['Young',       'Mature',     'New'];
        var sliceColors  = [currentAccent,  '#27ae60',    '#4a90d9'];
        var fVals = [], fLabels = [], fColors = [];
        sliceValues.forEach(function(v, i) {
            if (v > 0) { fVals.push(v); fLabels.push(sliceLabels[i]); fColors.push(sliceColors[i]); }
        });
        Plotly.newPlot('deck-pie-chart', [{
            values: fVals,
            labels: fLabels,
            type: 'pie',
            hole: 0.45,
            marker: { colors: fColors, line: { color: '#242038', width: 2 } },
            textinfo: 'label+percent',
            textfont: { color: 'white', size: 13 },
            hovertemplate: '%{label}: %{value} cards (%{percent})<extra></extra>'
        }], {
            paper_bgcolor: 'transparent',
            plot_bgcolor:  'transparent',
            showlegend: true,
            legend: { font: { color: 'white', size: 13 }, bgcolor: 'transparent', orientation: 'h', x: 0.5, xanchor: 'center', y: -0.08 },
            margin: { t: 10, b: 40, l: 10, r: 10 },
            font: { color: 'white' },
            hoverlabel: { bgcolor: '#2d2a3e', bordercolor: currentAccent, font: { color: 'white', size: 13 } }
        }, { responsive: true, displayModeBar: false });
    }
}

var currentDeckForDetails = null;

function deleteDeck(deckId) {
    if (!bridge) return;
    if (!confirm('Are you sure you want to delete this deck? All cards in this deck will also be deleted. This cannot be undone.')) return;
    bridge.deleteDeck(deckId);
    showView('srs');
}

function deleteDeckFromSettings() {
    if (!currentDeckForDetails || !bridge) return;
    if (!confirm('Are you sure you want to delete "' + currentDeckForDetails.name + '"? All cards in this deck will also be deleted. This cannot be undone.')) return;
    bridge.deleteDeck(currentDeckForDetails.id);
    showView('srs');
}

function showDeckSettings() {
    var deck = currentDeckForDetails;
    if (!deck) return;
    document.getElementById('settings-deck-name').textContent = deck.name;
    document.getElementById('settings-deck-name-input').value = deck.name;
    populateParentDeckSelect('settings-deck-parent-select', deck.id);
    document.getElementById('settings-deck-parent-select').value = deck.parent_id ? String(deck.parent_id) : '0';
    document.getElementById('settings-deck-description-input').value = deck.description || '';
    document.getElementById('settings-new-cards-limit').value = deck.new_cards_limit !== undefined ? deck.new_cards_limit : 15;
    document.getElementById('settings-learning-steps').value = deck.learning_steps !== undefined ? deck.learning_steps : '1 10';
    document.getElementById('settings-relearning-steps').value = deck.relearning_steps !== undefined ? deck.relearning_steps : '10';
    document.getElementById('settings-study-order').value = deck.study_order !== undefined ? deck.study_order : 'new_first';
    document.getElementById('settings-answer-display').value = deck.answer_display !== undefined ? deck.answer_display : 'replace';
    showView('deck-settings');
}

function saveDeckSettings() {
    if (!currentDeckForDetails || !bridge) return;
    var name = document.getElementById('settings-deck-name-input').value.trim();
    if (name === '') { showAlert('Deck name cannot be empty.'); return; }
    var parentId = parseInt(document.getElementById('settings-deck-parent-select').value, 10) || 0;
    var description = document.getElementById('settings-deck-description-input').value.trim();
    var limit = parseInt(document.getElementById('settings-new-cards-limit').value, 10);
    if (isNaN(limit) || limit < 0) { showAlert('Please enter a valid number.'); return; }
    var learningSteps = document.getElementById('settings-learning-steps').value.trim();
    var relearningSteps = document.getElementById('settings-relearning-steps').value.trim();
    var studyOrder = document.getElementById('settings-study-order').value || 'new_first';
    var answerDisplay = document.getElementById('settings-answer-display').value || 'replace';
    bridge.saveDeckSettings(currentDeckForDetails.id, name, description, limit, learningSteps, relearningSteps, studyOrder, answerDisplay, parentId);
    currentDeckForDetails.name = name;
    currentDeckForDetails.description = description;
    currentDeckForDetails.new_cards_limit = limit;
    currentDeckForDetails.learning_steps = learningSteps;
    currentDeckForDetails.relearning_steps = relearningSteps;
    currentDeckForDetails.study_order = studyOrder;
    currentDeckForDetails.answer_display = answerDisplay;
    currentDeckForDetails.parent_id = parentId || null;
    showDeckDetails(currentDeckForDetails);
}

var newQueue = [];
var dueQueue = [];
var learningQueue = []; // [{card, showAfter (ms timestamp)}] — time-gated cards waiting to return
var newCardIndex = 0;
var dueCardIndex = 0;
var currentCard = null;
var currentCardSource = null; // 'new', 'due', or 'learning'
var currentDeckIdForReview = null;
var currentDeckLearningSteps = [];
var currentDeckRelearnSteps = [];
var currentDeckAnswerDisplay = 'replace';
var studyOrder = 'mix';
var interspersionRatio = 1;
var mediaBaseUrl = '';

function updateReviewCounts() {
    var newCount = newQueue.length - newCardIndex;
    var reviewCount = dueQueue.length - dueCardIndex;
    var learningCount = learningQueue.length;
    // The current learning card was removed from the array to be shown,
    // so add it back to the displayed count to stay consistent with
    // new/due counts (which include the current card).
    if (currentCardSource === 'learning') {
        learningCount++;
    }
    document.getElementById('review-count-new').textContent = newCount;
    document.getElementById('review-count-learning').textContent = learningCount;
    document.getElementById('review-count-review').textContent = reviewCount;

    var newEl = document.getElementById('review-count-new');
    var learnEl = document.getElementById('review-count-learning');
    var reviewEl = document.getElementById('review-count-review');
    newEl.style.textDecoration = currentCardSource === 'new' ? 'underline' : 'none';
    learnEl.style.textDecoration = currentCardSource === 'learning' ? 'underline' : 'none';
    reviewEl.style.textDecoration = currentCardSource === 'due' ? 'underline' : 'none';
}

function startReview(deckId) {
    // Resume the existing session if one is active for this deck
    if (currentDeckIdForReview === deckId &&
        (newCardIndex < newQueue.length || dueCardIndex < dueQueue.length || learningQueue.length > 0)) {
        showView('review');
        return;
    }
    currentDeckIdForReview = deckId;
    if (bridge) {
        bridge.startReview(deckId);
    }
}

function updateReviewQueue(data) {
    currentDeckLearningSteps = data.learning_steps || [];
    currentDeckRelearnSteps = data.relearning_steps || [];
    currentDeckAnswerDisplay = data.answer_display || 'replace';
    mediaBaseUrl = data.media_base_url || '';
    studyOrder = data.study_order || 'mix';
    newQueue = data.new_cards || [];
    dueQueue = data.due_cards || [];
    learningQueue = [];
    newCardIndex = 0;
    dueCardIndex = 0;
    currentCardSource = null;
    // Anki-style intersperser ratio for 'mix' mode
    interspersionRatio = (dueQueue.length + 1) / (newQueue.length + 1);
    document.getElementById('review-card-section').style.display = 'block';
    document.getElementById('review-action-bar').style.display = 'flex';
    document.getElementById('review-complete-section').style.display = 'none';
    showView('review');
    updateReviewCounts();
    if (newQueue.length === 0 && dueQueue.length === 0) {
        showReviewComplete();
        return;
    }
    showNextCard();
}

function applyFuriganaFilter(text, filter) {
    // Parses "漢字[かんじ]" segments into ruby HTML (or kanji/kana only)
    return text.replace(/([^\s\[）」』]+)\[([^\]]+)\]/g, function(match, word, reading) {
        if (filter === 'kanji') return word;
        if (filter === 'kana')  return reading;
        return '<ruby>' + word + '<rt>' + reading + '</rt></ruby>';
    });
}

function renderTemplate(template, fields, frontHtml) {
    var result = template;
    // {{FrontSide}} — Anki special token: re-render the already-rendered front HTML
    result = result.replace(/\{\{FrontSide\}\}/gi, frontHtml || '');
    // Positive conditional blocks: {{#Field}}...{{/Field}} — show content when field is non-empty
    result = result.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function(match, key, content) {
        key = key.trim();
        return (fields[key] && fields[key].trim()) ? content : '';
    });
    // Negation conditional blocks: {{^Field}}...{{/Field}} — show content when field is empty
    result = result.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function(match, key, content) {
        key = key.trim();
        return (!fields[key] || !fields[key].trim()) ? content : '';
    });
    // Simple placeholders: {{Field}} or {{filter:Field}}
    result = result.replace(/\{\{([^}]+)\}\}/g, function(match, key) {
        key = key.trim();
        var filter = null;
        if (key.indexOf(':') !== -1) {
            var parts = key.split(':');
            filter = parts[0].trim().toLowerCase();
            key = parts[parts.length - 1].trim();
        }
        var value = fields.hasOwnProperty(key) ? (fields[key] || '') : '';
        if (filter === 'furigana' || filter === 'kanji' || filter === 'kana') {
            return applyFuriganaFilter(value, filter);
        }
        return value;
    });
    return result;
}

// Set innerHTML and re-execute any <script> tags, which browsers suppress on innerHTML injection.
function setInnerHTMLWithScripts(element, html) {
    element.innerHTML = html;
    Array.from(element.querySelectorAll('script')).forEach(function(oldScript) {
        var newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(function(attr) {
            newScript.setAttribute(attr.name, attr.value);
        });
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

function playAudioSequentially(container) {
    var audios = Array.from(container.querySelectorAll('audio'));
    if (audios.length === 0) return;
    function playNext(index) {
        if (index >= audios.length) return;
        var audio = audios[index];
        audio.play().catch(function(){});
        audio.addEventListener('ended', function() { playNext(index + 1); }, { once: true });
    }
    playNext(0);
}

function resolveMedia(text) {
    if (!text) return text;
    text = text.replace(/\[image:([^\]]+)\]/g,
        '<img loading="lazy" src="' + mediaBaseUrl + '$1" style="max-width:100%;max-height:300px;border-radius:6px;display:block;margin:0.5rem auto;">');
    text = text.replace(/\[sound:([^\]]+)\]/g,
        '<audio controls src="' + mediaBaseUrl + '$1" style="display:block;margin:0.5rem auto;"></audio>');
    // Handle bare <img src="filename"> from Anki templates (no protocol or path separator in src)
    text = text.replace(/(<img\b[^>]*?\bsrc=")([^"\/\\:]+)(")/gi,
        '$1' + mediaBaseUrl + '$2$3');
    return text;
}

function attachMedia(btn) {
    var fieldName = btn.getAttribute('data-field');
    var mediaType = btn.getAttribute('data-media');
    if (!bridge) return;
    bridge.selectMediaFile(mediaType, function(result) {
        if (result) {
            var ta = document.querySelector('.card-field-input[data-field="' + fieldName + '"]');
            if (ta) {
                if (ta.value && !ta.value.endsWith('\n')) ta.value += '\n';
                ta.value += result;
            }
        }
    });
}

function showNextCard() {
    var now = Date.now();
    var hasNew = newCardIndex < newQueue.length;
    var hasDue = dueCardIndex < dueQueue.length;
    var hasRegular = hasNew || hasDue;

    if (!hasRegular && learningQueue.length === 0) {
        showReviewComplete();
        return;
    }

    // Priority 1: Learning cards whose timer has elapsed (Anki always shows these first)
    var overdue = learningQueue.filter(function(item) { return item.showAfter <= now; });
    overdue.sort(function(a, b) { return a.showAfter - b.showAfter; });

    if (!hasRegular) {
        // All regular cards done — show the earliest pending learning card
        learningQueue.sort(function(a, b) { return a.showAfter - b.showAfter; });
        var item = learningQueue.shift();
        currentCard = item.card;
        currentCardSource = 'learning';
    } else if (overdue.length > 0) {
        // A learning card's timer has elapsed — show it immediately (highest priority)
        var item = overdue[0];
        learningQueue = learningQueue.filter(function(i) { return i !== item; });
        currentCard = item.card;
        currentCardSource = 'learning';
    } else {
        // Priority 2: Dynamically pick from new or due queue based on study_order
        var pickNew = false;
        if (hasNew && !hasDue) {
            pickNew = true;
        } else if (!hasNew && hasDue) {
            pickNew = false;
        } else if (studyOrder === 'new_first') {
            pickNew = true;
        } else if (studyOrder === 'new_last') {
            pickNew = false;
        } else {
            // 'mix' — Anki-style intersperser: evenly distribute new cards among due cards
            pickNew = (newCardIndex + 1) * interspersionRatio <= (dueCardIndex + 1);
        }
        if (pickNew) {
            currentCard = newQueue[newCardIndex];
            currentCardSource = 'new';
        } else {
            currentCard = dueQueue[dueCardIndex];
            currentCardSource = 'due';
        }
    }

    document.getElementById('review-card-css').textContent = currentCard.css_style || '';
    var frontEl = document.getElementById('review-front-text');
    if (currentCard.front_style) {
        setInnerHTMLWithScripts(frontEl, resolveMedia(renderTemplate(currentCard.front_style, currentCard.fields || {})));
    } else {
        var ft = currentCard.front || '';
        if (ft.indexOf('[image:') !== -1 || ft.indexOf('[sound:') !== -1) {
            setInnerHTMLWithScripts(frontEl, resolveMedia(ft));
        } else {
            frontEl.textContent = ft;
        }
    }
    if (currentReviewBehavior.autoplay_audio) playAudioSequentially(frontEl);
    document.getElementById('review-back-container').style.display = 'none';
    document.getElementById('review-rating-buttons').style.display = 'none';
    document.getElementById('review-show-answer-btn').style.display = 'block';
    updateReviewCounts();
}

function revealAnswer() {
    var frontEl = document.getElementById('review-front-text');
    var backEl = document.getElementById('review-back-text');
    var frontHtml = frontEl.innerHTML;
    if (currentDeckAnswerDisplay === 'replace') {
        if (currentCard.back_style) {
            setInnerHTMLWithScripts(frontEl, resolveMedia(renderTemplate(currentCard.back_style, currentCard.fields || {}, frontHtml)));
        } else {
            var bt = currentCard.back || '';
            if (bt.indexOf('[image:') !== -1 || bt.indexOf('[sound:') !== -1) {
                setInnerHTMLWithScripts(frontEl, resolveMedia(bt));
            } else {
                frontEl.textContent = bt;
            }
        }
        if (currentReviewBehavior.autoplay_audio) playAudioSequentially(frontEl);
    } else {
        if (currentCard.back_style) {
            setInnerHTMLWithScripts(backEl, resolveMedia(renderTemplate(currentCard.back_style, currentCard.fields || {}, frontHtml)));
        } else {
            var bt = currentCard.back || '';
            if (bt.indexOf('[image:') !== -1 || bt.indexOf('[sound:') !== -1) {
                setInnerHTMLWithScripts(backEl, resolveMedia(bt));
            } else {
                backEl.textContent = bt;
            }
        }
        if (currentReviewBehavior.autoplay_audio) playAudioSequentially(backEl);
        document.getElementById('review-back-container').style.display = 'block';
    }
    document.getElementById('review-rating-buttons').style.display = 'flex';
    document.getElementById('review-show-answer-btn').style.display = 'none';
}

function rateCard(rating) {
    if (!bridge || !currentCard) return;
    var steps = currentDeckLearningSteps;

    if (currentCard.is_new && steps.length > 0) {
        var curStep = (currentCard.learning_step !== null && currentCard.learning_step !== undefined)
            ? currentCard.learning_step : -1;
        var newStep;

        if (rating === 1) {         // Again → reset to step 0
            newStep = 0;
        } else if (rating === 3) {  // Hard → stay at current (or step 0 if fresh)
            newStep = Math.max(0, curStep);
        } else if (rating === 4) {  // Good → advance
            newStep = curStep + 1;
        } else {                    // Easy → graduate immediately
            newStep = steps.length;
        }

        if (newStep >= steps.length) {
            // Graduate: run through SM-2
            bridge.submitRating(currentCard.id, rating);
        } else {
            // Schedule card to return after the step's real-time delay
            bridge.updateCardLearningStep(currentCard.id, newStep);
            var requeueCard = Object.assign({}, currentCard, { learning_step: newStep });
            learningQueue.push({ card: requeueCard, showAfter: Date.now() + steps[newStep] * 60 * 1000 });
        }
    } else if (currentCard.is_relearning && currentDeckRelearnSteps.length > 0) {
        var relearnSteps = currentDeckRelearnSteps;
        var curStep = (currentCard.learning_step !== null && currentCard.learning_step !== undefined)
            ? currentCard.learning_step : 0;
        var newStep;

        if (rating === 1) {         // Again → reset to step 0
            newStep = 0;
        } else if (rating === 3) {  // Hard → stay at current step
            newStep = curStep;
        } else if (rating === 4) {  // Good → advance
            newStep = curStep + 1;
        } else {                    // Easy → graduate immediately
            newStep = relearnSteps.length;
        }

        if (newStep >= relearnSteps.length) {
            // Graduated from relearning
            bridge.submitRating(currentCard.id, rating);
        } else {
            // Schedule card to return after the relearn step's real-time delay
            bridge.updateCardLearningStep(currentCard.id, newStep);
            var requeueCard = Object.assign({}, currentCard, { learning_step: newStep, is_relearning: true });
            learningQueue.push({ card: requeueCard, showAfter: Date.now() + relearnSteps[newStep] * 60 * 1000 });
        }
    } else if (!currentCard.is_new && rating === 1 && currentDeckRelearnSteps.length > 0) {
        // Card lapsed — record the failure then start relearning steps
        bridge.logLapse(currentCard.id, rating);
        bridge.updateCardLearningStep(currentCard.id, 0);
        var requeueCard = Object.assign({}, currentCard, { learning_step: 0, is_relearning: true });
        learningQueue.push({ card: requeueCard, showAfter: Date.now() + currentDeckRelearnSteps[0] * 60 * 1000 });
    } else {
        bridge.submitRating(currentCard.id, rating);
    }

    // Advance the appropriate queue pointer
    if (currentCardSource === 'new') {
        newCardIndex++;
    } else if (currentCardSource === 'due') {
        dueCardIndex++;
    }

    showNextCard();
}

function showReviewComplete() {
    document.getElementById('review-card-section').style.display = 'none';
    document.getElementById('review-action-bar').style.display = 'none';
    document.getElementById('review-complete-section').style.display = 'flex';
    var cssEl = document.getElementById('review-card-css');
    if (cssEl) cssEl.textContent = '';
}

document.addEventListener('keydown', function(e) {
    if (!currentReviewBehavior.shortcut_enabled || e.code !== currentReviewBehavior.shortcut_key) return;
    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
    if (document.getElementById('review-view').classList.contains('view-hidden')) return;
    e.preventDefault();
    var showBtn = document.getElementById('review-show-answer-btn');
    if (showBtn && showBtn.style.display !== 'none') {
        revealAnswer();
    } else if (document.getElementById('review-rating-buttons').style.display !== 'none') {
        rateCard(4);
    }
});

function updateCardTypes(types) {
    cardTypes = types;
    var list = document.getElementById('card-type-list');
    if (list) {
        list.innerHTML = '';
        if (types.length === 0) {
            list.innerHTML = '<p>No card types found.</p>';
        } else {
            var listFrag = document.createDocumentFragment();
            types.forEach(function(ct) {
                var div = document.createElement('div');
                div.className = 'card text-white mb-3';
                div.style.cssText = 'background-color:' + currentAccent + ';width:50%;';
                var actionButtons = ct.is_default ? '' :
                    '<div class="mt-2 d-flex gap-2">' +
                    '<button class="btn btn-dark btn-sm" onclick="showEditCardTypeById(' + ct.id + ')" style="background-color:#2d2a3e;">Edit</button>' +
                    '<button class="btn btn-dark btn-sm" onclick="confirmDeleteCardType(' + ct.id + ')" style="background-color:#c0392b;">Delete</button>' +
                    '</div>';
                div.innerHTML = '<div class="card-body"><h5 class="card-title mb-1">' + ct.name +
                    (ct.is_default ? ' <span class="badge" style="background-color:#2d2a3e;font-size:0.75rem;">Default</span>' : '') +
                    '</h5><p class="mb-1" style="font-size:0.9rem;">Fields: ' + ct.fields.join(', ') + '</p>' +
                    actionButtons + '</div>';
                listFrag.appendChild(div);
            });
            list.appendChild(listFrag);
        }
    }
    var select = document.getElementById('card-type-select');
    if (select) {
        var prev = select.value;
        select.innerHTML = '';
        var selectFrag = document.createDocumentFragment();
        types.forEach(function(ct) {
            var opt = document.createElement('option');
            opt.value = ct.id;
            opt.textContent = ct.name;
            selectFrag.appendChild(opt);
        });
        select.appendChild(selectFrag);
        if (prev && types.some(function(ct) { return String(ct.id) === prev; })) select.value = prev;
        renderCardFields(select.value);
    }
}

function renderCardFields(typeId) {
    var container = document.getElementById('card-fields-container');
    if (!container) return;
    container.innerHTML = '';
    var ct = cardTypes.find(function(t) { return String(t.id) === String(typeId); });
    if (!ct) return;
    var card = document.createElement('div');
    card.className = 'card mb-4 settings-card';
    card.style.maxWidth = '560px';
    var cardBody = document.createElement('div');
    cardBody.className = 'card-body text-white';
    var title = document.createElement('h2');
    title.className = 'settings-section-title';
    title.textContent = 'Content';
    cardBody.appendChild(title);
    ct.fields.forEach(function(fieldName) {
        var wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        wrapper.innerHTML = '<label class="form-label settings-label">' + fieldName + '</label>' +
            '<textarea class="form-control settings-input card-field-input" data-field="' + fieldName +
            '" placeholder="Enter ' + fieldName +
            '" style="height:100px;"></textarea>' +
            '<div class="mt-1 d-flex gap-2">' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="image" onclick="attachMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">📷 Image</button>' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="audio" onclick="attachMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">🔊 Audio</button>' +
            '</div>';
        cardBody.appendChild(wrapper);
    });
    card.appendChild(cardBody);
    container.appendChild(card);
}

function addCardTypeField(defaultValue) {
    fieldCounter++;
    var id = 'ct-field-' + fieldCounter;
    var row = document.createElement('div');
    row.className = 'd-flex align-items-center mb-2';
    row.id = 'row-' + id;
    row.innerHTML = '<input type="text" class="form-control settings-input card-type-field-input" id="' + id +
        '" placeholder="Field name" value="' + (defaultValue || '') + '">' +
        '<button class="btn btn-dark ms-2" onclick="removeCardTypeField(\'row-' + id +
        '\')" style="background-color:#c0392b;min-width:2.5rem;">✕</button>';
    document.getElementById('card-type-fields-list').appendChild(row);
}

function removeCardTypeField(rowId) {
    var row = document.getElementById(rowId);
    if (row) row.remove();
}

function initCreateCardTypeView() {
    document.getElementById('card-type-name').value = '';
    document.getElementById('card-type-fields-list').innerHTML = '';
    document.getElementById('card-type-front-style').value = '';
    document.getElementById('card-type-back-style').value = '';
    document.getElementById('card-type-css-style').value = '';
    fieldCounter = 0;
    addCardTypeField('');
    addCardTypeField('');
}

function submitCreateCardType() {
    var name = document.getElementById('card-type-name').value.trim();
    if (!name) { showAlert('Please enter a card type name.'); return; }
    var inputs = document.querySelectorAll('.card-type-field-input');
    var fields = Array.from(inputs).map(function(i) { return i.value.trim(); }).filter(Boolean);
    if (fields.length === 0) { showAlert('Please add at least one field.'); return; }
    var frontStyle = document.getElementById('card-type-front-style').value;
    var backStyle = document.getElementById('card-type-back-style').value;
    var cssStyle = document.getElementById('card-type-css-style').value;
    if (bridge) { bridge.createCardType(name, JSON.stringify(fields), frontStyle, backStyle, cssStyle); showView('card-types'); }
}

var currentEditingCardType = null;

function showEditCardTypeById(id) {
    var ct = cardTypes.find(function(t) { return t.id === id; });
    if (!ct) return;
    currentEditingCardType = ct;
    document.getElementById('edit-card-type-name').value = ct.name;
    document.getElementById('edit-card-type-fields-list').innerHTML = '';
    fieldCounter = 0;
    ct.fields.forEach(function(f) { addEditCardTypeField(f); });
    document.getElementById('edit-card-type-front-style').value = ct.front_style || '';
    document.getElementById('edit-card-type-back-style').value = ct.back_style || '';
    document.getElementById('edit-card-type-css-style').value = ct.css_style || '';
    showView('edit-card-type');
}

function addEditCardTypeField(defaultValue) {
    fieldCounter++;
    var id = 'edit-ct-field-' + fieldCounter;
    var row = document.createElement('div');
    row.className = 'd-flex align-items-center mb-2';
    row.id = 'edit-row-' + id;
    row.innerHTML = '<input type="text" class="form-control settings-input edit-card-type-field-input" id="' + id +
        '" placeholder="Field name" value="' + (defaultValue || '') + '">' +
        '<button class="btn btn-dark ms-2" onclick="removeEditCardTypeField(\'edit-row-' + id +
        '\')" style="background-color:#c0392b;min-width:2.5rem;">✕</button>';
    document.getElementById('edit-card-type-fields-list').appendChild(row);
}

function removeEditCardTypeField(rowId) {
    var row = document.getElementById(rowId);
    if (row) row.remove();
}

function submitEditCardType() {
    if (!currentEditingCardType) return;
    var name = document.getElementById('edit-card-type-name').value.trim();
    if (!name) { showAlert('Please enter a card type name.'); return; }
    var inputs = document.querySelectorAll('.edit-card-type-field-input');
    var fields = Array.from(inputs).map(function(i) { return i.value.trim(); }).filter(Boolean);
    if (fields.length === 0) { showAlert('Please add at least one field.'); return; }
    var frontStyle = document.getElementById('edit-card-type-front-style').value;
    var backStyle = document.getElementById('edit-card-type-back-style').value;
    var cssStyle = document.getElementById('edit-card-type-css-style').value;
    if (bridge) { bridge.updateCardType(currentEditingCardType.id, name, JSON.stringify(fields), frontStyle, backStyle, cssStyle); showView('card-types'); }
}

function blurActiveElement(modalEl) {
    modalEl.addEventListener('hide.bs.modal', function() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, { once: true });
}

function showAlert(message) {
    var modalEl = document.getElementById('alert-modal');
    document.getElementById('alert-modal-message').textContent = message;
    blurActiveElement(modalEl);
    var modal = new bootstrap.Modal(modalEl);
    modal.show();
}

var confirmModalCallback = null;

function showConfirm(message, callback) {
    var modalEl = document.getElementById('confirm-modal');
    confirmModalCallback = callback;
    document.getElementById('confirm-modal-message').textContent = message;
    blurActiveElement(modalEl);
    var modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function confirmModalAction() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    var modal = bootstrap.Modal.getInstance(document.getElementById('confirm-modal'));
    if (modal) modal.hide();
    if (confirmModalCallback) {
        confirmModalCallback();
        confirmModalCallback = null;
    }
}

function confirmDeleteCardType(id) {
    showConfirm('Delete this card type? Cards using it will keep their existing data.', function() {
        if (bridge) bridge.deleteCardType(id);
    });
}

function createCard() {
    var deckSelect = document.getElementById('card-deck-select');
    var currentDeckId = parseInt(deckSelect.value, 10);
    var typeSelect = document.getElementById('card-type-select');
    var cardTypeId = parseInt(typeSelect.value, 10);
    if (!currentDeckId) { showAlert('Please select a deck.'); return; }
    var fieldsObj = {};
    var hasContent = false;
    document.querySelectorAll('.card-field-input').forEach(function(ta) {
        fieldsObj[ta.getAttribute('data-field')] = ta.value.trim();
        if (ta.value.trim()) hasContent = true;
    });
    if (!hasContent) { showAlert('Please fill in at least one field.'); return; }
    if (bridge) {
        bridge.createCard(currentDeckId, cardTypeId, JSON.stringify(fieldsObj));
        document.querySelectorAll('.card-field-input').forEach(function(ta) { ta.value = ''; });
        showView('srs');
    }
}

// ===== Card Browser =====

var browseDebounceTimer = null;
var browseCards = [];
var browsePage = 0;
var BROWSE_PAGE_SIZE = 100;

function populateBrowseDeckSelect() {
    var select = document.getElementById('browse-deck-select');
    if (!select) return;
    var prev = select.value;
    select.innerHTML = '<option value="0">All Decks</option>';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    populateDeckSelectHierarchical(select, flat);
    if (prev && (prev === '0' || decks.some(function(d) { return String(d.id) === prev; }))) {
        select.value = prev;
    }
}

function fetchBrowseCards() {
    if (!bridge) return;
    var deckSel = document.getElementById('browse-deck-select');
    var searchInput = document.getElementById('browse-search-input');
    var sortSel = document.getElementById('browse-sort-select');
    bridge.browseCards(
        String(deckSel ? deckSel.value : '0'),
        searchInput ? searchInput.value : '',
        sortSel ? sortSel.value : 'date_created_desc'
    );
}

function debounceBrowseSearch() {
    if (browseDebounceTimer) clearTimeout(browseDebounceTimer);
    browseDebounceTimer = setTimeout(fetchBrowseCards, 300);
}

function stripHtmlTags(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function truncate(text, maxLen) {
    text = stripHtmlTags(text || '');
    text = text.replace(/\[image:[^\]]+\]/g, '[img]').replace(/\[sound:[^\]]+\]/g, '[audio]');
    if (text.length > maxLen) return text.substring(0, maxLen) + '...';
    return text;
}

function updateBrowseCards(cards) {
    browseCards = cards;
    browsePage = 0;
    renderBrowsePage();
}

function renderBrowsePage() {
    var container = document.getElementById('browse-card-list');
    var countEl = document.getElementById('browse-card-count');
    if (!container) return;

    var totalCards = browseCards.length;
    countEl.textContent = totalCards + (totalCards === 1 ? ' card' : ' cards');

    if (totalCards === 0) {
        container.innerHTML = '<p style="opacity: 0.6;">No cards found.</p>';
        return;
    }

    var totalPages = Math.ceil(totalCards / BROWSE_PAGE_SIZE);
    var start = browsePage * BROWSE_PAGE_SIZE;
    var end = Math.min(start + BROWSE_PAGE_SIZE, totalCards);
    var pageCards = browseCards.slice(start, end);

    var table = document.createElement('table');
    table.className = 'browse-table';

    // Event delegation: single click handler on table
    table.addEventListener('click', function(e) {
        var row = e.target.closest('.browse-row');
        if (row && row.dataset.cardId) {
            editCardFromBrowser(parseInt(row.dataset.cardId, 10));
        }
    });

    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Front</th><th>Back</th><th>Deck</th><th>Type</th><th>Due</th><th>Interval</th></tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < pageCards.length; i++) {
        var card = pageCards[i];
        var tr = document.createElement('tr');
        tr.className = 'browse-row';
        tr.dataset.cardId = card.id;
        var frontText = truncate(card.front, 60);
        var backText = truncate(card.back, 60);
        var statusBadge = card.is_new ? ' <span class="browse-badge browse-badge-new">New</span>' : '';
        tr.innerHTML =
            '<td>' + frontText + statusBadge + '</td>' +
            '<td>' + backText + '</td>' +
            '<td>' + (card.deck_name || '') + '</td>' +
            '<td>' + (card.type_name || '') + '</td>' +
            '<td>' + (card.due_date || '—') + '</td>' +
            '<td>' + (card.interval || 0) + 'd</td>';
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);

    // Pagination controls
    if (totalPages > 1) {
        var nav = document.createElement('div');
        nav.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:1rem;margin-top:0.75rem;';
        var prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-dark btn-sm';
        prevBtn.textContent = 'Previous';
        prevBtn.disabled = browsePage === 0;
        prevBtn.style.backgroundColor = '#2d2a3e';
        prevBtn.addEventListener('click', function() { if (browsePage > 0) { browsePage--; renderBrowsePage(); } });
        var info = document.createElement('span');
        info.style.color = '#aaa';
        info.textContent = 'Page ' + (browsePage + 1) + ' of ' + totalPages;
        var nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-dark btn-sm';
        nextBtn.textContent = 'Next';
        nextBtn.disabled = browsePage >= totalPages - 1;
        nextBtn.style.backgroundColor = '#2d2a3e';
        nextBtn.addEventListener('click', function() { if (browsePage < totalPages - 1) { browsePage++; renderBrowsePage(); } });
        nav.appendChild(prevBtn);
        nav.appendChild(info);
        nav.appendChild(nextBtn);
        container.appendChild(nav);
    }
}

var editCardData = null; // Store the card being edited

function editCardFromBrowser(cardId) {
    if (bridge) {
        bridge.getCardForEdit(cardId);
    }
}

function loadCardForEdit(data) {
    var card = data.card;
    // Update cardTypes from bundled data to avoid race condition
    if (data.card_types) {
        cardTypes = data.card_types;
    }

    editCardData = card;
    document.getElementById('edit-card-id').value = card.id;

    // Populate deck select
    var deckSelect = document.getElementById('edit-card-deck-select');
    deckSelect.innerHTML = '';
    var tree = buildDeckTree(decks);
    var flat = flattenDeckTree(tree, 0);
    populateDeckSelectHierarchical(deckSelect, flat);
    if (card.deck_id) deckSelect.value = card.deck_id;

    // Populate card type select
    var typeSelect = document.getElementById('edit-card-type-select');
    typeSelect.innerHTML = '';
    var typeFrag = document.createDocumentFragment();
    cardTypes.forEach(function(ct) {
        var opt = document.createElement('option');
        opt.value = ct.id;
        opt.textContent = ct.name;
        typeFrag.appendChild(opt);
    });
    typeSelect.appendChild(typeFrag);
    if (card.card_type_id) typeSelect.value = card.card_type_id;

    // Stats
    var statusText = card.is_new ? 'New' : (card.interval >= 21 ? 'Mature' : 'Young');
    document.getElementById('edit-card-status').textContent = statusText;
    document.getElementById('edit-card-reps').textContent = card.reps || 0;
    document.getElementById('edit-card-interval').textContent = card.interval || 0;
    document.getElementById('edit-card-ease').textContent = card.ease_factor || '2.5';
    document.getElementById('edit-card-due').textContent = card.due_date || '—';
    document.getElementById('edit-card-created').textContent = card.date_created || '—';
    document.getElementById('edit-card-last-reviewed').textContent = card.last_reviewed || '—';

    // Parse existing field data
    var fields = {};
    if (card.fields) {
        try { fields = typeof card.fields === 'string' ? JSON.parse(card.fields) : card.fields; }
        catch(e) { fields = {}; }
    }

    // If no fields JSON exists, build from front/back
    var ct = cardTypes.find(function(t) { return String(t.id) === String(card.card_type_id); });
    if (Object.keys(fields).length === 0 && (card.front || card.back)) {
        if (ct && ct.fields.length > 0) {
            fields[ct.fields[0]] = card.front || '';
            if (ct.fields.length > 1) fields[ct.fields[1]] = card.back || '';
        }
    }

    renderEditCardFields(typeSelect.value, fields);
    showView('edit-card');
}

// --- Formatting toolbar helpers ---
var HIGHLIGHT_COLOR = '#f5c842';

function applyFormatting(fieldName, command) {
    var el = document.querySelector('.edit-card-field-input[data-field="' + fieldName + '"]');
    if (!el) return;
    el.focus();
    if (command === 'highlight') {
        applyHighlight(el);
    } else if (command === 'removeFormat') {
        document.execCommand('removeFormat', false, null);
    } else {
        document.execCommand(command, false, null);
    }
    updateToolbarState(fieldName);
}

function applyHighlight(el) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);

    // Check if already inside a highlight span
    var node = sel.anchorNode;
    var highlightParent = null;
    while (node && node !== el) {
        if (node.nodeType === 1 && node.tagName === 'SPAN' && node.getAttribute('data-highlight') === 'true') {
            highlightParent = node;
            break;
        }
        node = node.parentNode;
    }

    if (highlightParent) {
        // Remove highlight: unwrap the span
        var parent = highlightParent.parentNode;
        while (highlightParent.firstChild) {
            parent.insertBefore(highlightParent.firstChild, highlightParent);
        }
        parent.removeChild(highlightParent);
    } else if (!range.collapsed) {
        // Apply highlight to selection
        var span = document.createElement('span');
        span.style.backgroundColor = HIGHLIGHT_COLOR;
        span.style.color = '#222';
        span.style.borderRadius = '2px';
        span.setAttribute('data-highlight', 'true');
        try {
            range.surroundContents(span);
            sel.removeAllRanges();
            var newRange = document.createRange();
            newRange.selectNodeContents(span);
            sel.addRange(newRange);
        } catch (e) {
            // surroundContents fails if selection crosses element boundaries
            // Fall back to extracting and wrapping
            var fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
            sel.removeAllRanges();
            var fallbackRange = document.createRange();
            fallbackRange.selectNodeContents(span);
            sel.addRange(fallbackRange);
        }
    }
}

function isInsideHighlight(el) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return false;
    var node = sel.anchorNode;
    while (node && node !== el) {
        if (node.nodeType === 1 && node.tagName === 'SPAN' && node.getAttribute('data-highlight') === 'true') {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

function updateToolbarState(fieldName) {
    var toolbar = document.querySelector('.formatting-toolbar[data-field="' + fieldName + '"]');
    if (!toolbar) return;
    var el = document.querySelector('.edit-card-field-input[data-field="' + fieldName + '"]');
    toolbar.querySelectorAll('.formatting-btn').forEach(function(btn) {
        var cmd = btn.getAttribute('data-cmd');
        if (!cmd || cmd === 'removeFormat') return;
        var active = false;
        if (cmd === 'highlight') {
            active = el ? isInsideHighlight(el) : false;
        } else {
            active = document.queryCommandState(cmd);
        }
        if (active) {
            btn.classList.add('formatting-btn-active');
        } else {
            btn.classList.remove('formatting-btn-active');
        }
    });
}

function buildFormattingToolbar(fieldName) {
    var buttons = [
        { label: 'B', cmd: 'bold', title: 'Bold (Ctrl+B)', style: 'font-weight:bold;' },
        { label: 'I', cmd: 'italic', title: 'Italic (Ctrl+I)', style: 'font-style:italic;' },
        { label: 'U', cmd: 'underline', title: 'Underline (Ctrl+U)', style: 'text-decoration:underline;' },
        { label: 'S', cmd: 'strikeThrough', title: 'Strikethrough (Ctrl+Shift+S)', style: 'text-decoration:line-through;' },
        { label: 'H', cmd: 'highlight', title: 'Highlight (Ctrl+Shift+H)', style: 'background-color:#f5c842;color:#222;border-radius:2px;' },
        { label: 'C', cmd: 'removeFormat', title: 'Clear Formatting (Ctrl+Shift+X)', style: 'opacity:0.7;' }
    ];
    var escapedField = fieldName.replace(/'/g, "\\'");
    var html = '<div class="d-flex gap-1 mb-1 formatting-toolbar" data-field="' + fieldName + '">';
    buttons.forEach(function(b) {
        html += '<button type="button" class="btn btn-dark btn-sm formatting-btn" ' +
            'data-cmd="' + b.cmd + '" ' +
            'title="' + b.title + '" ' +
            'onmousedown="event.preventDefault(); applyFormatting(\'' + escapedField + '\', \'' + b.cmd + '\')" ' +
            'style="background-color:#35324a;font-size:0.78rem;min-width:28px;padding:2px 6px;' + b.style + '">' +
            b.label + '</button>';
    });
    html += '</div>';
    return html;
}

function setupFormattingShortcuts(editor) {
    var fieldName = editor.getAttribute('data-field');

    editor.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            var cmd = null;
            if (e.key === 'b' && !e.shiftKey) cmd = 'bold';
            else if (e.key === 'i' && !e.shiftKey) cmd = 'italic';
            else if (e.key === 'u' && !e.shiftKey) cmd = 'underline';
            else if (e.key === 'S' || (e.key === 's' && e.shiftKey)) cmd = 'strikeThrough';
            else if (e.key === 'H' || (e.key === 'h' && e.shiftKey)) cmd = 'highlight';
            else if (e.key === 'X' || (e.key === 'x' && e.shiftKey)) cmd = 'removeFormat';
            if (cmd) {
                e.preventDefault();
                applyFormatting(fieldName, cmd);
            }
        }
    });

    // Update toolbar state when cursor moves or selection changes
    editor.addEventListener('keyup', function() { updateToolbarState(fieldName); });
    editor.addEventListener('mouseup', function() { updateToolbarState(fieldName); });
    editor.addEventListener('focus', function() { updateToolbarState(fieldName); });
}

function getEditFieldValue(el) {
    return el.innerHTML.replace(/<br\s*\/?>\s*$/, '').trim();
}

function renderEditCardFields(typeId, existingFields) {
    var container = document.getElementById('edit-card-fields-container');
    if (!container) return;

    // If called from onchange (no existingFields), preserve current field values
    if (!existingFields) {
        existingFields = {};
        document.querySelectorAll('.edit-card-field-input').forEach(function(el) {
            existingFields[el.getAttribute('data-field')] = getEditFieldValue(el);
        });
    }

    container.innerHTML = '';
    var ct = cardTypes.find(function(t) { return String(t.id) === String(typeId); });

    if (!ct) {
        // No card type found — show raw Front / Back fields
        var rawFields = [
            { name: 'Front', value: (existingFields && existingFields['Front']) || (editCardData ? editCardData.front : '') || '' },
            { name: 'Back', value: (existingFields && existingFields['Back']) || (editCardData ? editCardData.back : '') || '' }
        ];
        var rawCard = document.createElement('div');
        rawCard.className = 'card mb-4 settings-card';
        rawCard.style.maxWidth = '560px';
        var rawCardBody = document.createElement('div');
        rawCardBody.className = 'card-body text-white';
        var rawTitle = document.createElement('h2');
        rawTitle.className = 'settings-section-title';
        rawTitle.textContent = 'Content';
        rawCardBody.appendChild(rawTitle);
        rawFields.forEach(function(rf) {
            var wrapper = document.createElement('div');
            wrapper.className = 'mb-3';
            wrapper.innerHTML = '<label class="form-label settings-label">' + rf.name + '</label>' +
                buildFormattingToolbar(rf.name) +
                '<div class="form-control settings-input edit-card-field-input" contenteditable="true" data-field="' + rf.name +
                '" data-placeholder="Enter ' + rf.name +
                '" style="height:100px;overflow-y:auto;"></div>' +
                '<div class="mt-1 d-flex gap-2">' +
                '<button type="button" class="btn btn-dark btn-sm" data-field="' + rf.name + '" data-media="image" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">📷 Image</button>' +
                '<button type="button" class="btn btn-dark btn-sm" data-field="' + rf.name + '" data-media="audio" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">🔊 Audio</button>' +
                '</div>';
            rawCardBody.appendChild(wrapper);
            var editor = wrapper.querySelector('.edit-card-field-input');
            editor.innerHTML = rf.value;
            setupFormattingShortcuts(editor);
        });
        rawCard.appendChild(rawCardBody);
        container.appendChild(rawCard);
        return;
    }

    var card = document.createElement('div');
    card.className = 'card mb-4 settings-card';
    card.style.maxWidth = '560px';
    var cardBody = document.createElement('div');
    cardBody.className = 'card-body text-white';
    var title = document.createElement('h2');
    title.className = 'settings-section-title';
    title.textContent = 'Content';
    cardBody.appendChild(title);
    ct.fields.forEach(function(fieldName) {
        var wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        wrapper.innerHTML = '<label class="form-label settings-label">' + fieldName + '</label>' +
            buildFormattingToolbar(fieldName) +
            '<div class="form-control settings-input edit-card-field-input" contenteditable="true" data-field="' + fieldName +
            '" data-placeholder="Enter ' + fieldName +
            '" style="height:100px;overflow-y:auto;"></div>' +
            '<div class="mt-1 d-flex gap-2">' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="image" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">📷 Image</button>' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="audio" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">🔊 Audio</button>' +
            '</div>';
        cardBody.appendChild(wrapper);
        var editor = wrapper.querySelector('.edit-card-field-input');
        if (existingFields && existingFields[fieldName] !== undefined) {
            editor.innerHTML = existingFields[fieldName];
        }
        setupFormattingShortcuts(editor);
    });
    card.appendChild(cardBody);
    container.appendChild(card);
}

function attachEditMedia(btn) {
    var fieldName = btn.getAttribute('data-field');
    var mediaType = btn.getAttribute('data-media');
    if (!bridge) return;
    bridge.selectMediaFile(mediaType, function(result) {
        if (result) {
            var el = document.querySelector('.edit-card-field-input[data-field="' + fieldName + '"]');
            if (el) {
                var content = el.innerHTML.replace(/<br\s*\/?>\s*$/, '');
                if (content && content.length > 0) content += '<br>';
                el.innerHTML = content + result;
            }
        }
    });
}

function saveEditCard() {
    var cardId = parseInt(document.getElementById('edit-card-id').value, 10);
    var deckId = parseInt(document.getElementById('edit-card-deck-select').value, 10);
    var typeId = parseInt(document.getElementById('edit-card-type-select').value, 10);

    var fieldsObj = {};
    var hasContent = false;
    document.querySelectorAll('.edit-card-field-input').forEach(function(el) {
        var val = getEditFieldValue(el);
        fieldsObj[el.getAttribute('data-field')] = val;
        if (val) hasContent = true;
    });

    if (!hasContent) { showAlert('Please fill in at least one field.'); return; }

    var ct = cardTypes.find(function(t) { return t.id === typeId; });
    var fieldValues = ct ? ct.fields.map(function(f) { return fieldsObj[f] || ''; }) : Object.values(fieldsObj);
    var front = fieldValues[0] || '';
    var back = fieldValues.length > 1 ? fieldValues.slice(1).join(' / ') : '';

    if (bridge) {
        bridge.updateCard(cardId, deckId, typeId, JSON.stringify(fieldsObj), front, back);
        showAlert('Card saved.');
        showView('card-browser');
    }
}

function deleteCardFromEdit() {
    var cardId = parseInt(document.getElementById('edit-card-id').value, 10);
    showConfirm('Delete this card? This cannot be undone.', function() {
        if (bridge) {
            bridge.deleteCardFromBrowser(cardId);
            showView('card-browser');
        }
    });
}

// ── Card Preview ──

var previewCardTypeId = null;

function openCardPreview() {
    var typeId = document.getElementById('edit-card-type-select').value;
    var ct = cardTypes.find(function(t) { return String(t.id) === String(typeId); });
    previewCardTypeId = typeId;

    // Populate styling fields from the card type
    document.getElementById('preview-front-template').value = (ct && ct.front_style) || '';
    document.getElementById('preview-back-template').value = (ct && ct.back_style) || '';
    document.getElementById('preview-css-style').value = (ct && ct.css_style) || '';

    showView('card-preview');
    refreshCardPreview();
}

function getEditCardFields() {
    var fields = {};
    document.querySelectorAll('.edit-card-field-input').forEach(function(el) {
        fields[el.getAttribute('data-field')] = getEditFieldValue(el);
    });
    return fields;
}

function refreshCardPreview() {
    var frontTemplate = document.getElementById('preview-front-template').value;
    var backTemplate = document.getElementById('preview-back-template').value;
    var css = document.getElementById('preview-css-style').value;
    var fields = getEditCardFields();

    // Apply CSS
    document.getElementById('preview-card-css').textContent = css;

    // Render front
    var frontEl = document.getElementById('preview-front-render');
    if (frontTemplate) {
        setInnerHTMLWithScripts(frontEl, resolveMedia(renderTemplate(frontTemplate, fields)));
    } else {
        var firstField = Object.keys(fields)[0];
        setInnerHTMLWithScripts(frontEl, resolveMedia(firstField ? fields[firstField] : ''));
    }

    // Render back
    var backEl = document.getElementById('preview-back-render');
    var frontHtml = frontEl.innerHTML;
    if (backTemplate) {
        setInnerHTMLWithScripts(backEl, resolveMedia(renderTemplate(backTemplate, fields, frontHtml)));
    } else {
        var fieldKeys = Object.keys(fields);
        setInnerHTMLWithScripts(backEl, resolveMedia(fieldKeys.length > 1 ? fields[fieldKeys[1]] : ''));
    }
}

function savePreviewStyling() {
    var ct = cardTypes.find(function(t) { return String(t.id) === String(previewCardTypeId); });
    if (!ct) { showAlert('Card type not found.'); return; }

    var frontStyle = document.getElementById('preview-front-template').value;
    var backStyle = document.getElementById('preview-back-template').value;
    var cssStyle = document.getElementById('preview-css-style').value;

    if (bridge) {
        bridge.updateCardType(ct.id, ct.name, JSON.stringify(ct.fields), frontStyle, backStyle, cssStyle);
        // Update local cardTypes cache
        ct.front_style = frontStyle;
        ct.back_style = backStyle;
        ct.css_style = cssStyle;
        showAlert('Styling saved.');
        showView('edit-card');
    }
}
