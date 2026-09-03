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
/** Prefix for the per-folder entries of the source dropdown. */
const FOLDER_PREFIX = '@@folder:';
/** Field stamped on every prompt this extension writes, linking it to a library entry. */
const ORIGIN_FIELD = 'pblOrigin';
/** Value the folder picker returns when the user wants a brand new folder. */
const NEW_FOLDER_SENTINEL = '@@new-folder';

const defaultSettings = {
    /** @type {LibraryEntry[]} */
    library: [],
    /** @type {string[]} Folder names, in display order. */
    folders: [],
    /** Blocks with less content than this are treated as separators and hidden by default. */
    junkThreshold: 20,
    hideJunk: true,
    lastSource: LIBRARY_SOURCE,
};

/**
 * @typedef {object} LibraryEntry
 * @property {string} id
 * @property {string[]} tags
 * @property {string} folder Folder name, empty when the entry sits outside any.
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
 * @property {string} [folder] Library folder, for library items.
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
        libraryAll: 'Library — all',
        noFolder: 'No folder',
        versionTitle: 'A block with this name is already in the library',
        versionExisting: 'In the library: {0} tok',
        versionNew: 'Being added: {0} tok',
        versionHint: 'Save it as a new version under a different name, or replace the library copy with this one.',
        versionAdd: 'Save as new',
        versionReplace: 'Replace',
        versionSkip: 'Skip',
        updatedInLibrary: 'Updated in the library: {0}',
        editBlock: 'Edit block',
        editName: 'Name',
        editRole: 'Role',
        editContent: 'Text',
        save: 'Save',
        saved: 'Saved.',
        propagateCount: 'Update the other copies too (found: {0})',
        saveFailed: 'Could not save. Check the server connection.',
        propagateTitle: 'Where to update',
        propagateHint: 'Text and settings of these blocks will be replaced with the version you just saved. Their position and on/off state stay as they are.',
        propagateLinked: 'copied from here',
        propagateByName: 'same name',
        propagateNone: 'This block was not found in any preset.',
        propagateDone: 'Updated in presets: {0}',
        deleteFromPreset: 'Delete from preset',
        deleteTitle: 'Delete blocks',
        deleteHint: 'These blocks will be removed from the presets completely. This cannot be undone.',
        deleteSkipped: 'Built-in blocks cannot be deleted: {0}',
        deleted: 'Deleted blocks: {0}',
        deleteFailed: 'Could not delete. Check the server connection.',
        presetOnly: 'Preset blocks only.',
        folders: 'Folders',
        moveToFolder: 'Move to folder',
        newFolder: 'New folder',
        newFolderPrompt: 'Folder name:',
        renameFolder: 'Rename folder',
        deleteFolder: 'Delete folder',
        deleteFolderConfirm: 'Delete the folder "{0}"? The blocks in it stay in the library, without a folder.',
        folderExists: 'A folder with this name already exists.',
        pickFolder: 'Move {0} block(s) to:',
        movedToFolder: 'Moved: {0}',
        folderOnly: 'Open a folder first.',
        oneBlockOnly: 'Pick exactly one block.',
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
        libraryAll: 'Библиотека — все',
        noFolder: 'Без папки',
        versionTitle: 'Блок с таким названием уже есть в библиотеке',
        versionExisting: 'В библиотеке: {0} ток.',
        versionNew: 'Добавляется: {0} ток.',
        versionHint: 'Можно сохранить как новую версию под другим названием или заменить копию в библиотеке этой.',
        versionAdd: 'Сохранить как новый',
        versionReplace: 'Заменить',
        versionSkip: 'Пропустить',
        updatedInLibrary: 'Обновлено в библиотеке: {0}',
        editBlock: 'Редактировать блок',
        editName: 'Название',
        editRole: 'Роль',
        editContent: 'Текст',
        save: 'Сохранить',
        saved: 'Сохранено.',
        propagateCount: 'Обновить и остальные копии (найдено: {0})',
        saveFailed: 'Не удалось сохранить. Проверь связь с сервером.',
        propagateTitle: 'Где обновить',
        propagateHint: 'Текст и настройки этих блоков заменятся только что сохранённой версией. Позиция в списке и вкл/выкл останутся как есть.',
        propagateLinked: 'скопирован отсюда',
        propagateByName: 'совпадает название',
        propagateNone: 'Этот блок не найден ни в одном пресете.',
        propagateDone: 'Обновлено в пресетах: {0}',
        deleteFromPreset: 'Удалить из пресета',
        deleteTitle: 'Удаление блоков',
        deleteHint: 'Эти блоки будут удалены из пресетов полностью. Отменить будет нельзя.',
        deleteSkipped: 'Встроенные блоки удалить нельзя: {0}',
        deleted: 'Удалено блоков: {0}',
        deleteFailed: 'Не удалось удалить. Проверь связь с сервером.',
        presetOnly: 'Только для блоков из пресетов.',
        folders: 'Папки',
        moveToFolder: 'Переместить в папку',
        newFolder: 'Новая папка',
        newFolderPrompt: 'Название папки:',
        renameFolder: 'Переименовать папку',
        deleteFolder: 'Удалить папку',
        deleteFolderConfirm: 'Удалить папку «{0}»? Блоки из неё останутся в библиотеке, без папки.',
        folderExists: 'Папка с таким названием уже есть.',
        pickFolder: 'Переместить блоков: {0}. Куда:',
        movedToFolder: 'Перемещено: {0}',
        folderOnly: 'Сначала открой папку.',
        oneBlockOnly: 'Выбери ровно один блок.',
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
                key: `${presetName}::${prompt.identifier}`,
                source: presetName,
                prompt,
                attached: index !== -1,
                enabled: index !== -1 ? !!order[index].enabled : false,
                position: index,
                tags: [],
            };
        })
        // The prompt list order, the same one the prompt manager shows and the
        // model receives. Detached blocks have no place in it, so they follow
        // at the end, by name.
        .sort((left, right) => {
            if (left.attached && right.attached) {
                return left.position - right.position;
            }
            if (left.attached !== right.attached) {
                return left.attached ? -1 : 1;
            }
            return String(left.prompt.name ?? '').localeCompare(String(right.prompt.name ?? ''));
        });
}

/**
 * @param {string|null} folder `null` for the whole library, `''` for blocks without a folder.
 * @returns {BlockItem[]}
 */
