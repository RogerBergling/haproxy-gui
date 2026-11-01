/**
 * Browser-local persistence.
 *
 * Nothing is sent to the server. Configurations and up to 100 snapshots live in
 * localStorage unless the browser blocks storage, in which case an in-memory
 * fallback keeps the current session usable (with a visible warning).
 */

const CURRENT_KEY = 'haproxy-workbench.current.v1';
const HISTORY_KEY = 'haproxy-workbench.history.v1';
const SETTINGS_KEY = 'haproxy-workbench.settings.v1';

export const CONFIG_LIMIT_BYTES = 512 * 1024;
export const HISTORY_LIMIT = 100;
const HISTORY_BUDGET_BYTES = 4 * 1024 * 1024;

let memory = new Map();
let persistent = detectStorage();

function detectStorage() {
  try {
    const key = '__hpgui_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    try {
      memory.set(key, value);
      return {
        ok: true,
        memoryOnly: true,
        warning: 'Browser storage is full or unavailable. This change is kept in memory for the current tab only.',
        error,
      };
    } catch {
      return { ok: false, error };
    }
  }
}

function removeRaw(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  memory.delete(key);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function emitChange(type) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workbench:data', { detail: { type } }));
  }
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isPersistent() {
  return persistent;
}

export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return new Blob([text]).size;
}

export function getCurrent() {
  const raw = parseJson(readRaw(CURRENT_KEY), null);
  if (!raw || typeof raw.text !== 'string') return null;
  return {
    text: raw.text,
    filename: raw.filename || 'haproxy.cfg',
    label: raw.label || 'Untitled configuration',
    updatedAt: raw.updatedAt || null,
  };
}

export function getHistory() {
  const history = parseJson(readRaw(HISTORY_KEY), []);
  if (!Array.isArray(history)) return [];
  return history.filter((entry) => entry && typeof entry.text === 'string').slice(0, HISTORY_LIMIT);
}

export function getSettings() {
  return parseJson(readRaw(SETTINGS_KEY), {});
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeRaw(SETTINGS_KEY, JSON.stringify(next));
  emitChange('settings');
  return next;
}

function trimHistory(history) {
  let list = history.slice(0, HISTORY_LIMIT);
  let total = JSON.stringify(list).length;
  while (list.length > 1 && total > HISTORY_BUDGET_BYTES) {
    list = list.slice(0, -1);
    total = JSON.stringify(list).length;
  }
  return list;
}

function persistHistory(history) {
  let list = trimHistory(history);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = writeRaw(HISTORY_KEY, JSON.stringify(list));
    if (result.ok) return { ok: true, list, warning: result.warning };
    if (list.length > 1) {
      list = list.slice(0, -1);
      continue;
    }
    return { ok: false, error: result.error, list };
  }
  return { ok: false, list };
}

export function pushHistory(text, meta = {}) {
  if (byteLength(text) > CONFIG_LIMIT_BYTES) {
    return {
      ok: false,
      error: new Error(`Configuration is larger than the ${Math.round(CONFIG_LIMIT_BYTES / 1024)} KB local-storage limit.`),
    };
  }
  const history = getHistory();
  if (history.length > 0 && history[0].text === text) {
    return { ok: true, duplicate: true, entry: history[0], history };
  }
  const entry = {
    id: uid(),
    text,
    at: new Date().toISOString(),
    filename: meta.filename || 'haproxy.cfg',
    label: meta.label || 'Configuration change',
    source: meta.source || 'manual',
    note: meta.note || '',
  };
  const next = trimHistory([entry, ...history]);
  const result = persistHistory(next);
  if (!result.ok) return { ok: false, error: result.error || new Error('Could not save history.') };
  emitChange('history');
  return { ok: true, entry, history: result.list, warning: result.warning };
}

export function saveCurrent(text, meta = {}) {
  if (byteLength(text) > CONFIG_LIMIT_BYTES) {
    return {
      ok: false,
      error: new Error(`Configuration is larger than the ${Math.round(CONFIG_LIMIT_BYTES / 1024)} KB local-storage limit.`),
    };
  }
  const current = {
    text,
    filename: meta.filename || 'haproxy.cfg',
    label: meta.label || 'Untitled configuration',
    updatedAt: new Date().toISOString(),
  };
  const result = writeRaw(CURRENT_KEY, JSON.stringify(current));
  if (!result.ok) return { ok: false, error: result.error || new Error('Could not save configuration.') };
  emitChange('current');
  return { ok: true, current, warning: result.warning };
}

/**
 * Save the current config and record a history snapshot.
 * @returns {{ok:boolean, current?:object, entry?:object, error?:Error, warning?:string, duplicate?:boolean}}
 */
export function commitConfig(text, meta = {}) {
  const saved = saveCurrent(text, meta);
  if (!saved.ok) return saved;
  if (meta.record === false) return saved;
  const history = pushHistory(text, {
    filename: meta.filename,
    label: meta.label,
    source: meta.source,
    note: meta.note,
  });
  if (!history.ok) return { ...saved, ok: false, error: history.error };
  return { ...saved, entry: history.entry, duplicate: history.duplicate, warning: saved.warning || history.warning };
}

export function deleteHistoryEntry(id) {
  const history = getHistory().filter((entry) => entry.id !== id);
  const result = persistHistory(history);
  emitChange('history');
  return result.ok;
}

export function clearHistory() {
  removeRaw(HISTORY_KEY);
  emitChange('history');
}

export function clearAll() {
  removeRaw(CURRENT_KEY);
  removeRaw(HISTORY_KEY);
  removeRaw(SETTINGS_KEY);
  emitChange('current');
  emitChange('history');
  emitChange('settings');
}

export function getHistoryEntry(id) {
  return getHistory().find((entry) => entry.id === id) || null;
}

export function storageSummary() {
  const current = getCurrent();
  const history = getHistory();
  return {
    persistent,
    hasConfig: Boolean(current),
    historyCount: history.length,
    historyLimit: HISTORY_LIMIT,
    approxBytes: byteLength(
      JSON.stringify({ current, history, settings: getSettings() }),
    ),
  };
}

export {
  CURRENT_KEY,
  HISTORY_KEY,
  SETTINGS_KEY,
  HISTORY_BUDGET_BYTES,
};
