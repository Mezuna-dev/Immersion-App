// In-process Yomitan backend (Phase 5).
//
// Runs in the page's main world as an ES module. Instantiates Yomitan's own
// DictionaryDatabase, DictionaryImporter, and Translator classes and wires
// them to the chrome.runtime.sendMessage actions that Yomitan's content
// script calls (via the shim's handler registry).
//
// IndexedDB persists across runs, so the (slow) import only fires on first
// launch. Dictionary ZIPs live in  data/dicts/  and are served via
// immersion://data/.
//
// Race-safety: handlers must be registered SYNCHRONOUSLY at module top,
// before any top-level await. Otherwise content-script-main.js (loaded
// from the bootstrap's backend.onload) can race our TLA and hit the shim's
// "unhandled" fallback for optionsGet, returning undefined and crashing
// Frontend._updateOptionsInternal. Handlers close over a mutable state
// object and internally await `ready` for data that isn't available yet.
//
// Extend as new actions surface in the [chrome-probe] demand list.

import {OptionsUtil} from 'immersion://yomitan/js/data/options-util.js';
import {DictionaryDatabase} from 'immersion://yomitan/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from 'immersion://yomitan/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from 'immersion://yomitan/js/dictionary/dictionary-importer-media-loader.js';
import {Translator} from 'immersion://yomitan/js/language/translator.js';

const api = window.__immersionYomitan;
if (!api) {
    throw new Error('[yomitan-backend] yomitan-shim.js must load first');
}

const log = (msg) => { console.error('[yomitan-backend] ' + msg); };

// ── Mutable state ────────────────────────────────────────────────────────────
// optionsFull / defaultProfileOptions are set once optionsUtil finishes;
// after that, their properties (e.g. .dictionaries, .general.mainDictionary)
// are mutated in place so Frontend's cached reference sees updates.
/** @type {object|null} */           let optionsFull = null;
/** @type {object|null} */           let defaultProfileOptions = null;
/** @type {Translator|null} */       let translator = null;
/** @type {{title: string}[]} */     let dictionarySummaries = [];

let resolveOptionsReady;
const optionsReady = new Promise((resolve) => { resolveOptionsReady = resolve; });

// ── Register handlers SYNCHRONOUSLY, before any await ────────────────────────
// Frontend.prepare() awaits optionsGet; our handler awaits optionsReady.
api.registerHandler('optionsGetFull', async () => {
    await optionsReady;
    return optionsFull;
});
api.registerHandler('optionsGet', async () => {
    await optionsReady;
    return defaultProfileOptions;
});
api.registerHandler('getDictionaryInfo', async () => dictionarySummaries);
api.registerHandler('getDefaultAnkiFieldTemplates', async () => '');
api.registerHandler('isAnkiConnected', async () => false);
api.registerHandler('getZoom', async () => ({zoomFactor: 1}));
api.registerHandler('getStylesheetContent', async (params) => {
    const {url} = params || {};
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')
        || !url.endsWith('.css')) {
        throw new Error('Invalid URL');
    }
    const res = await fetch('immersion://yomitan' + url);
    if (!res.ok) { throw new Error('fetch failed: ' + res.status); }
    return await res.text();
});

const getEnabledDictionaryMap = (options) => {
    const enabledDictionaryMap = new Map();
    for (const dictionary of options.dictionaries) {
        if (!dictionary.enabled) { continue; }
        const {name, alias, allowSecondarySearches, partsOfSpeechFilter, useDeinflections} = dictionary;
        enabledDictionaryMap.set(name, {
            index: enabledDictionaryMap.size,
            alias,
            allowSecondarySearches,
            partsOfSpeechFilter,
            useDeinflections,
        });
    }
    return enabledDictionaryMap;
};