function readLibraryBlocks(folder = null) {
    return libraryEntries(folder).map(entry => ({
        key: `${LIBRARY_SOURCE}::${entry.id}`,
        source: LIBRARY_SOURCE,
        prompt: entry.prompt,
        attached: true,
        enabled: true,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        folder: entry.folder ?? '',
        libraryId: entry.id,
    }));
}

/**
 * A clean copy of a prompt, ready to be dropped into another preset. Everything
 * that describes the block travels with it — text, role, injection position,
 * depth, order, triggers, override flag — only the identity is reset.
 * The block also gets an invisible origin stamp when it comes from the library,
 * which is what lets a later edit find every copy again.
 * @param {object} prompt
 * @param {string} name
 * @param {string} [originId]
 * @returns {object}
 */
function clonePrompt(prompt, name, originId = '') {
    const copy = structuredClone(prompt);
    delete copy.extension;
    const clone = {
        ...copy,
        identifier: uuidv4(),
        name: name,
        system_prompt: false,
        marker: false,
        enabled: true,
    };
    const origin = originId || prompt?.[ORIGIN_FIELD];
    if (origin) {
        clone[ORIGIN_FIELD] = origin;
    }
    return clone;
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
 * Library entries, optionally narrowed to one folder.
 * @param {string|null} folder `null` for every entry, `''` for entries without a folder.
 * @returns {LibraryEntry[]}
 */
function libraryEntries(folder = null) {
    const entries = getSettings().library;
    return folder === null ? entries : entries.filter(entry => (entry.folder ?? '') === folder);
}

/**
 * Folder names. Folders referenced by an entry but missing from the list (after
 * an import, say) are adopted, so nothing becomes unreachable.
 * @returns {string[]}
 */
function listFolders() {
    const settings = getSettings();
    if (!Array.isArray(settings.folders)) {
        settings.folders = [];
    }
    for (const entry of settings.library) {
        const folder = entry.folder ?? '';
        if (folder && !settings.folders.includes(folder)) {
            settings.folders.push(folder);
        }
    }
    return settings.folders;
}

/**
 * @param {string} name
 * @returns {boolean} False when the name is empty or already taken.
 */
function createFolder(name) {
    const clean = String(name ?? '').trim();
    if (!clean || listFolders().includes(clean)) {
        return false;
    }
    getSettings().folders.push(clean);
    saveSettings();
    return true;
}

/**
 * @param {string} oldName
 * @param {string} newName
 * @returns {boolean}
 */
function renameFolder(oldName, newName) {
    const clean = String(newName ?? '').trim();
    const folders = listFolders();
    if (!clean || !folders.includes(oldName) || folders.includes(clean)) {
        return false;
    }
    folders[folders.indexOf(oldName)] = clean;
    for (const entry of getSettings().library) {
        if ((entry.folder ?? '') === oldName) {
            entry.folder = clean;
        }
    }
    saveSettings();
    return true;
}

/**
 * Removes a folder; its blocks stay in the library without one.
 * @param {string} name
 * @returns {number} How many blocks lost their folder.
 */
function deleteFolder(name) {
    const folders = listFolders();
    const index = folders.indexOf(name);
    if (index === -1) {
        return 0;
    }
    folders.splice(index, 1);
    let moved = 0;
    for (const entry of getSettings().library) {
        if ((entry.folder ?? '') === name) {
            entry.folder = '';
            moved++;
        }
    }
    saveSettings();
    return moved;
}

/**
 * @param {string[]} ids
 * @param {string} folder
 * @returns {number}
 */
function moveToFolder(ids, folder) {
    let moved = 0;
    for (const entry of getSettings().library) {
        if (ids.includes(entry.id) && (entry.folder ?? '') !== folder) {
            entry.folder = folder;
            moved++;
        }
    }
    if (moved) {
        saveSettings();
    }
    return moved;
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

/**
 * The base name without a trailing "(vN)".
 * @param {string} name
 * @returns {string}
 */
function baseName(name) {
    return String(name ?? '').replace(/\s*\(v\d+\)\s*$/i, '').trim();
}

/**
 * The next free "(vN)" name for a block whose name is already taken.
 * @param {string} name
 * @returns {string}
 */
function nextVersionName(name) {
    const base = baseName(name) || String(name ?? '');
    const taken = new Set(getSettings().library.map(entry => entry.prompt?.name));
    let version = 2;
    while (taken.has(`${base} (v${version})`)) {
        version++;
    }
    return `${base} (v${version})`;
}

/**
 * @param {object} prompt
 * @param {object} [options]
 * @param {string[]} [options.tags]
 * @param {string} [options.folder]
 * @param {string} [options.sourcePreset]
 * @param {string} [options.name] Overrides the prompt's own name.
 * @returns {LibraryEntry}
 */
function addLibraryEntry(prompt, { tags = [], folder = '', sourcePreset = '', name = '' } = {}) {
    const stored = structuredClone(prompt);
    delete stored[ORIGIN_FIELD];
    if (name) {
        stored.name = name;
    }
    const entry = {
        id: uuidv4(),
        tags: [...tags],
        folder: folder,
        sourcePreset: sourcePreset,
        addedAt: Date.now(),
        prompt: stored,
    };
    getSettings().library.push(entry);
    saveSettings();
    return entry;
}

/**
 * Replaces the stored block of an entry, keeping its id, tags and folder.
 * @param {string} id
 * @param {object} prompt
 * @returns {boolean}
 */
function replaceLibraryEntry(id, prompt) {
    const entry = getSettings().library.find(candidate => candidate.id === id);
    if (!entry) {
        return false;
    }
    const stored = structuredClone(prompt);
    delete stored[ORIGIN_FIELD];
    entry.prompt = stored;
    entry.addedAt = Date.now();
    saveSettings();
    return true;
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

/**
 * @typedef {object} BlockCopy
 * @property {'preset'|'library'} kind
 * @property {string} label Human readable "where — name".
 * @property {boolean} linked Found by the origin stamp rather than by name.
 * @property {string} [preset] Preset name, for preset copies.
 * @property {object} [prompt] The prompt object, for preset copies.
 * @property {LibraryEntry} [entry] The entry, for library copies.
 */

/**
 * Every other copy of a block — in any preset and in the library. A copy is
 * either stamped with the same origin (so it was made from the same library
 * entry) or simply carries the same name.
 * @param {object} options
 * @param {string} [options.originId]
 * @param {string[]} options.names Names to match: the current one, and the one
 *  it had before this edit.
 * @param {string} [options.skipIdentifier] Prompt to leave out — the one being edited.
 * @param {string} [options.skipLibraryId] Library entry to leave out.
 * @returns {BlockCopy[]}
 */
function findCopies({ originId = '', names = [], skipIdentifier = '', skipLibraryId = '' }) {
    const wanted = new Set(names.filter(Boolean));
    /** @type {BlockCopy[]} */
    const found = [];

    for (const preset of listPresets()) {
        const settings = readableSettings(preset.name);
        for (const prompt of settings?.prompts ?? []) {
            if (!prompt || prompt.marker || !prompt.identifier || prompt.identifier === skipIdentifier) {
                continue;
            }
            const linked = Boolean(originId) && prompt[ORIGIN_FIELD] === originId;
            if (linked || wanted.has(prompt.name)) {
                found.push({
                    kind: 'preset',
                    label: `${preset.name} — ${prompt.name}`,
                    linked,
                    preset: preset.name,
                    prompt,
                });
            }
        }
    }

    for (const entry of getSettings().library) {
        if (entry.id === skipLibraryId) {
            continue;
        }
        const linked = Boolean(originId) && entry.id === originId;
        if (linked || wanted.has(entry.prompt?.name)) {
            found.push({
                kind: 'library',
                label: `★ ${t('library')} — ${entry.prompt?.name}`,
                linked,
                entry,
            });
        }
    }

    return found;
}

// #endregion

// #region Transfer

/**
 * Applies a change to every copy of a preset — the live settings when it is the
 * active one, and the stored preset — then writes the preset file.
 * @param {string} name
 * @param {(settings: object) => void} mutate
 * @returns {Promise<boolean>} False when there is no such preset.
 */
async function mutatePreset(name, mutate) {
    const manager = getPresetManager('openai');
    if (!manager) {
        throw new Error('Chat Completion preset manager is not available');
    }
    const destinations = writableSettings(name);
    if (!destinations.length) {
        console.warn(`[${MODULE_NAME}] preset not found: ${name}`);
        return false;
    }
    for (const settings of destinations) {
        mutate(settings);
    }
    const stored = listPresets().find(preset => preset.name === name)?.settings;
    if (stored) {
        await manager.savePreset(name, stored, { skipUpdate: true });
    }
    return true;
}

/** Persists the live settings and redraws the prompt manager. */
async function refreshActivePreset() {
    await promptManager?.saveServiceSettings?.();
    promptManager?.render?.();
}

/**
 * Writes the prepared blocks into their target presets and persists everything.
 * @param {{target: string, item: BlockItem, name: string}[]} plan
 * @returns {Promise<{blocks: number, presets: number}>}
 */
async function applyTransfer(plan) {
    const targets = [...new Set(plan.map(entry => entry.target))];
    let blocks = 0;
    let touchedActive = false;

    for (const target of targets) {
        // One prompt object per target, cloned into each copy of the preset, so
        // the live settings and the stored preset carry the same identifier.
        const prompts = plan
            .filter(entry => entry.target === target)
            .map(entry => clonePrompt(entry.item.prompt, entry.name, entry.item.libraryId ?? ''));

        const written = await mutatePreset(target, settings => {
            if (!Array.isArray(settings.prompts)) {
                settings.prompts = [];
            }
            const order = getOrder(settings, true);
            for (const prompt of prompts) {
                settings.prompts.push(structuredClone(prompt));
                order.push({ identifier: prompt.identifier, enabled: true });
            }
        });

        if (!written) {
            continue;
        }
        blocks += prompts.length;
        if (target === activePresetName()) {
            touchedActive = true;
        }
    }

    if (touchedActive) {
        await refreshActivePreset();
    }

    return { blocks, presets: targets.length };
}

/**
 * Removes blocks from presets, both from the prompt list and from every order.
 * @param {{preset: string, identifiers: string[]}[]} plan
 * @returns {Promise<number>} How many blocks were removed.
 */
async function deleteBlocks(plan) {
    let removed = 0;
    let touchedActive = false;

    for (const { preset, identifiers } of plan) {
        if (!identifiers.length) {
            continue;
        }
        const ids = new Set(identifiers);
        const written = await mutatePreset(preset, settings => {
            if (Array.isArray(settings.prompts)) {
                settings.prompts = settings.prompts.filter(prompt => !ids.has(prompt?.identifier));
            }
            for (const list of settings.prompt_order ?? []) {
                if (Array.isArray(list?.order)) {
                    list.order = list.order.filter(entry => !ids.has(entry?.identifier));
                }
            }
        });
        if (!written) {
            continue;
        }
        removed += identifiers.length;
        if (preset === activePresetName()) {
            touchedActive = true;
        }
    }

    if (touchedActive) {
        await refreshActivePreset();
    }
    return removed;
}

/** Fields that describe the block itself, as opposed to where it sits. */
const BLOCK_FIELDS = [
    'name',
    'content',
    'role',
    'injection_position',
    'injection_depth',
    'injection_order',
    'injection_trigger',
    'forbid_overrides',
];

/**
 * Overwrites a block with another version of itself, leaving its identifier,
 * its place in the list and its on/off state alone.
 * @param {object} target
 * @param {object} source
 * @param {string} [originId]
 * @returns {void}
 */
function applyBlockFields(target, source, originId = '') {
    for (const field of BLOCK_FIELDS) {
        if (source[field] !== undefined) {
            target[field] = structuredClone(source[field]);
        }
    }
    if (originId) {
        target[ORIGIN_FIELD] = originId;
    }
}

/**
 * Pushes an edited block out to its other copies, in presets and in the library.
 * @param {BlockCopy[]} copies
 * @param {object} source The version that wins.
 * @param {string} [originId]
 * @returns {Promise<number>} How many copies were updated.
 */
async function applyCopies(copies, source, originId = '') {
    let updated = 0;
    let touchedActive = false;

    const libraryCopies = copies.filter(copy => copy.kind === 'library');
    for (const copy of libraryCopies) {
        applyBlockFields(copy.entry.prompt, source);
        delete copy.entry.prompt[ORIGIN_FIELD];
        updated++;
    }
    if (libraryCopies.length) {
        saveSettings();
    }

    const presetCopies = copies.filter(copy => copy.kind === 'preset');
    for (const preset of [...new Set(presetCopies.map(copy => copy.preset))]) {
        const ids = new Set(presetCopies
            .filter(copy => copy.preset === preset)
            .map(copy => copy.prompt?.identifier));

        const written = await mutatePreset(preset, settings => {
            for (const prompt of settings.prompts ?? []) {
                if (prompt && ids.has(prompt.identifier)) {
                    applyBlockFields(prompt, source, originId);
                }
            }
        });
        if (!written) {
            continue;
        }
        updated += ids.size;
        if (preset === activePresetName()) {
            touchedActive = true;
        }
    }

    if (touchedActive) {
        await refreshActivePreset();
    }
    return updated;
}

/**
 * Saves the edited fields into the block itself.
 * @param {BlockItem} item
 * @param {object} values Name, role and content.
 * @returns {Promise<boolean>}
 */
async function saveBlockInPlace(item, values) {
    if (item.libraryId) {
        const entry = getSettings().library.find(candidate => candidate.id === item.libraryId);
        if (!entry) {
            return false;
        }
        Object.assign(entry.prompt, values);
        saveSettings();
        return true;
    }

    const identifier = item.prompt?.identifier;
    const written = await mutatePreset(item.source, settings => {
        for (const prompt of settings.prompts ?? []) {
            if (prompt && prompt.identifier === identifier) {
                Object.assign(prompt, values);
            }
        }
    });
    if (written && item.source === activePresetName()) {
        await refreshActivePreset();
    }
    return written;
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
        version: 2,
        exportedAt: new Date().toISOString(),
        folders: listFolders(),
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
            folder: String(entry.folder ?? ''),
            sourcePreset: String(entry.sourcePreset ?? ''),
            addedAt: Number(entry.addedAt) || Date.now(),
            prompt: entry.prompt,
        }));

    const replacing = choice === POPUP_RESULT.CUSTOM1;
    settings.library = replacing ? sanitized : [...settings.library, ...sanitized];
    const importedFolders = Array.isArray(payload?.folders) ? payload.folders.map(String) : [];
    settings.folders = replacing ? [] : listFolders();
    for (const folder of importedFolders) {
        if (folder && !settings.folders.includes(folder)) {
            settings.folders.push(folder);
        }
    }
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

/**
 * Token count for a piece of text, cached like the ones in the list.
 * @param {string} text
 * @returns {Promise<number>}
 */
async function countTokens(text) {
    const content = String(text ?? '');
    if (!tokenCache.has(content)) {
        try {
            tokenCache.set(content, content ? await getTokenCountAsync(content) : 0);
        } catch (error) {
            console.debug(`[${MODULE_NAME}] token count failed`, error);
            tokenCache.set(content, 0);
        }
    }
    return tokenCache.get(content);
}

/** Small labelled row used by the dialogs below. */
function labelledControl(labelText, control) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('pbl-field');
    const caption = document.createElement('span');
    caption.classList.add('pbl-field-label');
    caption.textContent = labelText;
    wrapper.append(caption, control);
    return wrapper;
}

