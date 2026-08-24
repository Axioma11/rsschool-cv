/**
 * Prompt Block Library — a SillyTavern extension.
 *
 * Lets you look at the prompt blocks of any Chat Completion preset without
 * switching to it, keep the ones you reuse in a tagged library, and copy any
 * number of blocks into any number of presets in one go.
 */

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { oai_settings, promptManager } from '../../../openai.js';
import { getPresetManager } from '../../../preset-manager.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { getCurrentLocale } from '../../../i18n.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { download, uuidv4 } from '../../../utils.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const MODULE_NAME = 'promptBlockLibrary';
const DUMMY_CHARACTER_ID = 100001;
const LEGACY_CHARACTER_ID = 100000;
/** Sentinel value used in the source dropdown for the library itself. */
const LIBRARY_SOURCE = '@@library';

const defaultSettings = {
    /** @type {LibraryEntry[]} */
    library: [],
    /** Blocks with less content than this are treated as separators and hidden by default. */
    junkThreshold: 20,
    hideJunk: true,
    lastSource: LIBRARY_SOURCE,
};

/**
 * @typedef {object} LibraryEntry
 * @property {string} id
 * @property {string[]} tags
 * @property {string} sourcePreset
 * @property {number} addedAt
 * @property {object} prompt
 */

/**
 * @typedef {object} BlockItem
 * @property {string} key Unique key across all sources.
 * @property {string} source Preset name, or LIBRARY_SOURCE.
 * @property {object} prompt Raw prompt object (not cloned — clone before writing).
 * @property {boolean} attached Whether the block sits in the preset's prompt list.
 * @property {boolean} enabled Whether the block is toggled on in the preset.
 * @property {string[]} tags Library tags, empty for preset blocks.
 * @property {string} [libraryId] Library entry id, for library items.
 */

// #region Localization

const STRINGS = {
    en: {
        title: 'Prompt Block Library',
        library: 'Library',
        currentSuffix: ' (current)',
        search: 'Search by name or text',
        hideJunk: 'Hide empty',
        selectAll: 'Select all',
        clear: 'Clear',
        selected: 'Selected: {0}',
        transfer: 'To presets',
        transferConfirm: 'Copy',
        toLibrary: 'To library',
        more: 'More',
        close: 'Close',
        cancel: 'Cancel',
        nothingSelected: 'Nothing selected.',
        emptyList: 'Nothing here.',
        pickTargets: 'Copy {0} block(s) to:',
        noTargets: 'No presets selected.',
        conflictTitle: 'Names already taken',
        conflictHint: 'These presets already have a block with the same name. Edit the names, or drop the ones you do not need.',
        skip: 'Skip',
        transferDone: 'Copied {0} block(s) into {1} preset(s).',
        addedToLibrary: 'Added to library: {0}',
        alreadyInLibrary: 'Already in the library.',
        removeFromLibrary: 'Remove from library',
        removed: 'Removed: {0}',
        editTags: 'Edit tags',
        tagsPrompt: 'Tags, comma separated:',
        exportLibrary: 'Export library',
        importLibrary: 'Import library',
        importMerge: 'Add to current',
        importReplace: 'Replace',
        importHint: 'Add the imported blocks to the current library, or replace it?',
        imported: 'Imported: {0}',
        badFile: 'Not a library file.',
        settings: 'Settings',
        junkThreshold: 'Treat blocks shorter than N characters as separators:',
        detached: 'detached',
        off: 'off',
        inChat: 'in-chat @ {0}',
        noPresets: 'No Chat Completion presets found. Switch to a Chat Completion API first.',
        starTitle: 'Add block to the library',
        tokens: '{0} tok',
        allTags: 'All',
        libraryEmpty: 'The library is empty. Pick any preset above, tick the blocks you need and press "To library".',
        libraryOnly: 'Library blocks only.',
        transferFailed: 'Could not copy the blocks. Check the server connection.',
    },
    ru: {
        title: 'Библиотека блоков промпта',
        library: 'Библиотека',
        currentSuffix: ' (текущий)',
        search: 'Поиск по названию или тексту',
        hideJunk: 'Скрыть пустые',
        selectAll: 'Выбрать все',
        clear: 'Снять',
        selected: 'Выбрано: {0}',
        transfer: 'В пресеты',
        transferConfirm: 'Перенести',
        toLibrary: 'В библиотеку',
        more: 'Ещё',
        close: 'Закрыть',
        cancel: 'Отмена',
        nothingSelected: 'Ничего не выбрано.',
        emptyList: 'Здесь пусто.',
        pickTargets: 'Перенести блоков: {0}. Куда:',
        noTargets: 'Не выбрано ни одного пресета.',
        conflictTitle: 'Имена уже заняты',
        conflictHint: 'В этих пресетах уже есть блок с таким названием. Поправь имена или убери лишние.',
        skip: 'Пропустить',
        transferDone: 'Перенесено блоков: {0}, в пресетов: {1}.',
        addedToLibrary: 'Добавлено в библиотеку: {0}',
        alreadyInLibrary: 'Уже в библиотеке.',
        removeFromLibrary: 'Удалить из библиотеки',
        removed: 'Удалено: {0}',
        editTags: 'Изменить теги',
        tagsPrompt: 'Теги через запятую:',
        exportLibrary: 'Экспорт библиотеки',
        importLibrary: 'Импорт библиотеки',
        importMerge: 'Добавить к текущей',
        importReplace: 'Заменить',
        importHint: 'Добавить импортируемые блоки к текущей библиотеке или заменить её?',
        imported: 'Импортировано: {0}',
        badFile: 'Это не файл библиотеки.',
        settings: 'Настройки',
        junkThreshold: 'Считать блоки короче N символов разделителями:',
        detached: 'откреплён',
        off: 'выкл',
        inChat: 'в чат @ {0}',
        noPresets: 'Пресеты Chat Completion не найдены. Сначала переключись на Chat Completion API.',
        starTitle: 'Добавить блок в библиотеку',
        tokens: '{0} ток.',
        allTags: 'Все',
        libraryEmpty: 'Библиотека пуста. Выбери сверху любой пресет, отметь нужные блоки и нажми «В библиотеку».',
        libraryOnly: 'Только для блоков из библиотеки.',
        transferFailed: 'Не удалось перенести блоки. Проверь связь с сервером.',
    },
};