const buildFindTermsOptions = (mode, details) => {
    const options = defaultProfileOptions;
    const d = details || {};
    const matchType = typeof d.matchType === 'string' ? d.matchType : 'exact';
    const deinflect = typeof d.deinflect === 'boolean' ? d.deinflect : true;
    const primaryReading = typeof d.primaryReading === 'string' ? d.primaryReading : '';
    const enabledDictionaryMap = getEnabledDictionaryMap(options);
    const {mainDictionary, sortFrequencyDictionary, sortFrequencyDictionaryOrder, language} = options.general;
    const {alphanumeric} = options.scanning;
    const {searchResolution} = options.translation;
    let excludeDictionaryDefinitions = null;
    if (mode === 'merge' && !enabledDictionaryMap.has(mainDictionary)) {
        enabledDictionaryMap.set(mainDictionary, {
            index: enabledDictionaryMap.size,
            alias: mainDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        });
        excludeDictionaryDefinitions = new Set();
        excludeDictionaryDefinitions.add(mainDictionary);
    }
    return {
        matchType,
        deinflect,
        primaryReading,
        mainDictionary,
        sortFrequencyDictionary,
        sortFrequencyDictionaryOrder,
        removeNonJapaneseCharacters: !alphanumeric,
        searchResolution,
        textReplacements: [null],
        enabledDictionaryMap,
        excludeDictionaryDefinitions,
        language,
        useAllFrequencyDictionaries: false,
    };
};

const buildFindKanjiOptions = () => ({
    enabledDictionaryMap: getEnabledDictionaryMap(defaultProfileOptions),
    removeNonJapaneseCharacters: !defaultProfileOptions.scanning.alphanumeric,
});

api.registerHandler('termsFind', async (params) => {
    if (translator === null || defaultProfileOptions === null) {
        return {dictionaryEntries: [], originalTextLength: 0};
    }
    const {text, details} = params || {};
    const mode = defaultProfileOptions.general.resultOutputMode;
    const maxResults = defaultProfileOptions.general.maxResults;
    const findTermsOptions = buildFindTermsOptions(mode, details);
    const {dictionaryEntries, originalTextLength} =
        await translator.findTerms(mode, text, findTermsOptions);
    dictionaryEntries.splice(maxResults);
    return {dictionaryEntries, originalTextLength};
});

api.registerHandler('kanjiFind', async (params) => {
    if (translator === null || defaultProfileOptions === null) { return []; }
    const {text} = params || {};
    const maxResults = defaultProfileOptions.general.maxResults;
    const findKanjiOptions = buildFindKanjiOptions();
    const dictionaryEntries = await translator.findKanji(text, findKanjiOptions);
    dictionaryEntries.splice(maxResults);
    return dictionaryEntries;
});

log('handlers registered (options not yet ready; optionsGet will await)');

// ── Async setup ──────────────────────────────────────────────────────────────
const optionsUtil = new OptionsUtil();
await optionsUtil.prepare();
optionsFull = optionsUtil.getDefault();
defaultProfileOptions = optionsFull.profiles[0].options;
// Hover-only scanning: Yomitan's default mouse input requires Shift held.
// For an immersion reader, plain hover should pop up the dictionary.
defaultProfileOptions.scanning.inputs = [{
    include: '',
    exclude: '',
    types: {mouse: true, touch: true, pen: true},
    options: {
        showAdvanced: false,
        searchTerms: true,
        searchKanji: true,
        scanOnTouchTap: true,
        scanOnTouchMove: false,
        scanOnTouchPress: false,
        scanOnTouchRelease: false,
        scanOnPenMove: true,
        scanOnPenHover: false,
        scanOnPenReleaseHover: false,
        scanOnPenPress: true,
        scanOnPenRelease: false,
        preventTouchScrolling: false,
        preventPenScrolling: false,
        minimumTouchTime: 0,
    },
}];
resolveOptionsReady();
log('options prepared');

// Open the IndexedDB-backed dictionary database.
const database = new DictionaryDatabase();
await database.prepare();
log('DictionaryDatabase prepared');