/**
 * Asks what to do when the library already holds a block under this name.
 * @param {LibraryEntry} existing
 * @param {object} prompt The block being added.
 * @returns {Promise<{action: 'add'|'replace'|'skip', name?: string}>}
 */
async function resolveLibraryVersion(existing, prompt) {
    const existingTokens = await countTokens(existing.prompt?.content);
    const newTokens = await countTokens(prompt?.content);

    const root = document.createElement('div');
    root.classList.add('pbl-version');

    const title = document.createElement('div');
    title.classList.add('pbl-version-title');
    title.textContent = t('versionTitle');

    const hint = document.createElement('div');
    hint.classList.add('pbl-hint');
    hint.textContent = t('versionHint');

    const compare = document.createElement('div');
    compare.classList.add('pbl-compare');
    const oldLine = document.createElement('div');
    oldLine.textContent = `${existing.prompt?.name} — ${t('versionExisting', existingTokens)}`;
    const newLine = document.createElement('div');
    newLine.textContent = `${prompt?.name} — ${t('versionNew', newTokens)}`;
    compare.append(oldLine, newLine);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.classList.add('text_pole');
    nameInput.value = nextVersionName(prompt?.name);

    root.append(title, compare, hint, labelledControl(t('editName'), nameInput));

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('versionAdd'),
        cancelButton: t('versionSkip'),
        customButtons: [{ text: t('versionReplace'), result: POPUP_RESULT.CUSTOM1 }],
        allowVerticalScrolling: true,
    });
    const result = await popup.show();

    if (result === POPUP_RESULT.CUSTOM1) {
        return { action: 'replace' };
    }
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { action: 'skip' };
    }
    return { action: 'add', name: nameInput.value.trim() || nextVersionName(prompt?.name) };
}

