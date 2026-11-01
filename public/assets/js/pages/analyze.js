import { CATEGORY_LABELS, analyzeConfig } from '../config/analyzer.js';
import {
  BEST_PRACTICE_FIXES,
  applyBestPracticeFixes,
  applyFindingFix,
  buildBestPracticeChecklist,
  canFixFinding,
} from '../config/bestpractices.js';
import { diffLines } from '../config/diff.js';
import { parseConfig } from '../config/parser.js';
import { commitConfig } from '../storage.js';
import { loadBuildInfo } from '../version.js';
import {
  SEVERITY,
  confirmDialog,
  downloadText,
  esc,
  formatDate,
  icon,
  renderConfigCompare,
  renderDiff,
  scoreGauge,
  severityPill,
  toast,
} from '../ui.js';
import { parseAndAnalyze, reloadRoute, requireConfig } from './common.js';

const STATUS = {
  pass: { label: 'Pass', tone: 'ok', icon: 'check' },
  warn: { label: 'Review', tone: 'warn', icon: 'warning' },
  fail: { label: 'Action needed', tone: 'danger', icon: 'error' },
  'n/a': { label: 'Not applicable', tone: 'neutral', icon: 'info' },
};

function findingCard(finding, index, model) {
  const severity = SEVERITY[finding.severity] || SEVERITY.info;
  const fixable = canFixFinding(model, finding);
  const lineLink = finding.line
    ? `<a class="line-link" href="#/workbench?line=${finding.line}">line ${finding.line} ${icon('arrow')}</a>`
    : '';
  const version = finding.versionImpact
    ? `<span class="pill tiny warn">affects ${esc(finding.versionImpact)}</span>`
    : '';
  return `<article class="finding-card" data-severity="${esc(finding.severity)}" data-category="${esc(finding.category)}" data-search="${esc(`${finding.title} ${finding.detail} ${finding.section} ${finding.fix} ${finding.category}`.toLowerCase())}">
    <div class="finding-top">
      ${severityPill(finding.severity)}
      <span class="finding-category">${esc(CATEGORY_LABELS[finding.category] || finding.category)}</span>
      ${finding.section ? `<span class="finding-section">${esc(finding.section)}</span>` : ''}
      ${version}
      <div class="finding-actions">
        ${fixable ? `<button class="btn btn-primary btn-sm" type="button" data-fix-finding="${index}" title="Preview a safe fix and compare the old and new configuration">${icon('save')}Fix this</button>` : ''}
        ${lineLink}
      </div>
    </div>
    <h3>${esc(finding.title)}</h3>
    <p>${esc(finding.detail)}</p>
    <details class="finding-more">
      <summary>Why it matters and how to fix it</summary>
      <div class="finding-more-body">
        <div><h4>Why</h4><p>${esc(finding.why || '')}</p></div>
        <div class="fix-box"><h4>${icon('check')}Recommendation</h4><p>${esc(finding.fix || '')}</p></div>
        ${finding.docs ? `<a class="learn-link" href="#/learn/${encodeURIComponent(finding.docs)}">Read the related guide ${icon('arrow')}</a>` : ''}
      </div>
    </details>
  </article>`;
}