const lang = String(getCurrentLocale() || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';

/**
 * Localized string with positional {0} placeholders.
 * @param {string} key
 * @param {...(string|number)} args
 * @returns {string}
 */
function t(key, ...args) {
    let value = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
    args.forEach((arg, i) => { value = value.split(`{${i}}`).join(String(arg)); });
    return value;
}

// #endregion

// #region Settings

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = extension_settings[MODULE_NAME];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(value);
        }
    }
    if (!Array.isArray(settings.library)) {
        settings.library = [];
    }
    return settings;
}

function saveSettings() {
    saveSettingsDebounced();
}

// #endregion

// #region Preset access

function activePresetName() {
    return oai_settings?.preset_settings_openai ?? '';
}

/**
 * All Chat Completion presets, in the order the dropdown shows them.
 * @returns {{name: string, index: number, settings: object}[]}
 */
function listPresets() {
    const manager = getPresetManager('openai');
    if (!manager) {
        return [];
    }
    const { presets, preset_names } = manager.getPresetList('openai');
    const pairs = Array.isArray(preset_names)
        ? preset_names.map((name, index) => ({ name, index }))
        : Object.entries(preset_names).map(([name, index]) => ({ name, index: Number(index) }));
    return pairs
        .map(({ name, index }) => ({ name, index, settings: presets[index] }))
        .filter(preset => preset.settings && typeof preset.settings === 'object');
}

/**
 * The settings object to read blocks from. The active preset is read live, so
 * that unsaved edits are visible too.
 * @param {string} name
 * @returns {object|null}
 */
function readableSettings(name) {
    if (name === activePresetName()) {
        return oai_settings;
    }
    return listPresets().find(preset => preset.name === name)?.settings ?? null;
}

/**
 * Every settings object that has to receive a new block for the given preset.
 * For the active preset that is both the live settings (so the change shows up
 * right away) and the stored preset (so it survives a preset switch).
 * @param {string} name
 * @returns {object[]}
 */
function writableSettings(name) {
    const stored = listPresets().find(preset => preset.name === name)?.settings ?? null;
    if (name === activePresetName()) {
        return [oai_settings, stored].filter(Boolean);
    }
    return [stored].filter(Boolean);
}

/**
 * The prompt order array of a preset, creating it when missing.
 * @param {object} settings
 * @param {boolean} create
 * @returns {{identifier: string, enabled: boolean}[]}
 */
function getOrder(settings, create = false) {
    if (!Array.isArray(settings.prompt_order)) {
        if (!create) {
            return [];
        }
        settings.prompt_order = [];
    }

    // The prompt manager keeps the global order under the dummy character id.
    // Presets written by older versions may only carry the legacy id instead.
    let entry = settings.prompt_order.find(item => String(item?.character_id) === String(DUMMY_CHARACTER_ID))
        ?? settings.prompt_order.find(item => String(item?.character_id) === String(LEGACY_CHARACTER_ID));

    if (!entry) {
        if (!create) {
            return [];
        }
        // Seeding the new list with what the preset already holds keeps its own
        // blocks in the list — an empty list would make SillyTavern skip its
        // "no order yet" fallback and quietly drop them.
        entry = {
            character_id: DUMMY_CHARACTER_ID,
            order: (settings.prompts ?? [])
                .filter(prompt => prompt?.identifier)
                .map(prompt => ({ identifier: prompt.identifier, enabled: true })),
        };
        settings.prompt_order.push(entry);
    }

    if (!Array.isArray(entry.order)) {
        entry.order = [];
    }
    return entry.order;
}

