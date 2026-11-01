/**
 * Shared UI helpers. All user-controlled strings must go through esc() before
 * being placed in an HTML template.
 */

import { CONFIG_LIMIT_BYTES, byteLength, isPersistent } from './storage.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10.5 9-7 9 7V21H3Z"/><path d="M9 21v-6h6v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  topology: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 12h3.5c2 0 2-6 5.5-6M11 12c2 0 2 6 5.5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  history: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 21h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3h12l4 4v14H3V3Z"/><path d="M8 3v6h8V3M7 21v-7h10v7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V3h8v3M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>',
  warning: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.6-4-9s1.5-6.5 4-9Z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c4 0 4 10 8 10h4M3 17h3c1.5 0 2.5-1.4 3.2-3M14 7h4M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
};

export function icon(name) {
  return ICONS[name] || '';
}

export function formatDate(value, options = {}) {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
}

export function formatRelative(value) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  const delta = Date.now() - date.getTime();
  if (Number.isNaN(delta)) return String(value);
  const past = delta >= 0;
  const seconds = Math.abs(delta) / 1000;
  const units = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let amount = seconds;
  let unit = 'second';
  for (const [factor, name] of units) {
    if (amount < factor) {
      unit = name;
      break;
    }
    if (factor !== Number.POSITIVE_INFINITY) amount /= factor;
  }
  const rounded = Math.max(1, Math.round(amount));
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ${past ? 'ago' : 'from now'}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export const SEVERITY = {
  error: { label: 'Error', tone: 'danger', icon: 'error', order: 0 },
  warning: { label: 'Warning', tone: 'warn', icon: 'warning', order: 1 },
  recommendation: { label: 'Recommendation', tone: 'accent', icon: 'info', order: 2 },
  info: { label: 'Info', tone: 'neutral', icon: 'info', order: 3 },
};

export function severityPill(severity) {
  const meta = SEVERITY[severity] || SEVERITY.info;
  return `<span class="pill ${meta.tone}">${icon(meta.icon)}${meta.label}</span>`;
}

export function scoreGauge(score, grade) {
  const normalized = Math.max(0, Math.min(100, Number(score) || 0));
  return `<div class="score-gauge" style="--score:${normalized}" role="img" aria-label="Configuration score ${normalized} out of 100, grade ${esc(grade)}">
    <div class="score-gauge-inner"><strong>${normalized}</strong><span>${esc(grade)}</span></div>
  </div>`;
}

export function toast(message, options = {}) {
  let region = document.querySelector('.toast');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  region.textContent = message;
  region.dataset.tone = options.tone || 'neutral';
  region.classList.add('visible');
  clearTimeout(region._timer);
  region._timer = setTimeout(() => region.classList.remove('visible'), options.duration || 3600);
}

export async function copyText(text, message = 'Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, { tone: 'ok' });
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    toast(ok ? message : 'Could not copy. Select the text manually.', { tone: ok ? 'ok' : 'danger' });
    return ok;
  }
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'haproxy.cfg';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(filename, value) {
  downloadText(filename, `${JSON.stringify(value, null, 2)}\n`, 'application/json;charset=utf-8');
}

export function renderDiff(diff, options = {}) {
  const rows = options.compact ? diff.hunks.flatMap((hunk) => hunk.rows) : diff.rows;
  if (rows.length === 0) {
    return '<div class="diff-empty">No differences.</div>';
  }
  const body = rows.map((row) => {
    const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
    const a = row.type === 'add' ? '' : String(row.aLine || '');
    const b = row.type === 'del' ? '' : String(row.bLine || '');
    return `<div class="diff-row ${row.type}"><span class="diff-sign" aria-hidden="true">${sign}</span><span class="diff-num">${a}</span><span class="diff-num">${b}</span><code>${esc(row.text)}</code></div>`;
  }).join('');
  return `<div class="diff" role="region" aria-label="Configuration diff">
    <div class="diff-head"><span>Old</span><span>New</span><span class="diff-legend"><span class="diff-chip add">+${diff.added}</span><span class="diff-chip del">−${diff.removed}</span><span class="diff-chip same">${diff.unchanged} unchanged</span></span></div>
    <div class="diff-body">${body}</div>
  </div>`;
}

export function confirmDialog({
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  details = [],
} = {}) {
  if (typeof document === 'undefined' || !document.createElement('dialog').showModal) {
    return Promise.resolve(window.confirm(message || title));
  }
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal confirm-modal';
    dialog.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <span class="pill ${tone === 'danger' ? 'danger' : 'accent'}">${tone === 'danger' ? icon('warning') : icon('info')}Confirm</span>
          <h2>${esc(title)}</h2>
          ${message ? `<p class="modal-lede">${esc(message)}</p>` : ''}
        </div>
        ${details.length ? `<ul class="modal-details">${details.map((detail) => `<li>${esc(detail)}</li>`).join('')}</ul>` : ''}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel" type="button">${esc(cancelLabel)}</button>
          <button class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-action="confirm" type="button">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.append(dialog);
    const close = (value) => {
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'cancel') close(false);
      if (action === 'confirm') close(true);
      if (event.target === dialog) close(false);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(false);
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    dialog.querySelector('[data-action="confirm"]')?.focus();
  });
}

function validConfigSize(text) {
  if (!text.trim()) return 'The configuration is empty.';
  if (byteLength(text) > CONFIG_LIMIT_BYTES) {
    return `The file is larger than ${Math.round(CONFIG_LIMIT_BYTES / 1024)} KB. HAProxy configs are normally much smaller; increase the limit in storage.js if this is intentional.`;
  }
  return null;
}