/**
 * Puts blocks into the library, asking about name clashes one by one.
 * @param {BlockItem[]} items
 * @param {string} [folder] Folder the new entries land in.
 * @returns {Promise<{added: number, updated: number}>}
 */
async function addToLibraryFlow(items, folder = '') {
    let added = 0;
    let updated = 0;
    let duplicates = 0;

    for (const item of items) {
        const prompt = item.prompt;
        const name = String(prompt?.name ?? '').trim() || 'Prompt';
        const content = String(prompt?.content ?? '');
        const sourcePreset = item.source === LIBRARY_SOURCE ? '' : item.source;
        const library = getSettings().library;

        if (library.some(entry => entry.prompt?.name === name && String(entry.prompt?.content ?? '') === content)) {
            duplicates++;
            continue;
        }

        const clash = library.find(entry => entry.prompt?.name === name);
        if (!clash) {
            addLibraryEntry(prompt, { tags: item.tags, folder, sourcePreset });
            added++;
            continue;
        }

        const decision = await resolveLibraryVersion(clash, prompt);
        if (decision.action === 'skip') {
            continue;
        }
        if (decision.action === 'replace') {
            replaceLibraryEntry(clash.id, prompt);
            updated++;
            continue;
        }
        addLibraryEntry(prompt, {
            tags: item.tags,
            folder: folder || clash.folder || '',
            sourcePreset,
            name: decision.name,
        });
        added++;
    }

    if (added) {
        toastr.success(t('addedToLibrary', added));
    }
    if (updated) {
        toastr.success(t('updatedInLibrary', updated));
    }
    if (!added && !updated && duplicates) {
        toastr.info(t('alreadyInLibrary'));
    }
    return { added, updated };
}