/**
 * Transferable blocks of a preset. Markers (Chat History, World Info, …) are
 * placeholders that mean nothing outside their own preset, so they are left out.
 * @param {string} presetName
 * @returns {BlockItem[]}
 */
function readPresetBlocks(presetName) {
    const settings = readableSettings(presetName);
    if (!settings || !Array.isArray(settings.prompts)) {
        return [];
    }
    const order = getOrder(settings);
    return settings.prompts
        .filter(prompt => prompt && !prompt.marker && prompt.identifier)
        .map(prompt => {
            const index = order.findIndex(entry => entry?.identifier === prompt.identifier);
            return {
                key: `${presetName}${prompt.identifier}`,
                source: presetName,
                prompt,
                attached: index !== -1,
                enabled: index !== -1 ? !!order[index].enabled : false,
                tags: [],
            };
        });
}

/** @returns {BlockItem[]} */
function readLibraryBlocks() {
    return getSettings().library.map(entry => ({
        key: `${LIBRARY_SOURCE}${entry.id}`,
        source: LIBRARY_SOURCE,
        prompt: entry.prompt,
        attached: true,
        enabled: true,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        libraryId: entry.id,
    }));
}

/**
 * A clean copy of a prompt, ready to be dropped into another preset. Everything
 * that describes the block travels with it — text, role, injection position,
 * depth, order, triggers, override flag — only the identity is reset.
 * @param {object} prompt
 * @param {string} name
 * @returns {object}
 */
function clonePrompt(prompt, name) {
    const copy = structuredClone(prompt);
    delete copy.extension;
    return {
        ...copy,
        identifier: uuidv4(),
        name: name,
        system_prompt: false,
        marker: false,
        enabled: true,
    };
}

function isJunk(prompt) {
    return String(prompt?.content ?? '').trim().length < getSettings().junkThreshold;
}

/**
 * A name that is free in the given set, adding a numeric suffix when needed.
 * @param {string} name
 * @param {Set<string>} taken
 * @returns {string}
 */
function uniqueName(name, taken) {
    if (!taken.has(name)) {
        return name;
    }
    let counter = 2;
    while (taken.has(`${name} (${counter})`)) {
        counter++;
    }
    return `${name} (${counter})`;
}

// #endregion

// #region Library

/**
 * @param {BlockItem[]} items
 * @returns {number} How many entries were actually added.
 */
function addToLibrary(items) {
    const settings = getSettings();
    let added = 0;
    for (const item of items) {
        const content = String(item.prompt?.content ?? '');
        const duplicate = settings.library.some(entry =>
            entry.prompt?.name === item.prompt?.name && String(entry.prompt?.content ?? '') === content);
        if (duplicate) {
            continue;
        }
        settings.library.push({
            id: uuidv4(),
            tags: [...(item.tags ?? [])],
            sourcePreset: item.source === LIBRARY_SOURCE ? '' : item.source,
            addedAt: Date.now(),
            prompt: structuredClone(item.prompt),
        });
        added++;
    }
    if (added) {
        saveSettings();
    }
    return added;
}

/**
 * @param {string[]} ids
 * @returns {number}
 */
function removeFromLibrary(ids) {
    const settings = getSettings();
    const before = settings.library.length;
    settings.library = settings.library.filter(entry => !ids.includes(entry.id));
    const removed = before - settings.library.length;
    if (removed) {
        saveSettings();
    }
    return removed;
}

