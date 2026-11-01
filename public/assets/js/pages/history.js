import { diffLines } from '../config/diff.js';
import {
  clearAll,
  clearHistory,
  commitConfig,
  getCurrent,
  getHistory,
  storageSummary,
} from '../storage.js';
import {
  confirmDialog,
  copyText,
  downloadJson,
  downloadText,
  esc,
  formatDate,
  formatBytes,
  formatRelative,
  icon,
  renderDiff,
  toast,
} from '../ui.js';
import { requireConfig, sourceLabel } from './common.js';

function historyRow(entry, current) {
  const identical = entry.text === current.text;
  return `<article class="history-row" data-history-row="${esc(entry.id)}">
    <div class="history-main">
      <div class="history-title">
        <span class="pill tiny ${entry.source === 'service' ? 'accent' : entry.source === 'best-practice' ? 'violet' : ''}">${esc(sourceLabel(entry.source))}</span>
        <strong>${esc(entry.label || 'Configuration change')}</strong>
        ${identical ? '<span class="pill tiny ok">current</span>' : ''}
      </div>
      <p class="history-meta">${icon('clock')}${esc(formatRelative(entry.at))} · <span title="${esc(formatDate(entry.at))}">${esc(formatDate(entry.at))}</span> · ${esc(entry.filename || 'haproxy.cfg')} · ${entry.text.split('\n').length} lines · ${formatBytes(new Blob([entry.text]).size)}</p>
      ${entry.note ? `<p class="history-note">${esc(entry.note)}</p>` : ''}
    </div>
    <div class="history-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-view-diff="${esc(entry.id)}">${icon('code')}Diff</button>
      <button class="btn btn-ghost btn-sm" type="button" data-download="${esc(entry.id)}">${icon('download')}Download</button>
      <button class="btn btn-primary btn-sm" type="button" data-restore="${esc(entry.id)}" ${identical ? 'disabled' : ''}>${icon('history')}Restore</button>
    </div>
  </article>`;
}

