var bridge;
var cardTypes = [];
var decks = [];
var fieldCounter = 0;
var createCardPreselectedDeckId = null;
var currentAccent = '#9067C6';
var currentFontSize = 'medium';
var FONT_SIZE_MAP = { small: '1.8rem', medium: '2.5rem', large: '3.5rem' };

new QWebChannel(qt.webChannelTransport, function(channel) {
    bridge = channel.objects.bridge;
    bridge.refreshStats();
    bridge.getAppSettings();
    bridge.getDecks();
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
    };
    currentReviewBehavior = {
        autoplay_audio: settings.review_autoplay_audio !== undefined ? settings.review_autoplay_audio : true,
        shortcut_enabled: settings.review_shortcut_enabled !== undefined ? settings.review_shortcut_enabled : true,
        shortcut_key: settings.review_shortcut_key || 'Space',
    };
}

var currentSRSDefaults = { new_cards_limit: 15, learning_steps: '1 10', relearning_steps: '10', study_order: 'new_first' };
var currentReviewBehavior = { autoplay_audio: true, shortcut_enabled: true, shortcut_key: 'Space' };
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
    document.getElementById('review-autoplay-audio').checked = currentReviewBehavior.autoplay_audio;
    document.getElementById('review-shortcut-enabled').checked = currentReviewBehavior.shortcut_enabled;
    document.getElementById('shortcut-key-btn').textContent = getKeyDisplayName(currentReviewBehavior.shortcut_key);
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

