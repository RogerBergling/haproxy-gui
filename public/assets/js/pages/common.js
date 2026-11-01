import { analyzeConfig } from '../config/analyzer.js';
import { parseConfig } from '../config/parser.js';
import { commitConfig, getCurrent, getHistory } from '../storage.js';
import {
  attachDropZone,
  downloadText,
  emptyStateHTML,
  icon,
  openImportDialog,
  storageNotice,
  toast,
} from '../ui.js';

export function parseAndAnalyze(current) {
  if (!current) return null;
  const model = parseConfig(current.text);
  return { model, analysis: analyzeConfig(model), current };
}

export function reloadRoute() {
  window.dispatchEvent(new CustomEvent('workbench:reload'));
}

export function commitImportedConfig(text, filename, options = {}) {
  const result = commitConfig(text, {
    filename: filename || 'haproxy.cfg',
    label: options.label || `Imported ${filename || 'configuration'}`,
    source: options.source || 'import',
    note: options.note || '',
  });
  if (!result.ok) {
    toast(result.error?.message || 'Could not save the imported configuration.', { tone: 'danger', duration: 6500 });
    return null;
  }
  if (result.warning) toast(result.warning, { tone: 'warn', duration: 6500 });
  else toast('Configuration imported. It stays in this browser only.', { tone: 'ok' });
  return result;
}

export function openImport({ onLoaded = null } = {}) {
  openImportDialog({
    onLoad: (text, filename) => {
      const result = commitImportedConfig(text, filename);
      if (!result) return;
      if (onLoaded) onLoaded(result, filename);
      else reloadRoute();
    },
  });
}

export function requireConfig(view, options = {}) {
  const current = getCurrent();
  if (current) return current;
  view.innerHTML = `
    ${storageNotice()}
    ${emptyStateHTML({
      title: options.title || 'Import a configuration to continue',
      message: options.message || 'This page works on a configuration stored in this browser. Import a file or open one of the included examples. Nothing is uploaded.',
      primaryLabel: 'Import configuration',
      secondaryLabel: 'Browse examples',
      secondaryHref: '#/',
    })}
    <section class="sample-inline">
      <div class="section-head"><h2>Or start from an example</h2><p>Both examples are anonymised and deliberately include review items.</p></div>
      <div class="sample-strip" id="empty-samples"></div>
    </section>`;
  view.querySelector('[data-action="import"]')?.addEventListener('click', () => openImport());
  import('../data/samples.js').then(({ SAMPLES }) => {
    const container = view.querySelector('#empty-samples');
    if (!container) return;
    container.innerHTML = SAMPLES.map((sample) => `
      <button class="sample-button" type="button" data-sample="${sample.id}">
        <strong>${sample.short}: ${sample.name}</strong>
        <span>${sample.architecture}</span>
        ${icon('arrow')}
      </button>`).join('');
    container.querySelectorAll('[data-sample]').forEach((button) => {
      button.addEventListener('click', async () => {
        const { getSample } = await import('../data/samples.js');
        const sample = getSample(button.dataset.sample);
        if (!sample) return;
        const result = commitImportedConfig(sample.text, `${sample.id}.cfg`, {
          label: sample.name,
          source: 'sample',
          note: sample.description,
        });
        if (result) reloadRoute();
      });
    });
  });
  return null;
}

export function downloadCurrent(current, text = null) {
  if (!current) return;
  const name = (current.filename || 'haproxy.cfg').replace(/[^\w.-]+/g, '_');
  downloadText(name.endsWith('.cfg') ? name : `${name}.cfg`, text ?? current.text);
  toast('Configuration downloaded from this browser.');
}

export function historyQuickState() {
  const history = getHistory();
  const current = getCurrent();
  return { history, current };
}

export function sourceLabel(source) {
  const labels = {
    import: 'Import',
    sample: 'Sample',
    manual: 'Manual save',
    service: 'Service wizard',
    'best-practice': 'Best practice',
    restore: 'Restore',
    revert: 'Restore',
  };
  return labels[source] || 'Change';
}

export function pageHeader({ eyebrow, title, lede, actions = '' }) {
  return `<header class="page-head">
    <div class="page-head-copy">
      ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
      <h1>${title}</h1>
      ${lede ? `<p class="page-lede">${lede}</p>` : ''}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

export function currentMeta(current, model) {
  return `<div class="meta-strip">
    <span class="pill">${icon('code')}${current.filename || 'haproxy.cfg'}</span>
    <span class="pill">${model.stats.lines} lines</span>
    <span class="pill">${model.stats.frontends + model.stats.listens} frontend${model.stats.frontends + model.stats.listens === 1 ? '' : 's'}</span>
    <span class="pill">${model.stats.backends + model.stats.listens} backend${model.stats.backends + model.stats.listens === 1 ? '' : 's'}</span>
    <span class="pill">${model.stats.servers} server${model.stats.servers === 1 ? '' : 's'}</span>
  </div>`;
}

export function attachFileDrop(view, selector, onLoaded) {
  const element = view.querySelector(selector);
  if (!element) return;
  attachDropZone(element, {
    onFile: (text, filename) => {
      const result = commitImportedConfig(text, filename);
      if (result) onLoaded?.(result, filename);
    },
  });
}