function checklistHTML(checklist) {
  return `<div class="checklist">${checklist.map((item) => {
    const meta = STATUS[item.status] || STATUS['n/a'];
    return `<article class="check-item ${item.status}">
      <div class="check-icon ${meta.tone}">${icon(item.status === 'pass' ? 'check' : item.status === 'fail' ? 'error' : 'info')}</div>
      <div class="check-copy"><div class="check-title"><strong>${esc(item.title)}</strong><span class="pill ${meta.tone} tiny">${meta.label}</span></div><p>${esc(item.detail)}</p></div>
      ${item.action ? `<button class="btn btn-ghost btn-sm" type="button" data-check-action="${item.action.type}" ${item.action.id ? `data-fix-target="${esc(item.action.id)}"` : ''} ${item.action.type === 'versions' ? 'data-href="#/versions"' : ''}>${esc(item.action.label)}</button>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function fixesHTML(fixes) {
  return fixes.map((fix) => `
    <label class="fix-card ${fix.applies ? '' : 'disabled'}" data-fix-card="${fix.id}">
      <input type="checkbox" data-fix="${fix.id}" ${fix.applies ? 'checked' : 'disabled'}>
      <div class="fix-copy">
        <div class="fix-head">
          <h3>${esc(fix.title)}</h3>
          <span class="pill tiny ${fix.applies ? 'accent' : 'neutral'}">${fix.applies ? 'Available' : 'Already satisfied / N/A'}</span>
          <span class="pill tiny">${esc(fix.impact)}</span>
        </div>
        <p>${esc(fix.summary)}</p>
        <details><summary>Details and risk</summary><p>${esc(fix.detail)}</p><p class="risk-note">${icon('warning')}<span><strong>Risk:</strong> ${esc(fix.risk)}</span></p></details>
      </div>
    </label>`).join('');
}

function selectedFixes(view) {
  return [...view.querySelectorAll('[data-fix]:checked')].map((input) => input.dataset.fix);
}

function buildReport(current, model, analysis, checklist, info) {
  const lines = [
    '# HAProxy Workbench analysis',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Workbench version: ${info.version} (${info.imageTag})`,
    `- Commit: ${info.commit}`,
    `- File: ${current.filename || 'haproxy.cfg'}`,
    `- Configuration lines: ${model.stats.lines}`,
    `- Target guidance: HAProxy ${analysis.targetVersion} LTS`,
    `- Score: ${analysis.score}/100 (${analysis.grade})`,
    `- Findings: ${analysis.counts.error} errors, ${analysis.counts.warning} warnings, ${analysis.counts.recommendation} recommendations, ${analysis.counts.info} info`,
    '',
    '> This report was generated locally in a browser. The configuration was not uploaded. Validate with the exact target HAProxy binary before deployment.',
    '',
    '## Findings',
    '',
  ];
  if (analysis.findings.length === 0) lines.push('No findings were reported by the built-in analyzer.', '');
  analysis.findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`, '');
    lines.push(`- Category: ${CATEGORY_LABELS[finding.category] || finding.category}`);
    if (finding.section) lines.push(`- Section: ${finding.section}`);
    if (finding.line) lines.push(`- Line: ${finding.line}`);
    if (finding.versionImpact) lines.push(`- Version impact: ${finding.versionImpact}`);
    lines.push('', finding.detail, '', `**Why:** ${finding.why || ''}`, '', `**Fix:** ${finding.fix || ''}`, '');
  });
  lines.push('## Best-practice checklist', '');
  checklist.forEach((item) => {
    lines.push(`- [${item.status === 'pass' ? 'x' : ' '}] ${item.title} — ${item.detail}`);
  });
  lines.push('', '## Limitations', '', 'The parser and analyzer use a conservative subset of HAProxy. They do not execute HAProxy, resolve DNS, inspect certificates, validate Lua or model application semantics. Always run `haproxy -c -f` with the target binary and test in staging.', '');
  return lines.join('\n');
}

export async function renderAnalyze(view, query) {
  const current = requireConfig(view, {
    title: 'Import a configuration to analyze it',
    message: 'Analysis runs entirely in this browser. Import a config to receive warnings, security findings and best-practice guidance.',
  });
  if (!current) return null;

  const { model, analysis } = parseAndAnalyze(current);
  const checklist = buildBestPracticeChecklist(model, analysis);
  const fixes = BEST_PRACTICE_FIXES.map((fix) => ({ ...fix, applies: fix.applies(model) }));
  const initialTab = query.get('tab') === 'best-practices' ? 'best-practices' : 'findings';
  const initialSeverity = query.get('severity') || 'all';
  const info = await loadBuildInfo();
  const categories = Object.entries(analysis.categories).sort((a, b) => b[1] - a[1]);
  const stateLabel = analysis.counts.error > 0
    ? 'Blocking errors found'
    : analysis.counts.warning > 0
      ? 'Warnings need review'
      : analysis.counts.recommendation > 0
        ? 'Healthy, with recommendations'
        : 'No findings';

  view.innerHTML = `
    <header class="page-head analyze-head">
      <div class="page-head-copy">
        <span class="eyebrow">Analyze</span>
        <h1>${esc(current.label || current.filename || 'Configuration')}</h1>
        <p class="page-lede">A conservative safety review for HAProxy ${esc(analysis.targetVersion)}: TLS policy, timeouts, health checks, trust boundaries, deprecated syntax and version blockers.</p>
        <div class="meta-strip">
          <span class="pill">${icon('code')}${esc(current.filename || 'haproxy.cfg')}</span>
          <span class="pill">${model.stats.lines} lines</span>
          <span class="pill">target ${esc(analysis.targetVersion)} LTS</span>
          <span class="pill">saved ${esc(formatDate(current.updatedAt))}</span>
        </div>
      </div>
      <div class="page-actions wrap">
        <button class="btn btn-ghost" type="button" data-action="report">${icon('download')}Download report</button>
        <a class="btn btn-ghost" href="#/workbench">${icon('edit')}Workbench</a>
        <a class="btn btn-primary" href="#/services">${icon('plus')}Add service</a>
      </div>
    </header>

    <section class="score-panel">
      ${scoreGauge(analysis.score, analysis.grade)}
      <div class="score-copy">
        <span class="pill ${analysis.counts.error ? 'danger' : analysis.counts.warning ? 'warn' : 'ok'}">${esc(stateLabel)}</span>
        <h2>${analysis.findings.length} finding${analysis.findings.length === 1 ? '' : 's'} across ${Object.keys(analysis.categories).length} categories</h2>
        <p>The score is a triage aid, not a compliance certification. Errors usually prevent startup; warnings are likely production risks; recommendations are hardening opportunities.</p>
      </div>
      <div class="score-counts">
        <button type="button" class="score-count" data-set-severity="error"><strong>${analysis.counts.error}</strong><span>Errors</span></button>
        <button type="button" class="score-count" data-set-severity="warning"><strong>${analysis.counts.warning}</strong><span>Warnings</span></button>
        <button type="button" class="score-count" data-set-severity="recommendation"><strong>${analysis.counts.recommendation}</strong><span>Advice</span></button>
        <button type="button" class="score-count" data-set-severity="all"><strong>${analysis.findings.length}</strong><span>All</span></button>
      </div>
    </section>

    <div class="tabbar analyze-tabs" role="tablist" aria-label="Analysis views">
      <button class="tab" type="button" role="tab" data-analyze-tab="findings" aria-selected="${initialTab === 'findings'}">${icon('shield')}Findings <span class="tab-count">${analysis.findings.length}</span></button>
      <button class="tab" type="button" role="tab" data-analyze-tab="best-practices" aria-selected="${initialTab === 'best-practices'}">${icon('check')}Best practices <span class="tab-count">${checklist.filter((item) => item.status === 'pass').length}/${checklist.length}</span></button>
    </div>

    <section class="tab-panel" data-analyze-panel="findings" ${initialTab === 'findings' ? '' : 'hidden'}>
      <div class="filterbar">
        <label class="search-field">${icon('search')}<input type="search" placeholder="Search findings, sections or fixes…" data-finding-search aria-label="Search findings"></label>
        <div class="filter-chips" role="group" aria-label="Filter by severity">
          ${['all', 'error', 'warning', 'recommendation'].map((severity) => `<button class="chip ${initialSeverity === severity ? 'active' : ''}" type="button" data-filter-severity="${severity}">${severity === 'all' ? 'All' : severity === 'recommendation' ? 'Advice' : `${severity[0].toUpperCase()}${severity.slice(1)}s`}</button>`).join('')}
        </div>
        <select class="select" data-category-filter aria-label="Filter by category">
          <option value="all">All categories</option>
          ${categories.map(([category]) => `<option value="${esc(category)}">${esc(CATEGORY_LABELS[category] || category)} (${analysis.categories[category]})</option>`).join('')}
        </select>
        <span class="filter-result" data-filter-result>${analysis.findings.length} shown</span>
      </div>
      <div class="finding-list" data-finding-list>
        ${analysis.findings.length ? analysis.findings.map((finding, index) => findingCard(finding, index, model)).join('') : `<div class="empty-panel">${icon('check')}<h2>No findings</h2><p>The built-in analyzer found nothing in this configuration. That is unusual; still validate with <code>haproxy -c</code> and a staging test.</p></div>`}
      </div>
      <div class="empty-filter" data-finding-empty hidden>${icon('search')}No findings match the current filter.</div>
      <div class="callout info analyze-disclaimer">${icon('info')}<p><strong>What this does not do:</strong> it does not execute HAProxy, resolve DNS, read certificate files, validate Lua or know your application’s semantics. Use <code>haproxy -c -f</code> with the target binary and test in staging.</p></div>
    </section>

    <section class="tab-panel" data-analyze-panel="best-practices" ${initialTab === 'best-practices' ? '' : 'hidden'}>
      <div class="section-head"><div><span class="eyebrow">Review</span><h2>Best-practice checklist</h2></div><p>Pass/fail is based on the parsed configuration. Environment-specific choices such as logging destinations and maxconn sizing remain manual.</p></div>
      ${checklistHTML(checklist)}

      <div class="section-head fix-heading"><div><span class="eyebrow">Implement</span><h2>Opt-in configuration fixes</h2></div><p>These transformations are deterministic and previewed as a diff. Nothing is applied until you approve it.</p></div>
      <div class="fix-list">${fixesHTML(fixes)}</div>
      <div class="fix-actions">
        <button class="btn btn-primary" type="button" data-action="preview-fixes">${icon('arrow')}Preview selected fixes</button>
        <span class="muted-note">${selectedFixes(view).length || fixes.filter((fix) => fix.applies).length} available fix(es).</span>
      </div>
      <div class="fix-preview" data-fix-preview hidden></div>
      <div class="callout warn">${icon('warning')}<p><strong>Review, then validate.</strong> Automated fixes can change runtime behaviour. Save the version, download the diff if needed, and run the target HAProxy binary before deploying. History keeps the previous version.</p></div>
    </section>
  `;

  let activeSeverity = initialSeverity;
  let activeCategory = 'all';
  let search = '';
  let pendingFix = null;

  const setTab = (tab) => {
    view.querySelectorAll('[data-analyze-tab]').forEach((button) => {
      button.setAttribute('aria-selected', button.dataset.analyzeTab === tab ? 'true' : 'false');
    });
    view.querySelectorAll('[data-analyze-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.analyzePanel !== tab;
    });
    const url = new URL(location.href);
    const [path] = url.hash.split('?');
    url.hash = `${path.split('?')[0]}?tab=${tab}`;
    history.replaceState(null, '', url);
  };

  const applyFilters = () => {
    const cards = [...view.querySelectorAll('.finding-card')];
    let shown = 0;
    cards.forEach((card) => {
      const visible = (!search || card.dataset.search.includes(search))
        && (activeSeverity === 'all' || card.dataset.severity === activeSeverity)
        && (activeCategory === 'all' || card.dataset.category === activeCategory);
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    const result = view.querySelector('[data-filter-result]');
    if (result) result.textContent = `${shown} shown`;
    const empty = view.querySelector('[data-finding-empty]');
    if (empty) empty.hidden = shown > 0 || cards.length === 0;
    view.querySelectorAll('[data-filter-severity]').forEach((button) => {
      button.classList.toggle('active', button.dataset.filterSeverity === activeSeverity);
    });
    view.querySelectorAll('[data-set-severity]').forEach((button) => {
      button.classList.toggle('active', button.dataset.setSeverity === activeSeverity);
    });
  };

  const setSeverity = (severity) => {
    activeSeverity = severity;
    applyFilters();
  };

  view.querySelectorAll('[data-set-severity]').forEach((button) => {
    button.addEventListener('click', () => {
      setTab('findings');
      setSeverity(button.dataset.setSeverity);
    });
  });
  view.querySelectorAll('[data-filter-severity]').forEach((button) => {
    button.addEventListener('click', () => setSeverity(button.dataset.filterSeverity));
  });
  view.querySelector('[data-finding-search]')?.addEventListener('input', (event) => {
    search = event.target.value.trim().toLowerCase();
    applyFilters();
  });
  view.querySelector('[data-category-filter]')?.addEventListener('change', (event) => {
    activeCategory = event.target.value;
    applyFilters();
  });
  view.querySelectorAll('[data-analyze-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.analyzeTab));
  });
  applyFilters();

  const openFindingFix = (finding) => {
    const result = applyFindingFix(current.text, finding);
    if (!result.applied.length) {
      toast('No safe automatic fix could be applied to this finding. Use the recommendation as a manual change.', { tone: 'neutral', duration: 5500 });
      return;
    }
    const proposedModel = parseConfig(result.text);
    const proposedAnalysis = analyzeConfig(proposedModel);
    const diff = diffLines(current.text, result.text);
    const appliedFixes = result.applied
      .map((item) => BEST_PRACTICE_FIXES.find((fix) => fix.id === item.id))
      .filter(Boolean);
    const risks = [...new Set(appliedFixes.map((fix) => fix.risk).filter(Boolean))];
    const errorIncrease = proposedAnalysis.counts.error > analysis.counts.error;

    const dialog = document.createElement('dialog');
    dialog.className = 'modal fix-preview-modal';
    dialog.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <span class="pill accent">${icon('save')}Safe automatic fix</span>
          <h2>Fix: ${esc(finding.title)}</h2>
          <p class="modal-lede">${esc(finding.detail)}</p>
        </div>
        <div class="fix-impact">
          <span class="pill">Score ${analysis.score} → <strong>${proposedAnalysis.score}</strong></span>
          <span class="pill ${proposedAnalysis.counts.error ? 'danger' : 'ok'}">${proposedAnalysis.counts.error} errors</span>
          <span class="pill ${proposedAnalysis.counts.warning ? 'warn' : 'ok'}">${proposedAnalysis.counts.warning} warnings</span>
          <span class="pill neutral">${diff.added} added / ${diff.removed} removed</span>
        </div>
        <ul class="applied-list">${result.applied.map((item) => `<li>${icon('check')}<span><strong>${esc(item.title)}</strong> — ${esc(item.summary)}</span></li>`).join('')}</ul>
        ${errorIncrease ? `<div class="callout danger">${icon('warning')}<p><strong>Do not apply this automatically.</strong> The proposed config contains more errors than the current one. Review the diff and fix it manually.</p></div>` : ''}
        <div class="section-head small"><div><span class="eyebrow">Review</span><h3>Old vs new fixed configuration</h3></div><p>Both versions are shown in full. The old version remains in local history after applying.</p></div>
        ${renderConfigCompare(current.text, result.text, { newLabel: 'New fixed configuration' })}
        <details class="fix-details"><summary>Show exact line diff (+${diff.added} / −${diff.removed})</summary>${renderDiff(diff, { compact: true })}</details>
        ${risks.length ? `<div class="callout warn fix-risk">${icon('warning')}<div><strong>Risk to review</strong><ul>${risks.map((risk) => `<li>${esc(risk)}</li>`).join('')}</ul></div></div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="cancel-finding-fix">Cancel</button>
          <button class="btn btn-primary" type="button" data-action="apply-finding-fix" ${errorIncrease ? 'disabled' : ''}>${icon('save')}Apply fix and save version</button>
        </div>
      </div>`;
    document.body.append(dialog);

    const close = () => {
      if (dialog.open) dialog.close();
    };
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="cancel-finding-fix"]') || event.target === dialog) {
        close();
        return;
      }
      if (event.target.closest('[data-action="apply-finding-fix"]')) {
        const committed = commitConfig(result.text, {
          filename: current.filename || 'haproxy.cfg',
          label: `Fixed: ${finding.title}`,
          source: 'finding-fix',
          note: result.applied.map((item) => item.summary).join(' '),
        });
        if (!committed.ok) {
          toast(committed.error?.message || 'Could not save the fixed configuration.', { tone: 'danger' });
          return;
        }
        close();
        toast('Warning fixed and saved as a new local version. The old version remains in History.', { tone: 'ok' });
        reloadRoute();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };

  view.querySelector('[data-finding-list]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-fix-finding]');
    if (!button) return;
    const finding = analysis.findings[Number(button.dataset.fixFinding)];
    if (finding) openFindingFix(finding);
  });

  const updateFixCount = () => {
    const count = selectedFixes(view).length;
    const label = view.querySelector('.fix-actions .muted-note');
    if (label) label.textContent = `${count} selected fix(es).`;
  };
  view.querySelectorAll('[data-fix]').forEach((input) => input.addEventListener('change', updateFixCount));
  updateFixCount();

  const previewFixes = () => {
    const ids = selectedFixes(view);
    if (ids.length === 0) {
      toast('Select at least one fix to preview.', { tone: 'neutral' });
      return;
    }
    const result = applyBestPracticeFixes(current.text, ids);
    if (!result.applied.length) {
      toast('The selected fixes are already satisfied or not applicable.', { tone: 'neutral' });
      return;
    }
    const proposedModel = parseConfig(result.text);
    const proposedAnalysis = analyzeConfig(proposedModel);
    const diff = diffLines(current.text, result.text);
    pendingFix = { ...result, proposedModel, proposedAnalysis };
    const preview = view.querySelector('[data-fix-preview]');
    preview.hidden = false;
    preview.innerHTML = `
      <div class="fix-preview-head">
        <div><span class="eyebrow">Proposed change</span><h2>${result.applied.length} fix${result.applied.length === 1 ? '' : 'es'} ready</h2></div>
        <div class="fix-delta">
          <span class="pill">Score ${analysis.score} → <strong>${proposedAnalysis.score}</strong></span>
          <span class="pill ${proposedAnalysis.counts.error ? 'danger' : 'ok'}">${proposedAnalysis.counts.error} errors</span>
          <span class="pill ${proposedAnalysis.counts.warning ? 'warn' : 'ok'}">${proposedAnalysis.counts.warning} warnings</span>
        </div>
      </div>
      <ul class="applied-list">${result.applied.map((item) => `<li>${icon('check')}${esc(item.summary)}</li>`).join('')}</ul>
      ${proposedAnalysis.counts.error > analysis.counts.error ? `<div class="callout danger">${icon('warning')}<p>The proposed configuration produces <strong>more errors</strong> than the current one. Review the diff carefully and do not apply it.</p></div>` : ''}
      <div class="section-head small"><div><span class="eyebrow">Review</span><h3>Old vs new fixed configuration</h3></div><p>Full source before and after the selected fixes.</p></div>
      ${renderConfigCompare(current.text, result.text, { newLabel: 'New fixed configuration' })}
      <details class="fix-details"><summary>Show exact line diff (+${diff.added} / −${diff.removed})</summary>${renderDiff(diff, { compact: true })}</details>
      <div class="fix-apply-row">
        <button class="btn btn-primary" type="button" data-action="apply-fixes">${icon('save')}Apply and save version</button>
        <button class="btn btn-ghost" type="button" data-action="cancel-fixes">Cancel</button>
        <span class="muted-note">Saves to local history first. The previous version remains available.</span>
      </div>`;
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  view.querySelector('[data-action="preview-fixes"]')?.addEventListener('click', previewFixes);
  view.querySelector('[data-fix-preview]')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action="cancel-fixes"]')) {
      pendingFix = null;
      const preview = view.querySelector('[data-fix-preview]');
      preview.hidden = true;
      preview.innerHTML = '';
      return;
    }
    if (event.target.closest('[data-action="apply-fixes"]') && pendingFix) {
      const proceed = await confirmDialog({
        title: 'Apply best-practice fixes?',
        message: 'This creates a new local version. Download and validate the configuration with the target HAProxy binary before deploying.',
        confirmLabel: 'Apply and save',
        details: [
          `${pendingFix.applied.length} automated change(s) will be written.`,
          `Score ${analysis.score} → ${pendingFix.proposedAnalysis.score}.`,
          'The previous version stays in History.',
        ],
        tone: pendingFix.proposedAnalysis.counts.error > analysis.counts.error ? 'danger' : 'primary',
      });
      if (!proceed) return;
      const result = commitConfig(pendingFix.text, {
        filename: current.filename || 'haproxy.cfg',
        label: `Applied best practices: ${pendingFix.applied.map((item) => item.title).join(', ')}`,
        source: 'best-practice',
        note: pendingFix.applied.map((item) => item.summary).join(' '),
      });
      if (!result.ok) {
        toast(result.error?.message || 'Could not save the fixed configuration.', { tone: 'danger' });
        return;
      }
      toast('Fixes saved as a new local version.', { tone: 'ok' });
      reloadRoute();
      location.hash = '#/analyze?tab=best-practices';
    }
  });

  view.querySelectorAll('[data-check-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.checkAction;
      if (type === 'fix') {
        const target = button.dataset.fixTarget;
        const input = view.querySelector(`[data-fix="${target}"]`);
        if (input && !input.disabled) {
          input.checked = true;
          updateFixCount();
          input.closest('.fix-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast('Fix selected. Scroll down to preview it.', { tone: 'ok' });
        } else {
          toast('That fix is already satisfied or not applicable.', { tone: 'neutral' });
        }
      } else if (type === 'versions') {
        location.hash = '#/versions';
      } else if (type === 'analyze') {
        setTab('findings');
        setSeverity('error');
      }
    });
  });

  view.querySelector('[data-action="report"]')?.addEventListener('click', () => {
    const report = buildReport(current, model, analysis, checklist, info);
    const base = (current.filename || 'haproxy').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    downloadText(`${base}-analysis.md`, report, 'text/markdown;charset=utf-8');
    toast('Analysis report downloaded. It contains no configuration text.', { tone: 'ok' });
  });

  return null;
}