function buildSettings(overrides) {
    return Object.assign({
        accent_color: currentAccent,
        font_size: currentFontSize,
        default_new_cards_limit: currentSRSDefaults.new_cards_limit,
        default_learning_steps: currentSRSDefaults.learning_steps,
        default_relearning_steps: currentSRSDefaults.relearning_steps,
        default_study_order: currentSRSDefaults.study_order,
        review_autoplay_audio: currentReviewBehavior.autoplay_audio,
        review_shortcut_enabled: currentReviewBehavior.shortcut_enabled,
        review_shortcut_key: currentReviewBehavior.shortcut_key,
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
        review_autoplay_audio: document.getElementById('review-autoplay-audio').checked,
        review_shortcut_enabled: document.getElementById('review-shortcut-enabled').checked,
        review_shortcut_key: currentReviewBehavior.shortcut_key,
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

function populateCardDeckSelect() {
    var select = document.getElementById('card-deck-select');
    if (!select) return;
    var preselect = createCardPreselectedDeckId !== null ? String(createCardPreselectedDeckId) : select.value;
    select.innerHTML = '';
    var frag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
    if (preselect && decks.some(function(d) { return String(d.id) === preselect; })) {
        select.value = preselect;
    }
}

function populateRetentionDeckSelect() {
    var select = document.getElementById('retention-deck-select');
    if (!select) return;
    var prev = select.value;
    select.innerHTML = '<option value="0">All Decks</option>';
    var frag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
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
    var frag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
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

function updateDecks(deckData) {
    decks = deckData;
    populateCardDeckSelect();
    populateRetentionDeckSelect();
    populateHeatmapDeckSelect();
    if (!document.getElementById('dashboard-view').classList.contains('view-hidden')) {
        fetchRetentionStats();
        fetchHeatmap();
    }
    var container = document.getElementById('deck-list');
    container.innerHTML = '';
    if (decks.length === 0) {
        container.innerHTML = '<p class="text">No decks found. Create or import a deck to get started.</p>';
        return;
    }
    var frag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var card = document.createElement('div');
        card.className = 'card text-white mb-3 deck-card';
        card.style.backgroundColor = '#2d2a3e';
        card.style.borderTop = '3px solid ' + currentAccent;
        card.style.borderLeft = 'none';
        card.style.borderRight = 'none';
        card.style.borderBottom = '1px solid #3d3a50';
        card.style.cursor = 'pointer';
        card.style.maxWidth = '600px';
        card.style.transition = 'background-color 0.15s ease';
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
                '<div>' +
                    '<h5 class="card-title mb-0" style="color: white; font-weight: 600;">' + deck.name + '</h5>' +
                    '<small style="color: #888; font-size: 0.78rem;">' + deck.total + ' card' + (deck.total !== 1 ? 's' : '') + '</small>' +
                '</div>' +
                '<div class="d-flex gap-2 align-items-center">' +
                    dueBadge + newBadge + emptyLabel +
                '</div>' +
            '</div>';
        card.addEventListener('mouseenter', function() { card.style.backgroundColor = '#35324a'; });
        card.addEventListener('mouseleave', function() { card.style.backgroundColor = '#2d2a3e'; });
        card.addEventListener('click', function(e) {
            e.preventDefault();
            showDeckDetails(deck);
        });
        frag.appendChild(card);
    });
    container.appendChild(frag);
}

function showCreateCard(deckId) {
    createCardPreselectedDeckId = (deckId !== undefined) ? deckId : null;
    showView('create-card');
}

function createDeck() {
    var name = document.getElementById('deck-name').value.trim();
    var description = document.getElementById('deck-description').value.trim();
    if (name === '') {
        showAlert('Please enter a deck name.');
        return;
    }
    if (bridge) {
        bridge.createDeck(name, description);
        document.getElementById('deck-name').value = '';
        document.getElementById('deck-description').value = '';
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
    var description = document.getElementById('settings-deck-description-input').value.trim();
    var limit = parseInt(document.getElementById('settings-new-cards-limit').value, 10);
    if (isNaN(limit) || limit < 0) { showAlert('Please enter a valid number.'); return; }
    var learningSteps = document.getElementById('settings-learning-steps').value.trim();
    var relearningSteps = document.getElementById('settings-relearning-steps').value.trim();
    var studyOrder = document.getElementById('settings-study-order').value || 'new_first';
    var answerDisplay = document.getElementById('settings-answer-display').value || 'replace';
    bridge.saveDeckSettings(currentDeckForDetails.id, name, description, limit, learningSteps, relearningSteps, studyOrder, answerDisplay);
    currentDeckForDetails.name = name;
    currentDeckForDetails.description = description;
    currentDeckForDetails.new_cards_limit = limit;
    currentDeckForDetails.learning_steps = learningSteps;
    currentDeckForDetails.relearning_steps = relearningSteps;
    currentDeckForDetails.study_order = studyOrder;
    currentDeckForDetails.answer_display = answerDisplay;
    showDeckDetails(currentDeckForDetails);
}

var reviewQueue = [];
var learningQueue = []; // [{card, showAfter (ms timestamp)}] — time-gated cards waiting to return
var currentCardIndex = 0;
var currentCard = null;
var currentCardFromLearning = false;
var currentDeckIdForReview = null;
var currentDeckLearningSteps = [];
var currentDeckRelearnSteps = [];
var currentDeckAnswerDisplay = 'replace';
var mediaBaseUrl = '';

function startReview(deckId) {
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
    reviewQueue = data.cards || [];
    learningQueue = [];
    currentCardIndex = 0;
    currentCardFromLearning = false;
    document.getElementById('review-card-section').style.display = 'block';
    document.getElementById('review-action-bar').style.display = 'flex';
    document.getElementById('review-complete-section').style.display = 'none';
    showView('review');
    if (reviewQueue.length === 0) {
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
    // Conditional blocks: {{#Field}}...{{/Field}}
    result = result.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function(match, key, content) {
        key = key.trim();
        return (fields[key] && fields[key].trim()) ? content : '';
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
    var hasRegular = currentCardIndex < reviewQueue.length;

    if (!hasRegular && learningQueue.length === 0) {
        showReviewComplete();
        return;
    }

    // Find learning cards whose timer has elapsed
    var overdue = learningQueue.filter(function(item) { return item.showAfter <= now; });
    overdue.sort(function(a, b) { return a.showAfter - b.showAfter; });

    if (!hasRegular) {
        // All regular cards done — show the earliest pending learning card (timer may not be up yet)
        learningQueue.sort(function(a, b) { return a.showAfter - b.showAfter; });
        var item = learningQueue.shift();
        currentCard = item.card;
        currentCardFromLearning = true;
    } else if (overdue.length > 0) {
        // A learning card's timer has elapsed — interleave it now (mirrors Anki behaviour)
        var item = overdue[0];
        learningQueue = learningQueue.filter(function(i) { return i !== item; });
        currentCard = item.card;
        currentCardFromLearning = true;
    } else {
        // Timer hasn't fired for any learning card — show next regular card
        currentCard = reviewQueue[currentCardIndex];
        currentCardFromLearning = false;
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

    // Advance the regular-queue pointer only when the card being rated came from there
    if (!currentCardFromLearning) {
        currentCardIndex++;
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
    var frag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        frag.appendChild(opt);
    });
    select.appendChild(frag);
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
    var deckFrag = document.createDocumentFragment();
    decks.forEach(function(deck) {
        var opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        deckFrag.appendChild(opt);
    });
    deckSelect.appendChild(deckFrag);
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

function renderEditCardFields(typeId, existingFields) {
    var container = document.getElementById('edit-card-fields-container');
    if (!container) return;

    // If called from onchange (no existingFields), preserve current textarea values
    if (!existingFields) {
        existingFields = {};
        document.querySelectorAll('.edit-card-field-input').forEach(function(ta) {
            existingFields[ta.getAttribute('data-field')] = ta.value;
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
                '<textarea class="form-control settings-input edit-card-field-input" data-field="' + rf.name +
                '" placeholder="Enter ' + rf.name +
                '" style="height:100px;"></textarea>' +
                '<div class="mt-1 d-flex gap-2">' +
                '<button type="button" class="btn btn-dark btn-sm" data-field="' + rf.name + '" data-media="image" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">📷 Image</button>' +
                '<button type="button" class="btn btn-dark btn-sm" data-field="' + rf.name + '" data-media="audio" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">🔊 Audio</button>' +
                '</div>';
            rawCardBody.appendChild(wrapper);
            wrapper.querySelector('textarea').value = rf.value;
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
            '<textarea class="form-control settings-input edit-card-field-input" data-field="' + fieldName +
            '" placeholder="Enter ' + fieldName +
            '" style="height:100px;"></textarea>' +
            '<div class="mt-1 d-flex gap-2">' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="image" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">📷 Image</button>' +
            '<button type="button" class="btn btn-dark btn-sm" data-field="' + fieldName + '" data-media="audio" onclick="attachEditMedia(this)" style="background-color:#2d2a3e;font-size:0.8rem;">🔊 Audio</button>' +
            '</div>';
        cardBody.appendChild(wrapper);
        var ta = wrapper.querySelector('textarea');
        if (existingFields && existingFields[fieldName] !== undefined) {
            ta.value = existingFields[fieldName];
        }
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
            var ta = document.querySelector('.edit-card-field-input[data-field="' + fieldName + '"]');
            if (ta) {
                if (ta.value && !ta.value.endsWith('\n')) ta.value += '\n';
                ta.value += result;
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
    document.querySelectorAll('.edit-card-field-input').forEach(function(ta) {
        fieldsObj[ta.getAttribute('data-field')] = ta.value.trim();
        if (ta.value.trim()) hasContent = true;
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