function allLibraryTags() {
    const tags = new Set();
    for (const entry of getSettings().library) {
        for (const tag of entry.tags ?? []) {
            tags.add(tag);
        }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
}

// #endregion

// #region Transfer

/**
 * Writes the prepared blocks into their target presets and persists everything.
 * @param {{target: string, item: BlockItem, name: string}[]} plan
 * @returns {Promise<{blocks: number, presets: number}>}
 */
async function applyTransfer(plan) {
    const manager = getPresetManager('openai');
    if (!manager) {
        throw new Error('Chat Completion preset manager is not available');
    }
    const targets = [...new Set(plan.map(entry => entry.target))];
    let blocks = 0;
    let touchedActive = false;

    for (const target of targets) {
        const destinations = writableSettings(target);
        if (!destinations.length) {
            console.warn(`[${MODULE_NAME}] preset not found: ${target}`);
            continue;
        }

        for (const entry of plan.filter(item => item.target === target)) {
            // One prompt object per target, shared by the live and the stored copy,
            // so both sides carry the same identifier.
            const prompt = clonePrompt(entry.item.prompt, entry.name);
            for (const settings of destinations) {
                if (!Array.isArray(settings.prompts)) {
                    settings.prompts = [];
                }
                settings.prompts.push(structuredClone(prompt));
                getOrder(settings, true).push({ identifier: prompt.identifier, enabled: true });
            }
            blocks++;
        }

        if (target === activePresetName()) {
            touchedActive = true;
        }

        const stored = listPresets().find(preset => preset.name === target)?.settings;
        if (stored) {
            await manager.savePreset(target, stored, { skipUpdate: true });
        }
    }

    if (touchedActive) {
        await promptManager?.saveServiceSettings?.();
        promptManager?.render?.();
    }

    return { blocks, presets: targets.length };
}

/**
 * Asks which presets the selected blocks should go to.
 * @param {number} count
 * @returns {Promise<string[]|null>}
 */
async function pickTargets(count) {
    const presets = listPresets();
    if (!presets.length) {
        toastr.warning(t('noPresets'));
        return null;
    }

    const root = document.createElement('div');
    root.classList.add('pbl-targets');

    const title = document.createElement('div');
    title.classList.add('pbl-targets-title');
    title.textContent = t('pickTargets', count);
    root.append(title);

    const active = activePresetName();
    const list = document.createElement('div');
    list.classList.add('pbl-targets-list');
    for (const preset of presets) {
        const label = document.createElement('label');
        label.classList.add('pbl-target');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = preset.name;
        const text = document.createElement('span');
        text.textContent = preset.name + (preset.name === active ? t('currentSuffix') : '');
        label.append(box, text);
        list.append(label);
    }
    root.append(list);

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('transferConfirm'),
        cancelButton: t('cancel'),
        allowVerticalScrolling: true,
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const selected = [...list.querySelectorAll('input:checked')].map(box => box.value);
    if (!selected.length) {
        toastr.info(t('noTargets'));
        return null;
    }
    return selected;
}

/**
 * Lets the user rename blocks whose names are already taken in a target preset.
 * @param {{target: string, item: BlockItem, name: string, skip?: boolean}[]} conflicts
 * @returns {Promise<boolean>} False when the user cancelled.
 */
async function resolveConflicts(conflicts) {
    const root = document.createElement('div');
    root.classList.add('pbl-conflicts');

    const hint = document.createElement('div');
    hint.classList.add('pbl-hint');
    hint.textContent = t('conflictHint');
    root.append(hint);

    for (const conflict of conflicts) {
        const row = document.createElement('div');
        row.classList.add('pbl-conflict');

        const where = document.createElement('div');
        where.classList.add('pbl-conflict-target');
        where.textContent = conflict.target;

        const input = document.createElement('input');
        input.type = 'text';
        input.classList.add('text_pole', 'pbl-conflict-name');
        input.value = conflict.name;
        input.addEventListener('input', () => { conflict.name = input.value.trim(); });

        const skip = document.createElement('label');
        skip.classList.add('pbl-conflict-skip');
        const skipBox = document.createElement('input');
        skipBox.type = 'checkbox';
        skipBox.addEventListener('change', () => {
            conflict.skip = skipBox.checked;
            row.classList.toggle('pbl-skipped', skipBox.checked);
        });
        const skipText = document.createElement('span');
        skipText.textContent = t('skip');
        skip.append(skipBox, skipText);

        row.append(where, input, skip);
        root.append(row);
    }

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('transferConfirm'),
        cancelButton: t('cancel'),
        allowVerticalScrolling: true,
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

/**
 * Full copy flow: pick targets, resolve name clashes, write, report.
 * @param {BlockItem[]} items
 * @returns {Promise<boolean>} True when something was copied.
 */
async function transferBlocks(items) {
    if (!items.length) {
        toastr.info(t('nothingSelected'));
        return false;
    }

    const targets = await pickTargets(items.length);
    if (!targets) {
        return false;
    }

    /** @type {{target: string, item: BlockItem, name: string, skip?: boolean}[]} */
    const plan = [];
    /** @type {typeof plan} */
    const conflicts = [];

    for (const target of targets) {
        const settings = readableSettings(target);
        const taken = new Set((settings?.prompts ?? []).map(prompt => prompt?.name).filter(Boolean));
        for (const item of items) {
            const original = String(item.prompt?.name ?? '').trim() || 'Prompt';
            const clash = taken.has(original);
            const name = uniqueName(original, taken);
            taken.add(name);
            const entry = { target, item, name };
            plan.push(entry);
            if (clash) {
                conflicts.push(entry);
            }
        }
    }

    if (conflicts.length && !await resolveConflicts(conflicts)) {
        return false;
    }

    const effective = plan.filter(entry => !entry.skip && entry.name);
    if (!effective.length) {
        toastr.info(t('nothingSelected'));
        return false;
    }

    try {
        const { blocks, presets } = await applyTransfer(effective);
        toastr.success(t('transferDone', blocks, presets));
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] transfer failed`, error);
        toastr.error(t('transferFailed'));
        return false;
    }
}

// #endregion

// #region Import / export

function exportLibrary() {
    const settings = getSettings();
    const payload = {
        type: 'prompt-block-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        library: settings.library,
    };
    download(JSON.stringify(payload, null, 4), 'prompt-block-library.json', 'application/json');
}

async function importLibrary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    const file = await new Promise(resolve => {
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
        input.click();
    });
    if (!file) {
        return false;
    }

    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch (error) {
        console.error(`[${MODULE_NAME}] import failed`, error);
        toastr.error(t('badFile'));
        return false;
    }

    const incoming = Array.isArray(payload?.library) ? payload.library : null;
    if (!incoming) {
        toastr.error(t('badFile'));
        return false;
    }

    const replaceButton = { text: t('importReplace'), result: POPUP_RESULT.CUSTOM1 };
    const popup = new Popup(t('importHint'), POPUP_TYPE.CONFIRM, '', {
        okButton: t('importMerge'),
        cancelButton: t('cancel'),
        customButtons: [replaceButton],
    });
    const choice = await popup.show();
    if (choice !== POPUP_RESULT.AFFIRMATIVE && choice !== POPUP_RESULT.CUSTOM1) {
        return false;
    }

    const settings = getSettings();
    const sanitized = incoming
        .filter(entry => entry && typeof entry.prompt === 'object' && entry.prompt)
        .map(entry => ({
            id: uuidv4(),
            tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
            sourcePreset: String(entry.sourcePreset ?? ''),
            addedAt: Number(entry.addedAt) || Date.now(),
            prompt: entry.prompt,
        }));

    settings.library = choice === POPUP_RESULT.CUSTOM1 ? sanitized : [...settings.library, ...sanitized];
    saveSettings();
    toastr.success(t('imported', sanitized.length));
    return true;
}

// #endregion

// #region Main window

/** @type {Map<string, BlockItem>} Selection survives switching between sources. */
const selection = new Map();
/** @type {Map<string, number>} Token counts, keyed by content. */
const tokenCache = new Map();

function describeBlock(item) {
    const parts = [];
    const prompt = item.prompt;
    if (prompt.role && prompt.role !== 'system') {
        parts.push(prompt.role);
    }
    if (Number(prompt.injection_position) === 1) {
        parts.push(t('inChat', prompt.injection_depth ?? 4));
    }
    if (item.source !== LIBRARY_SOURCE) {
        if (!item.attached) {
            parts.push(t('detached'));
        } else if (!item.enabled) {
            parts.push(t('off'));
        }
    }
    return parts;
}

async function fillTokenCounts(listElement) {
    const pending = [...listElement.querySelectorAll('.pbl-tokens[data-pending="1"]')];
    for (const element of pending) {
        const content = element.dataset.content ?? '';
        element.dataset.pending = '0';
        if (!tokenCache.has(content)) {
            try {
                tokenCache.set(content, content ? await getTokenCountAsync(content) : 0);
            } catch (error) {
                console.debug(`[${MODULE_NAME}] token count failed`, error);
                tokenCache.set(content, 0);
            }
        }
        element.textContent = t('tokens', tokenCache.get(content));
    }
}

function openMainWindow() {
    const settings = getSettings();
    const presets = listPresets();
    if (!presets.length) {
        toastr.warning(t('noPresets'));
        return;
    }

    selection.clear();
    let tagFilter = '';

    const root = document.createElement('div');
    root.classList.add('pbl-root');

    // --- toolbar -----------------------------------------------------------
    const toolbar = document.createElement('div');
    toolbar.classList.add('pbl-toolbar');

    const sourceSelect = document.createElement('select');
    sourceSelect.classList.add('text_pole', 'pbl-source');
    const libraryOption = document.createElement('option');
    libraryOption.value = LIBRARY_SOURCE;
    libraryOption.textContent = `★ ${t('library')}`;
    sourceSelect.append(libraryOption);
    const active = activePresetName();
    for (const preset of presets) {
        const option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name + (preset.name === active ? t('currentSuffix') : '');
        sourceSelect.append(option);
    }
    const known = [LIBRARY_SOURCE, ...presets.map(preset => preset.name)];
    sourceSelect.value = known.includes(settings.lastSource) ? settings.lastSource : LIBRARY_SOURCE;

    const search = document.createElement('input');
    search.type = 'search';
    search.classList.add('text_pole', 'pbl-search');
    search.placeholder = t('search');

    const tagBar = document.createElement('div');
    tagBar.classList.add('pbl-tagbar');

    const options = document.createElement('div');
    options.classList.add('pbl-options');

    const junkLabel = document.createElement('label');
    junkLabel.classList.add('pbl-junk');
    const junkBox = document.createElement('input');
    junkBox.type = 'checkbox';
    junkBox.checked = !!settings.hideJunk;
    const junkText = document.createElement('span');
    junkText.textContent = t('hideJunk');
    junkLabel.append(junkBox, junkText);

    const selectAll = document.createElement('a');
    selectAll.classList.add('pbl-link');
    selectAll.textContent = t('selectAll');

    const clearAll = document.createElement('a');
    clearAll.classList.add('pbl-link');
    clearAll.textContent = t('clear');

    options.append(junkLabel, selectAll, clearAll);
    toolbar.append(sourceSelect, search, tagBar, options);

    // --- list --------------------------------------------------------------
    const list = document.createElement('ul');
    list.classList.add('pbl-list');

    // --- action bar --------------------------------------------------------
    const actions = document.createElement('div');
    actions.classList.add('pbl-actions');

    const info = document.createElement('div');
    info.classList.add('pbl-selinfo');

    const buttons = document.createElement('div');
    buttons.classList.add('pbl-buttons');

    const transferButton = document.createElement('div');
    transferButton.classList.add('menu_button', 'pbl-btn');
    transferButton.textContent = t('transfer');

    const libraryButton = document.createElement('div');
    libraryButton.classList.add('menu_button', 'pbl-btn');
    libraryButton.textContent = `★ ${t('toLibrary')}`;

    const moreButton = document.createElement('div');
    moreButton.classList.add('menu_button', 'pbl-btn', 'pbl-btn-more', 'fa-solid', 'fa-ellipsis');
    moreButton.title = t('more');

    buttons.append(transferButton, libraryButton, moreButton);
    actions.append(info, buttons);
    root.append(toolbar, list, actions);

    // --- rendering ---------------------------------------------------------
    function currentItems() {
        const source = sourceSelect.value;
        return source === LIBRARY_SOURCE ? readLibraryBlocks() : readPresetBlocks(source);
    }

    function updateInfo() {
        info.textContent = t('selected', selection.size);
    }

    function renderTagBar() {
        tagBar.innerHTML = '';
        if (sourceSelect.value !== LIBRARY_SOURCE) {
            tagBar.classList.add('pbl-hidden');
            return;
        }
        const tags = allLibraryTags();
        if (!tags.length) {
            tagBar.classList.add('pbl-hidden');
            return;
        }
        tagBar.classList.remove('pbl-hidden');
        for (const tag of ['', ...tags]) {
            const chip = document.createElement('span');
            chip.classList.add('pbl-chip');
            chip.classList.toggle('pbl-chip-active', tagFilter === tag);
            chip.textContent = tag || t('allTags');
            chip.addEventListener('click', () => {
                tagFilter = tag;
                renderTagBar();
                renderList();
            });
            tagBar.append(chip);
        }
    }

    function visibleItems() {
        const query = search.value.trim().toLowerCase();
        return currentItems().filter(item => {
            if (junkBox.checked && isJunk(item.prompt) && !selection.has(item.key)) {
                return false;
            }
            if (tagFilter && !item.tags.includes(tagFilter)) {
                return false;
            }
            if (!query) {
                return true;
            }
            const haystack = `${item.prompt?.name ?? ''}\n${item.prompt?.content ?? ''}`.toLowerCase();
            return haystack.includes(query);
        });
    }

    function renderList() {
        // Adding library entries to the library again makes no sense.
        libraryButton.classList.toggle('pbl-hidden', sourceSelect.value === LIBRARY_SOURCE);
        list.innerHTML = '';
        const items = visibleItems();

        if (!items.length) {
            const empty = document.createElement('li');
            empty.classList.add('pbl-empty');
            empty.textContent = sourceSelect.value === LIBRARY_SOURCE && !getSettings().library.length
                ? t('libraryEmpty')
                : t('emptyList');
            list.append(empty);
            updateInfo();
            return;
        }

        for (const item of items) {
            const row = document.createElement('li');
            row.classList.add('pbl-item');
            row.dataset.key = item.key;

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.classList.add('pbl-check');
            box.checked = selection.has(item.key);

            const main = document.createElement('div');
            main.classList.add('pbl-main');

            const name = document.createElement('div');
            name.classList.add('pbl-name');
            name.textContent = item.prompt?.name || '—';
            if (item.source !== LIBRARY_SOURCE && !item.enabled) {
                name.classList.add('pbl-dim');
            }

            const meta = document.createElement('div');
            meta.classList.add('pbl-meta');

            const tokens = document.createElement('span');
            tokens.classList.add('pbl-tokens');
            tokens.dataset.content = String(item.prompt?.content ?? '');
            const cached = tokenCache.get(tokens.dataset.content);
            if (cached === undefined) {
                tokens.dataset.pending = '1';
                tokens.textContent = '…';
            } else {
                tokens.textContent = t('tokens', cached);
            }
            meta.append(tokens);

            for (const part of describeBlock(item)) {
                const badge = document.createElement('span');
                badge.classList.add('pbl-badge');
                badge.textContent = part;
                meta.append(badge);
            }
            for (const tag of item.tags) {
                const badge = document.createElement('span');
                badge.classList.add('pbl-badge', 'pbl-badge-tag');
                badge.textContent = tag;
                meta.append(badge);
            }

            const preview = document.createElement('pre');
            preview.classList.add('pbl-preview', 'pbl-hidden');
            preview.textContent = String(item.prompt?.content ?? '');

            main.append(name, meta, preview);

            const rowActions = document.createElement('div');
            rowActions.classList.add('pbl-item-actions');

            const expand = document.createElement('div');
            expand.classList.add('fa-solid', 'fa-chevron-down', 'pbl-icon');
            expand.addEventListener('click', event => {
                event.stopPropagation();
                preview.classList.toggle('pbl-hidden');
                expand.classList.toggle('fa-chevron-down');
                expand.classList.toggle('fa-chevron-up');
            });
            rowActions.append(expand);

            row.append(box, main, rowActions);

            const toggle = () => {
                if (selection.has(item.key)) {
                    selection.delete(item.key);
                } else {
                    selection.set(item.key, item);
                }
                box.checked = selection.has(item.key);
                row.classList.toggle('pbl-selected', box.checked);
                updateInfo();
            };

            row.classList.toggle('pbl-selected', box.checked);
            row.addEventListener('click', toggle);
            box.addEventListener('click', event => {
                event.stopPropagation();
                toggle();
            });

            list.append(row);
        }

        updateInfo();
        fillTokenCounts(list);
    }

    // --- wiring ------------------------------------------------------------
    sourceSelect.addEventListener('change', () => {
        getSettings().lastSource = sourceSelect.value;
        saveSettings();
        tagFilter = '';
        renderTagBar();
        renderList();
    });
    search.addEventListener('input', renderList);
    junkBox.addEventListener('change', () => {
        getSettings().hideJunk = junkBox.checked;
        saveSettings();
        renderList();
    });
    selectAll.addEventListener('click', () => {
        for (const item of visibleItems()) {
            selection.set(item.key, item);
        }
        renderList();
    });
    clearAll.addEventListener('click', () => {
        selection.clear();
        renderList();
    });

    transferButton.addEventListener('click', async () => {
        await transferBlocks([...selection.values()]);
    });

    libraryButton.addEventListener('click', () => {
        const items = [...selection.values()];
        if (!items.length) {
            toastr.info(t('nothingSelected'));
            return;
        }
        const added = addToLibrary(items);
        if (added) {
            toastr.success(t('addedToLibrary', added));
        } else {
            toastr.info(t('alreadyInLibrary'));
        }
        renderTagBar();
        renderList();
    });

    moreButton.addEventListener('click', async () => {
        const action = await showMoreMenu(sourceSelect.value === LIBRARY_SOURCE);
        switch (action) {
            case 'export':
                exportLibrary();
                break;
            case 'import':
                if (await importLibrary()) {
                    renderTagBar();
                    renderList();
                }
                break;
            case 'tags':
                if (await editTags([...selection.values()])) {
                    renderTagBar();
                    renderList();
                }
                break;
            case 'remove': {
                const ids = [...selection.values()].map(item => item.libraryId).filter(Boolean);
                if (!ids.length) {
                    toastr.info(t('libraryOnly'));
                    break;
                }
                const removed = removeFromLibrary(ids);
                for (const item of [...selection.values()]) {
                    if (item.libraryId) {
                        selection.delete(item.key);
                    }
                }
                toastr.success(t('removed', removed));
                renderTagBar();
                renderList();
                break;
            }
            case 'settings':
                if (await editThreshold()) {
                    renderList();
                }
                break;
            default:
                break;
        }
    });

    renderTagBar();
    renderList();

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: t('close'),
        wide: true,
        large: true,
        allowVerticalScrolling: false,
    });
    popup.show();
}

/**
 * @param {boolean} isLibrary
 * @returns {Promise<string|null>}
 */
async function showMoreMenu(isLibrary) {
    const entries = [
        ...(isLibrary ? [
            { id: 'tags', icon: 'fa-tags', text: t('editTags') },
            { id: 'remove', icon: 'fa-trash-can', text: t('removeFromLibrary') },
        ] : []),
        { id: 'export', icon: 'fa-file-export', text: t('exportLibrary') },
        { id: 'import', icon: 'fa-file-import', text: t('importLibrary') },
        { id: 'settings', icon: 'fa-sliders', text: t('settings') },
    ];

    const root = document.createElement('div');
    root.classList.add('pbl-menu');
    let picked = null;

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: t('cancel'),
    });

    for (const entry of entries) {
        const row = document.createElement('div');
        row.classList.add('pbl-menu-item');
        const icon = document.createElement('div');
        icon.classList.add('fa-solid', entry.icon);
        const text = document.createElement('span');
        text.textContent = entry.text;
        row.append(icon, text);
        row.addEventListener('click', () => {
            picked = entry.id;
            popup.complete(POPUP_RESULT.AFFIRMATIVE);
        });
        root.append(row);
    }

    await popup.show();
    return picked;
}

/**
 * @param {BlockItem[]} items
 * @returns {Promise<boolean>}
 */
async function editTags(items) {
    const entries = items.filter(item => item.libraryId);
    if (!entries.length) {
        toastr.info(t('libraryOnly'));
        return false;
    }

    const shared = entries.length === 1 ? entries[0].tags.join(', ') : '';
    const popup = new Popup(t('tagsPrompt'), POPUP_TYPE.INPUT, shared, {
        okButton: t('editTags'),
        cancelButton: t('cancel'),
    });
    // INPUT popups resolve with the entered text, so the outcome is on `result`.
    await popup.show();
    if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    const tags = String(popup.value ?? '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

    const settings = getSettings();
    for (const item of entries) {
        const entry = settings.library.find(candidate => candidate.id === item.libraryId);
        if (entry) {
            entry.tags = [...tags];
            item.tags = [...tags];
        }
    }
    saveSettings();
    return true;
}

async function editThreshold() {
    const settings = getSettings();
    const popup = new Popup(t('junkThreshold'), POPUP_TYPE.INPUT, String(settings.junkThreshold), {
        okButton: t('settings'),
        cancelButton: t('cancel'),
    });
    await popup.show();
    if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }
    const value = Number.parseInt(String(popup.value ?? ''), 10);
    if (!Number.isFinite(value) || value < 0) {
        return false;
    }
    settings.junkThreshold = value;
    saveSettings();
    return true;
}

// #endregion

// #region Entry points

/** Adds the library button to the prompt manager toolbar and a star to each row. */
function decoratePromptManager() {
    const container = document.getElementById('completion_prompt_manager');
    if (!container) {
        return;
    }

    const footer = container.querySelector('.completion_prompt_manager_footer');
    if (footer && !footer.querySelector('#pbl_open_button')) {
        const button = document.createElement('a');
        button.id = 'pbl_open_button';
        button.classList.add('menu_button', 'fa-solid', 'fa-book-bookmark', 'fa-fw');
        button.title = t('title');
        button.addEventListener('click', openMainWindow);
        footer.append(button);
    }

    for (const row of container.querySelectorAll('.completion_prompt_manager_prompt')) {
        const controls = row.querySelector('.prompt_manager_prompt_controls');
        if (!controls || controls.querySelector('.pbl-row-star')) {
            continue;
        }
        const identifier = row.dataset.pmIdentifier;
        const prompt = (oai_settings.prompts ?? []).find(item => item?.identifier === identifier);
        if (!prompt || prompt.marker) {
            continue;
        }
        const star = document.createElement('span');
        star.classList.add('fa-solid', 'fa-star', 'fa-xs', 'pbl-row-star');
        star.title = t('starTitle');
        star.addEventListener('click', event => {
            event.stopPropagation();
            const added = addToLibrary([{
                key: `${activePresetName()}${identifier}`,
                source: activePresetName(),
                prompt,
                attached: true,
                enabled: true,
                tags: [],
            }]);
            if (added) {
                toastr.success(t('addedToLibrary', added));
            } else {
                toastr.info(t('alreadyInLibrary'));
            }
        });
        controls.prepend(star);
    }
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('pbl_wand_button')) {
        return;
    }
    const button = document.createElement('div');
    button.id = 'pbl_wand_button';
    button.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    const icon = document.createElement('div');
    icon.classList.add('fa-solid', 'fa-book-bookmark', 'extensionsMenuExtensionButton');
    const text = document.createElement('span');
    text.textContent = t('title');
    button.append(icon, text);
    button.addEventListener('click', openMainWindow);
    menu.append(button);
}

function registerSlashCommand() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'prompt-library',
            aliases: ['pbl'],
            callback: () => {
                openMainWindow();
                return '';
            },
            helpString: 'Opens the Prompt Block Library.',
        }));
    } catch (error) {
        console.warn(`[${MODULE_NAME}] slash command not registered`, error);
    }
}

jQuery(async () => {
    getSettings();
    addWandButton();
    registerSlashCommand();

    const container = document.getElementById('completion_prompt_manager');
    if (container) {
        // The prompt manager rebuilds its list on every render, so the decorations
        // have to be re-applied whenever its contents change.
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                decoratePromptManager();
            });
        });
        observer.observe(container, { childList: true, subtree: true });
    }

    decoratePromptManager();
    eventSource.on(event_types.APP_READY, decoratePromptManager);
    eventSource.on(event_types.CHAT_CHANGED, decoratePromptManager);
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, decoratePromptManager);

    console.log(`[${MODULE_NAME}] ready`);
});

// #endregion
