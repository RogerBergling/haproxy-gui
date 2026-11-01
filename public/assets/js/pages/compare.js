import { analyzeConfig } from '../config/analyzer.js';
import { diffLines } from '../config/diff.js';
import { parseConfig } from '../config/parser.js';
import { getCurrent } from '../storage.js';
import {
  esc,
  icon,
  readConfigFile,
  renderConfigCompare,
  renderDiff,
  toast,
} from '../ui.js';

function sourcePanel(side, title, description) {
  return `<section class="file-source" data-file-panel="${side}">
    <div class="file-source-head">
      <div><span class="eyebrow">File ${side.toUpperCase()}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div>
      <span class="pill neutral" data-file-name="${side}">No file loaded</span>
    </div>
    <div class="file-source-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-file-pick="${side}">${icon('upload')}Choose file</button>
      <button class="btn btn-ghost btn-sm" type="button" data-file-current="${side}">${icon('code')}Use current</button>
      <input type="file" accept=".cfg,.conf,.txt,text/plain" class="visually-hidden" data-file-input="${side}">
    </div>
    <label class="file-drop" data-file-drop="${side}">
      <span>${icon('upload')}</span>
      <strong>Drop a config file here</strong>
      <small>or paste into the editor below. Files are read locally.</small>
    </label>
    <textarea class="file-text" data-file-text="${side}" rows="12" spellcheck="false" placeholder="Paste HAProxy configuration…"></textarea>
  </section>`;
}

function analysisSummary(text) {
  const model = parseConfig(text);
  const analysis = analyzeConfig(model);
  return { model, analysis };
}