/**
 * Lets the user pick which copies of a block should follow an edit.
 * @param {BlockCopy[]} copies
 * @returns {Promise<BlockCopy[]|null>}
 */
async function pickPropagationTargets(copies) {
    const root = document.createElement('div');
    root.classList.add('pbl-propagate');

    const hint = document.createElement('div');
    hint.classList.add('pbl-hint');
    hint.textContent = t('propagateHint');
    root.append(hint);

    const boxes = [];
    for (const copy of copies) {
        const row = document.createElement('label');
        row.classList.add('pbl-target');

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = true;
        boxes.push({ box, copy });

        const text = document.createElement('span');
        const title = document.createElement('div');
        title.textContent = copy.label;
        const badge = document.createElement('small');
        badge.classList.add('pbl-conflict-target');
        badge.textContent = copy.linked ? t('propagateLinked') : t('propagateByName');
        text.append(title, badge);

        row.append(box, text);
        root.append(row);
    }

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('save'),
        cancelButton: t('cancel'),
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }
    return boxes.filter(entry => entry.box.checked).map(entry => entry.copy);
}

/**
 * Edits a block — a library entry or a block of any preset — and offers to
 * carry the change over to its other copies.
 * @param {BlockItem} item
 * @returns {Promise<boolean>} True when something was saved.
 */