async function readConfigFile(file) {
  if (!file) return { error: 'No file selected.' };
  if (file.size > CONFIG_LIMIT_BYTES) {
    return { error: `“${file.name}” is ${formatBytes(file.size)}; the local limit is ${formatBytes(CONFIG_LIMIT_BYTES)}.` };
  }
  try {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const error = validConfigSize(text);
    if (error) return { error };
    return { text, filename: file.name };
  } catch {
    return { error: `Could not read “${file.name}”. Is it a text file?` };
  }
}

/**
 * Import dialog with file picker, drag-and-drop and paste.
 * onLoad(text, filename) is called after local validation.
 */
export function openImportDialog({ onLoad, title = 'Import HAProxy configuration' } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal import-modal';
  dialog.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <span class="pill accent">${icon('upload')}Local import</span>
        <h2>${esc(title)}</h2>
        <p class="modal-lede">The file is read by this browser tab. It is never uploaded, and the server has no write path.</p>
      </div>
      <label class="dropzone" data-dropzone>
        <input type="file" accept=".cfg,.conf,.txt,text/plain" data-file-input class="visually-hidden">
        <span class="dropzone-icon">${icon('upload')}</span>
        <strong>Drop a config file here</strong>
        <span>or <span class="link-like">choose a file</span> — .cfg, .conf or .txt</span>
        <small>Maximum ${Math.round(CONFIG_LIMIT_BYTES / 1024)} KB. Commands and secrets are not executed.</small>
      </label>
      <div class="import-divider"><span>or paste it</span></div>
      <label class="field">
        <span>Configuration text</span>
        <textarea data-paste rows="8" spellcheck="false" placeholder="global&#10;    log /dev/log local0&#10;&#10;defaults&#10;    mode http&#10;..."></textarea>
      </label>
      <div class="import-error" data-import-error hidden></div>
      <div class="modal-privacy">
        ${icon('lock')}
        <p><strong>Only the browser sees this config.</strong> HAProxy Workbench stores imports in this browser's localStorage so history works after reload. On a shared computer, use a private window and clear data afterwards.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="cancel" type="button">Cancel</button>
        <button class="btn btn-primary" data-action="paste" type="button">${icon('arrow')}Load pasted config</button>
      </div>
    </div>`;
  document.body.append(dialog);

  const errorBox = dialog.querySelector('[data-import-error]');
  const paste = dialog.querySelector('[data-paste]');
  const showError = (message) => {
    errorBox.hidden = false;
    errorBox.textContent = message;
  };
  const close = () => {
    if (dialog.open) dialog.close();
  };
  const accept = (text, filename) => {
    close();
    onLoad?.(text, filename || 'haproxy.cfg');
  };

  dialog.querySelector('[data-file-input]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    const result = await readConfigFile(file);
    if (result.error) showError(result.error);
    else accept(result.text, result.filename);
  });

  dialog.querySelector('[data-dropzone]').addEventListener('dragover', (event) => {
    event.preventDefault();
    event.currentTarget.classList.add('dragging');
  });
  dialog.querySelector('[data-dropzone]').addEventListener('dragleave', (event) => {
    event.currentTarget.classList.remove('dragging');
  });
  dialog.querySelector('[data-dropzone]').addEventListener('drop', async (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    const result = await readConfigFile(file);
    if (result.error) showError(result.error);
    else accept(result.text, result.filename);
  });

  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') close();
    if (action === 'paste') {
      const text = paste.value.replace(/^\uFEFF/, '');
      const error = validConfigSize(text);
      if (error) showError(error);
      else accept(text, 'haproxy.cfg');
    }
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  setTimeout(() => paste.focus(), 30);
}

export function attachDropZone(element, { onFile } = {}) {
  if (!element) return () => {};
  const over = (event) => {
    event.preventDefault();
    element.classList.add('dragging');
  };
  const leave = () => element.classList.remove('dragging');
  const drop = async (event) => {
    event.preventDefault();
    element.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const result = await readConfigFile(file);
    if (result.error) toast(result.error, { tone: 'danger', duration: 6000 });
    else onFile?.(result.text, result.filename);
  };
  element.addEventListener('dragover', over);
  element.addEventListener('dragleave', leave);
  element.addEventListener('drop', drop);
  return () => {
    element.removeEventListener('dragover', over);
    element.removeEventListener('dragleave', leave);
    element.removeEventListener('drop', drop);
  };
}

export function emptyStateHTML({
  iconName = 'layers',
  title = 'No configuration loaded',
  message = 'Import a HAProxy config or open a sample to start.',
  primaryLabel = 'Import configuration',
  primaryAction = 'import',
  secondaryLabel = 'Open a sample',
  secondaryHref = '#/',
} = {}) {
  return `<section class="empty-state">
    <div class="empty-icon">${icon(iconName)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(message)}</p>
    <div class="empty-actions">
      <button class="btn btn-primary" data-action="${esc(primaryAction)}" type="button">${icon('upload')}${esc(primaryLabel)}</button>
      <a class="btn btn-ghost" href="${esc(secondaryHref)}">${esc(secondaryLabel)}</a>
    </div>
  </section>`;
}

export function storageNotice() {
  if (isPersistent()) return '';
  return `<div class="callout warn">${icon('warning')}<p><strong>Local storage is unavailable.</strong> Your config and history will only last for this tab session. Check browser privacy settings or use a non-private window if you want persistence.</p></div>`;
}

export function stat(value, label, tone = '') {
  return `<div class="stat ${tone}"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
}