export async function renderCompare(view) {
  const current = getCurrent();
  view.innerHTML = `
    <header class="page-head compare-head">
      <div class="page-head-copy">
        <span class="eyebrow">File comparison</span>
        <h1>Compare two HAProxy files.</h1>
        <p class="page-lede">Load a baseline and a candidate. Review both complete files, the exact line diff and the analyzer result before you replace anything. No file is uploaded or saved to the server.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" type="button" data-action="clear-files">${icon('trash')}Clear both</button>
        <button class="btn btn-primary" type="button" data-action="run-file-compare">${icon('code')}Compare files</button>
      </div>
    </header>

    <div class="file-compare-grid">
      ${sourcePanel('a', 'Baseline', 'The old or currently deployed configuration.')}
      ${sourcePanel('b', 'Candidate', 'The proposed replacement configuration.')}
    </div>

    <div class="privacy-inline">${icon('lock')}Both files are read by this browser tab only. Nothing is sent to the server.</div>
    <section class="file-compare-output" data-file-compare-output>
      <div class="empty-panel">${icon('code')}<h2>Load two files to compare</h2><p>Choose or drop a file on each side, or paste the configuration text directly.</p></div>
    </section>
  `;

  const panels = {
    a: {
      text: view.querySelector('[data-file-text="a"]'),
      name: view.querySelector('[data-file-name="a"]'),
      input: view.querySelector('[data-file-input="a"]'),
      drop: view.querySelector('[data-file-drop="a"]'),
    },
    b: {
      text: view.querySelector('[data-file-text="b"]'),
      name: view.querySelector('[data-file-name="b"]'),
      input: view.querySelector('[data-file-input="b"]'),
      drop: view.querySelector('[data-file-drop="b"]'),
    },
  };

  const setName = (side, name) => {
    const pill = panels[side].name;
    if (!pill) return;
    pill.textContent = name || 'Pasted configuration';
    pill.classList.toggle('accent', Boolean(name || panels[side].text.value.trim()));
  };

  const loadSide = async (side, file) => {
    const result = await readConfigFile(file);
    if (result.error) {
      toast(result.error, { tone: 'danger', duration: 6000 });
      return;
    }
    panels[side].text.value = result.text;
    setName(side, result.filename);
    toast(`File ${side.toUpperCase()} loaded locally.`, { tone: 'ok' });
  };

  for (const side of ['a', 'b']) {
    const panel = panels[side];
    view.querySelector(`[data-file-pick="${side}"]`)?.addEventListener('click', () => panel.input.click());
    panel.input?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) loadSide(side, file);
    });
    view.querySelector(`[data-file-current="${side}"]`)?.addEventListener('click', () => {
      if (!current) {
        toast('There is no current configuration in this browser.', { tone: 'neutral' });
        return;
      }
      panel.text.value = current.text;
      setName(side, current.filename || 'Current configuration');
      toast(`File ${side.toUpperCase()} filled from the current configuration.`, { tone: 'ok' });
    });
    panel.text?.addEventListener('input', () => setName(side, panel.text.value.trim() ? 'Pasted configuration' : ''));
    panel.drop?.addEventListener('click', () => panel.input.click());
    panel.drop?.addEventListener('dragover', (event) => {
      event.preventDefault();
      panel.drop.classList.add('dragging');
    });
    panel.drop?.addEventListener('dragleave', () => panel.drop.classList.remove('dragging'));
    panel.drop?.addEventListener('drop', (event) => {
      event.preventDefault();
      panel.drop.classList.remove('dragging');
      const file = event.dataTransfer?.files?.[0];
      if (file) loadSide(side, file);
    });
  }

  const renderComparison = () => {
    const textA = panels.a.text.value;
    const textB = panels.b.text.value;
    if (!textA.trim() || !textB.trim()) {
      toast('Load both files before comparing.', { tone: 'neutral' });
      return;
    }
    const a = analysisSummary(textA);
    const b = analysisSummary(textB);
    const diff = diffLines(textA, textB);
    const output = view.querySelector('[data-file-compare-output]');
    output.innerHTML = `
      <div class="file-compare-summary">
        <div class="compare-file-stat"><span>File A</span><strong>${esc(panels.a.name.textContent)}</strong><small>${a.model.stats.lines} lines · ${a.model.stats.frontends + a.model.stats.listens} frontend(s) · score ${a.analysis.score} (${a.analysis.grade})</small></div>
        <div class="compare-delta ${diff.changed ? 'changed' : 'same'}"><strong>${diff.changed ? `+${diff.added} / −${diff.removed}` : 'Identical'}</strong><span>${diff.changed ? 'line changes' : 'no line changes'}</span></div>
        <div class="compare-file-stat"><span>File B</span><strong>${esc(panels.b.name.textContent)}</strong><small>${b.model.stats.lines} lines · ${b.model.stats.frontends + b.model.stats.listens} frontend(s) · score ${b.analysis.score} (${b.analysis.grade})</small></div>
      </div>
      <div class="file-compare-analysis">
        <span class="pill ${a.analysis.counts.error ? 'danger' : a.analysis.counts.warning ? 'warn' : 'ok'}">A: ${a.analysis.counts.error} errors · ${a.analysis.counts.warning} warnings</span>
        <span class="pill ${b.analysis.counts.error ? 'danger' : b.analysis.counts.warning ? 'warn' : 'ok'}">B: ${b.analysis.counts.error} errors · ${b.analysis.counts.warning} warnings</span>
        <span class="pill ${diff.changed ? 'accent' : 'ok'}">${diff.changed ? 'Files differ' : 'Files match'}</span>
      </div>
      <div class="section-head small"><div><span class="eyebrow">Side by side</span><h3>Old vs new file</h3></div><p>Both complete configurations, with independent scrolling.</p></div>
      ${renderConfigCompare(textA, textB, { oldLabel: panels.a.name.textContent, newLabel: panels.b.name.textContent })}
      <details class="fix-details" open><summary>Exact line diff (+${diff.added} / −${diff.removed})</summary>${renderDiff(diff, { compact: true })}</details>
      <div class="callout warn">${icon('warning')}<p>Use at your own risk. This comparison does not validate HAProxy semantics. Run <code>haproxy -c -f</code> with the target binary and test in staging before deploying either file.</p></div>`;
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  view.querySelector('[data-action="run-file-compare"]')?.addEventListener('click', renderComparison);
  view.querySelector('[data-action="clear-files"]')?.addEventListener('click', () => {
    panels.a.text.value = '';
    panels.b.text.value = '';
    setName('a', '');
    setName('b', '');
    view.querySelector('[data-file-compare-output]').innerHTML = `<div class="empty-panel">${icon('code')}<h2>Load two files to compare</h2><p>Choose or drop a file on each side, or paste the configuration text directly.</p></div>`;
  });

  return null;
}