async function editBlock(item) {
    const entry = item.libraryId
        ? getSettings().library.find(candidate => candidate.id === item.libraryId)
        : null;
    if (item.libraryId && !entry) {
        toastr.info(t('libraryOnly'));
        return false;
    }

    const prompt = entry ? entry.prompt : item.prompt;
    const previousName = String(prompt?.name ?? '');
    const originId = entry ? entry.id : String(prompt?.[ORIGIN_FIELD] ?? '');
    const copies = findCopies({
        originId,
        names: [previousName],
        skipIdentifier: entry ? '' : prompt?.identifier,
        skipLibraryId: entry ? entry.id : '',
    });

    const root = document.createElement('div');
    root.classList.add('pbl-editor');

    const where = document.createElement('div');
    where.classList.add('pbl-editor-where');
    where.textContent = entry ? `★ ${t('library')}` : item.source;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.classList.add('text_pole');
    nameInput.value = previousName;

    const roleSelect = document.createElement('select');
    roleSelect.classList.add('text_pole');
    for (const role of ['system', 'user', 'assistant']) {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        roleSelect.append(option);
    }
    roleSelect.value = prompt?.role ?? 'system';

    const contentInput = document.createElement('textarea');
    contentInput.classList.add('text_pole', 'pbl-editor-text');
    contentInput.rows = 10;
    contentInput.value = String(prompt?.content ?? '');

    const contentField = labelledControl(t('editContent'), contentInput);
    contentField.classList.add('pbl-field-grow');

    root.append(
        where,
        labelledControl(t('editName'), nameInput),
        labelledControl(t('editRole'), roleSelect),
        contentField,
    );

    // Only worth asking about when the block actually exists somewhere else.
    const propagateBox = document.createElement('input');
    propagateBox.type = 'checkbox';
    if (copies.length) {
        const propagateLabel = document.createElement('label');
        propagateLabel.classList.add('pbl-junk');
        const propagateText = document.createElement('span');
        propagateText.textContent = t('propagateCount', copies.length);
        propagateLabel.append(propagateBox, propagateText);
        root.append(propagateLabel);
    }

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: t('save'),
        cancelButton: t('cancel'),
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    const values = {
        name: nameInput.value.trim() || previousName,
        role: roleSelect.value,
        content: contentInput.value,
    };

    // Blocks that were never copied by this extension have nothing tying them
    // together. If the edit is about to travel to them, give the whole group a
    // stamp now, so the next edit finds them exactly instead of by name.
    const groupId = originId || (propagateBox.checked && copies.length ? uuidv4() : '');
    if (!entry && groupId) {
        values[ORIGIN_FIELD] = groupId;
    }

    try {
        if (!await saveBlockInPlace(item, values)) {
            toastr.error(t('saveFailed'));
            return false;
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] save failed`, error);
        toastr.error(t('saveFailed'));
        return false;
    }

    if (!propagateBox.checked || !copies.length) {
        toastr.success(t('saved'));
        return true;
    }

    const chosen = await pickPropagationTargets(copies);
    if (!chosen?.length) {
        toastr.success(t('saved'));
        return true;
    }
    try {
        const source = entry ? entry.prompt : { ...prompt, ...values };
        const updated = await applyCopies(chosen, source, groupId);
        toastr.success(t('propagateDone', updated));
    } catch (error) {
        console.error(`[${MODULE_NAME}] propagation failed`, error);
        toastr.error(t('saveFailed'));
    }
    return true;
}

/**
 * Deletes the selected preset blocks, after a confirmation listing them.
 * @param {BlockItem[]} items
 * @returns {Promise<boolean>}
 */
async function deleteBlocksFlow(items) {
    const blocks = items.filter(item => item.source !== LIBRARY_SOURCE);
    if (!blocks.length) {
        toastr.info(t('presetOnly'));
        return false;
    }

    const protectedBlocks = blocks.filter(item => item.prompt?.system_prompt);
    const removable = blocks.filter(item => !item.prompt?.system_prompt);
    if (!removable.length) {
        toastr.warning(t('deleteSkipped', protectedBlocks.map(item => item.prompt?.name).join(', ')));
        return false;
    }

    const root = document.createElement('div');
    root.classList.add('pbl-delete');
    const hint = document.createElement('div');
    hint.classList.add('pbl-hint');
    hint.textContent = t('deleteHint');
    root.append(hint);
    for (const item of removable) {
        const row = document.createElement('div');
        row.classList.add('pbl-delete-row');
        const where = document.createElement('small');
        where.classList.add('pbl-conflict-target');
        where.textContent = item.source;
        const name = document.createElement('div');
        name.textContent = item.prompt?.name || '—';
        row.append(where, name);
        root.append(row);
    }

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('deleteFromPreset'),
        cancelButton: t('cancel'),
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    const plan = [...new Set(removable.map(item => item.source))].map(preset => ({
        preset,
        identifiers: removable
            .filter(item => item.source === preset)
            .map(item => item.prompt?.identifier)
            .filter(Boolean),
    }));

    try {
        const removed = await deleteBlocks(plan);
        toastr.success(t('deleted', removed));
        if (protectedBlocks.length) {
            toastr.info(t('deleteSkipped', protectedBlocks.map(item => item.prompt?.name).join(', ')));
        }
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] delete failed`, error);
        toastr.error(t('deleteFailed'));
        return false;
    }
}