// Import any ZIPs in data/dicts/ on first launch. IndexedDB persists
// across runs; if anything is already imported, skip.
dictionarySummaries = await database.getDictionaryInfo();
log('existing imported dictionaries: ' + dictionarySummaries.length);

if (dictionarySummaries.length === 0) {
    try {
        const listRes = await fetch('immersion:///dict-zips');
        const zipNames = await listRes.json();
        log('found ' + zipNames.length + ' zip(s) to import: ' + zipNames.join(', '));

        const mediaLoader = new DictionaryImporterMediaLoader();
        for (const name of zipNames) {
            const importer = new DictionaryImporter(mediaLoader, (progress) => {
                if (progress.nextStep
                    || (progress.count > 0
                        && Math.floor(progress.index / progress.count * 10)
                           !== Math.floor((progress.index - 1) / progress.count * 10))) {
                    log(name + ' progress: '
                        + Math.floor(progress.index / Math.max(progress.count, 1) * 100)
                        + '%');
                }
            });
            const t0 = performance.now();
            log('importing ' + name + '…');
            const archiveRes = await fetch('immersion://data/' + name);
            const archive = await archiveRes.arrayBuffer();
            const {result, errors} = await importer.importDictionary(
                database,
                archive,
                {prefixWildcardsSupported: true, yomitanVersion: '0.0.0.0'},
            );
            const dt = ((performance.now() - t0) / 1000).toFixed(1);
            if (errors.length > 0) {
                log(name + ' import errors: ' + errors.length
                    + ' (first: ' + (errors[0] && errors[0].message) + ')');
            }
            log(name + ' imported as "' + (result && result.title) + '" in ' + dt + 's');
        }

        dictionarySummaries = await database.getDictionaryInfo();
    } catch (e) {
        log('dictionary import failed: ' + (e && (e.stack || e.message || e)));
    }
}

// Populate profile options with every imported dictionary. Mutating the
// same defaultProfileOptions object that Frontend already holds a reference
// to — subsequent termsFind calls see the updated dictionaries.
const translatorDictionaries = [];
let mainDictionaryTitle = '';
let sortFrequencyDictionaryTitle = null;
for (const summary of dictionarySummaries) {
    translatorDictionaries.push({
        name: summary.title,
        alias: summary.title,
        enabled: true,
        allowSecondarySearches: false,
        definitionsCollapsible: 'not-collapsible',
        partsOfSpeechFilter: true,
        useDeinflections: true,
        styles: summary.styles || '',
    });
    if (mainDictionaryTitle === '' && summary.sequenced) {
        mainDictionaryTitle = summary.title;
    }
    if (sortFrequencyDictionaryTitle === null
        && typeof summary.frequencyMode === 'string') {
        sortFrequencyDictionaryTitle = summary.title;
    }
}
defaultProfileOptions.dictionaries = translatorDictionaries;
defaultProfileOptions.general.mainDictionary = mainDictionaryTitle;
defaultProfileOptions.general.sortFrequencyDictionary = sortFrequencyDictionaryTitle;
log('profile options wired — main=' + JSON.stringify(mainDictionaryTitle)
    + ', sortFrequency=' + JSON.stringify(sortFrequencyDictionaryTitle)
    + ', dicts=' + translatorDictionaries.length);

// Instantiate the translator — after this, lookups return real data.
translator = new Translator(database);
translator.prepare();
log('Translator prepared — findTerms/kanji now return real results');

// Signal the parent tab that the backend iframe is fully initialized.
// The bootstrap is awaiting this before injecting content-script-main.js;
// injecting earlier races the handler registry (Frontend.prepare calls
// optionsGet, which would return undefined and crash _updateOptionsInternal).
try {
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({type: 'immersion-backend-ready'}, '*');
        log('sent immersion-backend-ready to parent');
    }
} catch (e) {
    log('failed to signal backend-ready: ' + ((e && e.message) || e));
}