export async function renderHistory(view) {
  const current = requireConfig(view, {
    title: 'No local configuration history yet',
    message: 'Import a configuration first. Every saved change is stored in this browser, up to 100 versions.',
  });
  if (!current) return null;

  const history = getHistory();
  const summary = storageSummary();
  const previous = history.find((entry) => entry.text !== current.text) || null;
  const shownHistory = history;

  view.innerHTML = `
    <header class="page-head history-head">
      <div class="page-head-copy">
        <span class="eyebrow">Local version history</span>
        <h1>Every change, on this device</h1>
        <p class="page-lede">Imports, manual saves, generated services and best-practice fixes create local snapshots. Compare any version with the current config and restore it in one click. Up to 100 versions are kept in this browser.</p>
        <div class="meta-strip">
          <span class="pill">${history.length}/100 versions</span>
          <span class="pill">${icon('lock')}localStorage only</span>
          <span class="pill">${formatBytes(summary.approxBytes)} used</span>
          <span class="pill">${esc(current.filename || 'haproxy.cfg')}</span>
        </div>
      </div>
      <div class="page-actions wrap">
        <button class="btn btn-ghost" type="button" data-action="export-history">${icon('download')}Export history</button>
        <button class="btn btn-ghost" type="button" data-action="clear-history" ${history.length ? '' : 'disabled'}>${icon('trash')}Clear history</button>
        <button class="btn btn-danger btn-ghost" type="button" data-action="clear-all">${icon('trash')}Clear all local data</button>
      </div>
    </header>

    <div class="callout info">${icon('shield')}<p><strong>Nothing here is on the server.</strong> History is serialized into this browser's localStorage. It can contain internal hostnames, IPs, certificate paths and routing policy. On a shared device, clear it when finished or use a private window. Never store private keys in a config.</p></div>

    <section class="current-version-card">
      <div class="current-icon">${icon('code')}</div>
      <div class="current-copy">
        <span class="eyebrow">Current configuration</span>
        <h2>${esc(current.label || 'Untitled configuration')}</h2>
        <p>${esc(current.filename || 'haproxy.cfg')} · saved ${esc(formatRelative(current.updatedAt))} · ${current.text.split('\n').length} lines</p>
      </div>
      <div class="current-actions">
        ${previous ? `<button class="btn btn-ghost" type="button" data-restore="${esc(previous.id)}">${icon('history')}Restore previous version</button>` : ''}
        <button class="btn btn-ghost" type="button" data-action="copy-current">${icon('copy')}Copy</button>
        <button class="btn btn-ghost" type="button" data-action="download-current">${icon('download')}Download</button>
        <a class="btn btn-primary" href="#/workbench">${icon('edit')}Edit current</a>
      </div>
    </section>

    <div class="section-head">
      <div><span class="eyebrow">Timeline</span><h2>Saved versions</h2></div>
      <p>Newest first. A restore creates a new snapshot, so no version disappears unexpectedly. When the cap is reached, the oldest snapshot is dropped.</p>
    </div>

    <div class="history-list">
      ${shownHistory.length ? shownHistory.map((entry) => historyRow(entry, current)).join('') : `<div class="empty-panel">${icon('history')}<h2>No snapshots yet</h2><p>The current configuration is not in history. Open the Workbench and save a version.</p></div>`}
    </div>

    <section class="history-diff-panel" data-history-diff hidden></section>
  `;

  const diffPanel = view.querySelector('[data-history-diff]');
  let selectedId = null;

  const showDiff = (id) => {
    const entry = history.find((item) => item.id === id);
    if (!entry) return;
    selectedId = id;
    const diff = diffLines(current.text, entry.text);
    diffPanel.hidden = false;
    diffPanel.innerHTML = `
      <div class="diff-panel-head">
        <div><span class="eyebrow">Comparison</span><h2>Current → ${esc(entry.label || 'snapshot')}</h2><p>${esc(formatDate(entry.at))} · +${diff.added} / −${diff.removed} lines</p></div>
        <div class="diff-panel-actions">
          <button class="btn btn-primary btn-sm" type="button" data-restore="${esc(entry.id)}" ${entry.text === current.text ? 'disabled' : ''}>${icon('history')}Restore this version</button>
          <button class="btn btn-ghost btn-sm" type="button" data-close-diff>Close</button>
        </div>
      </div>
      ${renderDiff(diff, { compact: true })}
      <p class="muted-note">A restore writes this snapshot as the current config and records a new history entry.</p>`;
    diffPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const restore = async (id) => {
    const entry = history.find((item) => item.id === id);
    if (!entry) return;
    if (entry.text === current.text) {
      toast('That version is already current.', { tone: 'neutral' });
      return;
    }
    const proceed = await confirmDialog({
      title: 'Restore this configuration?',
      message: 'The current config will be replaced in this browser. A new history entry is created so you can undo the restore.',
      confirmLabel: 'Restore version',
      details: [
        `Version: ${entry.label || 'snapshot'} (${formatDate(entry.at)})`,
        `Source: ${sourceLabel(entry.source)}`,
        `${entry.text.split('\n').length} lines.`,
      ],
    });
    if (!proceed) return;
    const result = commitConfig(entry.text, {
      filename: entry.filename || current.filename || 'haproxy.cfg',
      label: `Restored: ${entry.label || 'snapshot'}`,
      source: 'restore',
      note: `Restored snapshot from ${formatDate(entry.at)}.`,
    });
    if (!result.ok) {
      toast(result.error?.message || 'Could not restore that version.', { tone: 'danger' });
      return;
    }
    toast('Version restored. A new snapshot records the rollback.', { tone: 'ok' });
    window.dispatchEvent(new CustomEvent('workbench:reload'));
  };

  const onClick = async (event) => {
    const viewButton = event.target.closest('[data-view-diff]');
    if (viewButton) {
      showDiff(viewButton.dataset.viewDiff);
      return;
    }
    if (event.target.closest('[data-close-diff]')) {
      diffPanel.hidden = true;
      selectedId = null;
      return;
    }
    const restoreButton = event.target.closest('[data-restore]');
    if (restoreButton) {
      await restore(restoreButton.dataset.restore);
      return;
    }
    const downloadButton = event.target.closest('[data-download]');
    if (downloadButton) {
      const entry = getHistory().find((item) => item.id === downloadButton.dataset.download);
      if (!entry) return;
      const name = (entry.filename || 'haproxy.cfg').replace(/[^\w.-]+/g, '_');
      downloadText(name, entry.text);
      toast('Snapshot downloaded.', { tone: 'ok' });
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'copy-current') {
      copyText(current.text, 'Current configuration copied.');
    } else if (action === 'download-current') {
      downloadText((current.filename || 'haproxy.cfg').replace(/[^\w.-]+/g, '_'), current.text);
    } else if (action === 'export-history') {
      const exported = {
        app: 'HAProxy Workbench',
        exportedAt: new Date().toISOString(),
        note: 'Local browser export. May contain internal topology and paths. Store securely.',
        history: getHistory(),
      };
      downloadJson('haproxy-workbench-history.json', exported);
      toast('History exported locally as JSON.', { tone: 'ok' });
    } else if (action === 'clear-history') {
      const proceed = await confirmDialog({
        title: 'Clear all saved versions?',
        message: 'The current configuration stays, but every snapshot in this browser is deleted. This cannot be undone.',
        confirmLabel: 'Clear history',
        tone: 'danger',
      });
      if (!proceed) return;
      clearHistory();
      toast('Local version history cleared.', { tone: 'ok' });
      window.dispatchEvent(new CustomEvent('workbench:reload'));
    } else if (action === 'clear-all') {
      const proceed = await confirmDialog({
        title: 'Clear all local data?',
        message: 'This deletes the current configuration, every saved version and local settings from this browser. It does not affect any server.',
        confirmLabel: 'Delete everything',
        tone: 'danger',
        details: ['Export history first if you need a backup.', 'There is no server-side copy to recover from.'],
      });
      if (!proceed) return;
      clearAll();
      toast('All local workbench data cleared.', { tone: 'ok' });
      location.hash = '#/';
    }
  };
  view.addEventListener('click', onClick);

  return () => {
    view.removeEventListener('click', onClick);
  };
}