/**
 * Folder picker, with an entry for creating one on the spot.
 * @param {number} count Blocks about to be moved, for the title.
 * @returns {Promise<string|null>} Folder name, `''` for none, `null` when cancelled.
 */
async function pickFolder(count) {
    const root = document.createElement('div');
    root.classList.add('pbl-menu');

    const title = document.createElement('div');
    title.classList.add('pbl-targets-title');
    title.textContent = t('pickFolder', count);
    root.append(title);

    let picked = null;
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: t('cancel'),
        allowVerticalScrolling: true,
    });

    const addRow = (icon, text, value) => {
        const row = document.createElement('div');
        row.classList.add('pbl-menu-item');
        const iconElement = document.createElement('div');
        iconElement.classList.add('fa-solid', icon);
        const label = document.createElement('span');
        label.textContent = text;
        row.append(iconElement, label);
        row.addEventListener('click', () => {
            picked = value;
            popup.complete(POPUP_RESULT.AFFIRMATIVE);
        });
        root.append(row);
    };

    addRow('fa-inbox', t('noFolder'), '');
    for (const folder of listFolders()) {
        addRow('fa-folder', folder, folder);
    }
    addRow('fa-folder-plus', t('newFolder'), NEW_FOLDER_SENTINEL);

    await popup.show();

    if (picked === NEW_FOLDER_SENTINEL) {
        const created = await promptForFolderName(t('newFolder'));
        return created ?? null;
    }
    return picked;
}

/**
 * Asks for a folder name and creates it.
 * @param {string} title
 * @returns {Promise<string|null>} The created folder name.
 */
async function promptForFolderName(title) {
    const popup = new Popup(`${title}\n${t('newFolderPrompt')}`, POPUP_TYPE.INPUT, '', {
        okButton: t('save'),
        cancelButton: t('cancel'),
    });
    await popup.show();
    if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }
    const name = String(popup.value ?? '').trim();
    if (!name) {
        return null;
    }
    if (!createFolder(name)) {
        toastr.warning(t('folderExists'));
        return listFolders().includes(name) ? name : null;
    }
    return name;
}

/**
 * @param {string} value A source dropdown value.
 * @returns {boolean} Whether it points at the library rather than a preset.
 */
function isLibrarySource(value) {
    return value === LIBRARY_SOURCE || String(value).startsWith(FOLDER_PREFIX);
}

/**
 * @param {string} value A source dropdown value.
 * @returns {string|null} Folder name, `''` for the no-folder view, `null` for
 *  the whole library or a preset.
 */
function folderOfSource(value) {
    return String(value).startsWith(FOLDER_PREFIX) ? String(value).slice(FOLDER_PREFIX.length) : null;
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
    const active = activePresetName();

    function fillSources() {
        const previous = sourceSelect.value;
        sourceSelect.innerHTML = '';

        const libraryOption = document.createElement('option');
        libraryOption.value = LIBRARY_SOURCE;
        libraryOption.textContent = `★ ${t('libraryAll')}`;
        sourceSelect.append(libraryOption);

        const noFolder = document.createElement('option');
        noFolder.value = FOLDER_PREFIX;
        noFolder.textContent = `★ / ${t('noFolder')}`;
        sourceSelect.append(noFolder);

        for (const folder of listFolders()) {
            const option = document.createElement('option');
            option.value = FOLDER_PREFIX + folder;
            option.textContent = `★ / ${folder}`;
            sourceSelect.append(option);
        }

        for (const preset of listPresets()) {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name + (preset.name === active ? t('currentSuffix') : '');
            sourceSelect.append(option);
        }

        const values = [...sourceSelect.options].map(option => option.value);
        const wanted = values.includes(previous) ? previous : settings.lastSource;
        sourceSelect.value = values.includes(wanted) ? wanted : LIBRARY_SOURCE;
    }

    fillSources();

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
        return isLibrarySource(source) ? readLibraryBlocks(folderOfSource(source)) : readPresetBlocks(source);
    }

    function updateInfo() {
        info.textContent = t('selected', selection.size);
    }

    function renderTagBar() {
        tagBar.innerHTML = '';
        if (!isLibrarySource(sourceSelect.value)) {
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
        libraryButton.classList.toggle('pbl-hidden', isLibrarySource(sourceSelect.value));
        list.innerHTML = '';
        const items = visibleItems();

        if (!items.length) {
            const empty = document.createElement('li');
            empty.classList.add('pbl-empty');
            empty.textContent = isLibrarySource(sourceSelect.value) && !getSettings().library.length
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
            if (item.folder && sourceSelect.value === LIBRARY_SOURCE) {
                const badge = document.createElement('span');
                badge.classList.add('pbl-badge', 'pbl-badge-folder');
                badge.textContent = item.folder;
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

            const edit = document.createElement('div');
            edit.classList.add('fa-solid', 'fa-pencil', 'pbl-icon');
            edit.title = t('editBlock');
            edit.addEventListener('click', async event => {
                event.stopPropagation();
                if (await editBlock(item)) {
                    renderTagBar();
                    renderList();
                }
            });
            rowActions.append(edit);

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

    libraryButton.addEventListener('click', async () => {
        const items = [...selection.values()];
        if (!items.length) {
            toastr.info(t('nothingSelected'));
            return;
        }
        await addToLibraryFlow(items, folderOfSource(sourceSelect.value) ?? '');
        fillSources();
        renderTagBar();
        renderList();
    });

    moreButton.addEventListener('click', async () => {
        const source = sourceSelect.value;
        const folder = folderOfSource(source);
        const action = await showMoreMenu({ isLibrary: isLibrarySource(source), folder });

        switch (action) {
            case 'edit': {
                const entries = [...selection.values()];
                if (entries.length !== 1) {
                    toastr.info(t('oneBlockOnly'));
                    break;
                }
                if (await editBlock(entries[0])) {
                    renderTagBar();
                    renderList();
                }
                break;
            }
            case 'delete': {
                if (await deleteBlocksFlow([...selection.values()])) {
                    for (const item of [...selection.values()]) {
                        if (item.source !== LIBRARY_SOURCE) {
                            selection.delete(item.key);
                        }
                    }
                    renderList();
                }
                break;
            }
            case 'move': {
                const ids = [...selection.values()].map(item => item.libraryId).filter(Boolean);
                if (!ids.length) {
                    toastr.info(t('libraryOnly'));
                    break;
                }
                const target = await pickFolder(ids.length);
                if (target === null) {
                    break;
                }
                toastr.success(t('movedToFolder', moveToFolder(ids, target)));
                fillSources();
                renderList();
                break;
            }
            case 'newFolder': {
                if (await promptForFolderName(t('newFolder'))) {
                    fillSources();
                }
                break;
            }
            case 'renameFolder': {
                if (!folder) {
                    toastr.info(t('folderOnly'));
                    break;
                }
                const rename = new Popup(t('newFolderPrompt'), POPUP_TYPE.INPUT, folder, {
                    okButton: t('save'),
                    cancelButton: t('cancel'),
                });
                await rename.show();
                if (rename.result !== POPUP_RESULT.AFFIRMATIVE) {
                    break;
                }
                const name = String(rename.value ?? '').trim();
                if (!name || name === folder) {
                    break;
                }
                if (!renameFolder(folder, name)) {
                    toastr.warning(t('folderExists'));
                    break;
                }
                fillSources();
                sourceSelect.value = FOLDER_PREFIX + name;
                renderList();
                break;
            }
            case 'deleteFolder': {
                if (!folder) {
                    toastr.info(t('folderOnly'));
                    break;
                }
                const confirmation = new Popup(t('deleteFolderConfirm', folder), POPUP_TYPE.CONFIRM, '', {
                    okButton: t('deleteFolder'),
                    cancelButton: t('cancel'),
                });
                if (await confirmation.show() !== POPUP_RESULT.AFFIRMATIVE) {
                    break;
                }
                deleteFolder(folder);
                fillSources();
                sourceSelect.value = LIBRARY_SOURCE;
                renderTagBar();
                renderList();
                break;
            }
            case 'tags': {
                if (await editTags([...selection.values()])) {
                    renderTagBar();
                    renderList();
                }
                break;
            }
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
            case 'export':
                exportLibrary();
                break;
            case 'import':
                if (await importLibrary()) {
                    fillSources();
                    renderTagBar();
                    renderList();
                }
                break;
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
 * @param {object} state
 * @param {boolean} state.isLibrary
 * @param {string|null} state.folder Open folder, `''` for the no-folder view.
 * @returns {Promise<string|null>}
 */
async function showMoreMenu({ isLibrary, folder }) {
    const entries = [
        { id: 'edit', icon: 'fa-pencil', text: t('editBlock') },
        ...(isLibrary ? [
            { id: 'tags', icon: 'fa-tags', text: t('editTags') },
            { id: 'move', icon: 'fa-folder-open', text: t('moveToFolder') },
            { id: 'newFolder', icon: 'fa-folder-plus', text: t('newFolder') },
            ...(folder ? [
                { id: 'renameFolder', icon: 'fa-i-cursor', text: t('renameFolder') },
                { id: 'deleteFolder', icon: 'fa-folder-minus', text: t('deleteFolder') },
            ] : []),
            { id: 'remove', icon: 'fa-trash-can', text: t('removeFromLibrary') },
        ] : [
            { id: 'delete', icon: 'fa-trash-can', text: t('deleteFromPreset') },
        ]),
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
        star.addEventListener('click', async event => {
            event.stopPropagation();
            await addToLibraryFlow([{
                key: `${activePresetName()}::${identifier}`,
                source: activePresetName(),
                prompt,
                attached: true,
                enabled: true,
                tags: [],
            }]);
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
