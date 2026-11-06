import { CATEGORY_LABELS, analyzeConfig } from '../config/analyzer.js';
import {
  BEST_PRACTICE_FIXES,
  applyBestPracticeFixes,
  applyFindingFix,
  applyHttpHealthCheck,
  bareHttpCheckBackends,
  buildBestPracticeChecklist,
  canFixFinding,
  effectiveHttpCheck,
  isBareHttpCheckBackend,
  validateHttpHealthCheckOptions,
} from '../config/bestpractices.js';
import { diffLines } from '../config/diff.js';
import { effectiveTimeout, parseConfig } from '../config/parser.js';
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
  const backendName = finding.backend || null;
  const guided = Boolean(backendName && isBareHttpCheckBackend(model, backendName));
  const collapsedGuided = !backendName && Array.isArray(finding.backends)
    && finding.backends.some((name) => isBareHttpCheckBackend(model, name));
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
        ${guided ? `<button class="btn btn-primary btn-sm" type="button" data-configure-http-check="${esc(backendName)}" title="Open the guided HTTP health-check editor">${icon('warning')}Configure check</button>` : ''}
        ${collapsedGuided ? `<button class="btn btn-primary btn-sm" type="button" data-open-http-checks title="Open the guided HTTP health-check section">${icon('warning')}Configure HTTP checks</button>` : ''}
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
          ${fix.requiresAcknowledgement ? '<span class="pill tiny warn">Review required</span>' : ''}
        </div>
        <p>${esc(fix.summary)}</p>
        <details><summary>Do I need this? What you need to know</summary><p>${esc(fix.detail)}</p><p class="risk-note">${icon('warning')}<span><strong>Risk:</strong> ${esc(fix.risk)}</span></p></details>
      </div>
    </label>`).join('');
}

function httpCheckCandidatesHTML(backends) {
  if (backends.length === 0) return '';
  return `
    <div class="section-head fix-heading"><div><span class="eyebrow">HTTP checks</span><h2>Backends that need an explicit health endpoint</h2></div><p>Bare <code>option httpchk</code> sends <code>OPTIONS / HTTP/1.0</code>. Configure a real request before enabling <code>check</code>.</p></div>
    <div class="fix-list">${backends.map((backend) => {
      const checked = backend.servers.filter((server) => server.flags.has('check')).length;
      const single = backend.servers.length === 1;
      return `<article class="fix-card" data-http-check-card="${esc(backend.name)}">
        <div class="fix-copy">
          <div class="fix-head">
            <h3>${esc(backend.name)}</h3>
            <span class="pill tiny warn">Needs explicit endpoint</span>
            <span class="pill tiny">${backend.servers.length} server${backend.servers.length === 1 ? '' : 's'}</span>
            ${single ? '<span class="pill tiny danger">Single server</span>' : ''}
          </div>
          <p><code>option httpchk</code> currently sends <code>OPTIONS /</code>. ${checked > 0 ? `${checked} server${checked === 1 ? '' : 's'} already have <code>check</code>.` : 'No server has <code>check</code> yet.'}</p>
          <button class="btn btn-primary btn-sm" type="button" data-configure-http-check="${esc(backend.name)}">${icon('save')}Configure health check</button>
        </div>
      </article>`;
    }).join('')}</div>`;
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
  const httpCheckCandidates = bareHttpCheckBackends(model);
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

      ${httpCheckCandidatesHTML(httpCheckCandidates)}

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
        ${risks.length ? `<div class="callout warn fix-risk">${icon('warning')}<div><strong>What you need to know</strong><ul>${risks.map((risk) => `<li>${esc(risk)}</li>`).join('')}</ul></div></div>` : ''}
        <label class="checkbox-field modal-ack"><input type="checkbox" data-finding-ack><span>I understand this change can affect production traffic. I will validate the result with <code>haproxy -c</code> and staging before deployment.</span></label>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="cancel-finding-fix">Cancel</button>
          <button class="btn btn-primary" type="button" data-action="apply-finding-fix" disabled>${icon('save')}Apply fix and save version</button>
        </div>
      </div>`;
    document.body.append(dialog);

    const close = () => {
      if (dialog.open) dialog.close();
    };
    const findingAck = dialog.querySelector('[data-finding-ack]');
    const findingApply = dialog.querySelector('[data-action="apply-finding-fix"]');
    findingAck?.addEventListener('change', () => {
      if (findingApply) findingApply.disabled = !findingAck.checked || errorIncrease;
    });
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="cancel-finding-fix"]') || event.target === dialog) {
        close();
        return;
      }
      if (event.target.closest('[data-action="apply-finding-fix"]')) {
        if (!findingAck?.checked || errorIncrease) return;
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

  const openHttpCheckEditor = (backendName) => {
    const backend = model.backends.find((entry) => entry.name === backendName);
    if (!backend) {
      toast('The selected backend no longer exists. Reload and try again.', { tone: 'danger' });
      return;
    }
    if (backend.servers.length === 0) {
      toast('This backend has no servers, so there is nothing to check.', { tone: 'neutral' });
      return;
    }

    const single = backend.servers.length === 1;
    const checkedCount = backend.servers.filter((server) => server.flags.has('check')).length;
    const tlsCount = backend.servers.filter((server) => server.flags.has('ssl')).length;
    const currentHttpchk = effectiveHttpCheck(model, backend);
    const directHttpchk = currentHttpchk && backend.items.includes(currentHttpchk);
    const directTimeout = backend.items.find(
      (item) => item.keyword === 'timeout' && item.timeoutName === 'check',
    );
    const inheritedTimeout = effectiveTimeout(model, backend, 'check');
    const timeoutValue = directTimeout?.timeoutValue || inheritedTimeout?.timeoutValue || '3s';
    const timeoutLocked = Boolean(directTimeout);
    const currentLabel = currentHttpchk
      ? `${currentHttpchk.raw.trim()}${directHttpchk ? '' : ' (inherited from defaults)'}`
      : 'No option httpchk configured';

    const dialog = document.createElement('dialog');
    dialog.className = 'modal fix-preview-modal health-check-modal';
    dialog.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <span class="pill accent">${icon('save')}HTTP health check</span>
          <h2>Configure a safe check for <code>${esc(backend.name)}</code></h2>
          <p class="modal-lede">Do you want HAProxy to actively probe this backend? This editor replaces the bare <code>option httpchk</code> with an explicit request and adds <code>check</code> only to servers that do not already have it.</p>
        </div>
        <div class="fix-impact">
          <span class="pill">${backend.servers.length} server${backend.servers.length === 1 ? '' : 's'}</span>
          <span class="pill ${checkedCount > 0 ? 'ok' : 'warn'}">${checkedCount} already checked</span>
          ${single ? '<span class="pill danger">Single server: false positive = outage</span>' : ''}
          ${tlsCount > 0 ? `<span class="pill warn">${tlsCount} TLS server${tlsCount === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${single ? `<div class="callout danger">${icon('warning')}<p><strong>This backend has only one server.</strong> After <code>fall</code> consecutive failures HAProxy removes it from rotation, so a false positive causes a full outage. Use an endpoint that is cheap, reliable and safe to call every few seconds.</p></div>` : ''}
        <div class="callout info">${icon('info')}<p><strong>Current configuration:</strong> <code>${esc(currentLabel)}</code></p></div>
        <form class="form-grid" data-http-check-form autocomplete="off">
          <label class="field"><span>Method</span><select name="method">${['GET', 'HEAD', 'OPTIONS'].map((method) => `<option value="${method}" ${method === 'GET' ? 'selected' : ''}>${method}</option>`).join('')}</select><small>Use GET or HEAD for most application endpoints.</small></label>
          <label class="field"><span>Path</span><input name="uri" value="/health" placeholder="/health"><small>Must be a real endpoint on every server in this backend.</small></label>
          <label class="field"><span>Expected status</span><input name="status" value="200" inputmode="numeric" placeholder="200"><small>For example 200, 204 or 200-299.</small></label>
          <label class="field"><span>Host header (optional)</span><input name="host" placeholder="app.example.com"><small>Set this when the app routes by virtual host.</small></label>
          <label class="field"><span>Interval (<code>inter</code>)</span><input name="inter" value="5s" placeholder="5s"><small>Time between probes. 5s is a safer starting point than 2s.</small></label>
          <label class="field"><span>Fall</span><input name="fall" value="3" type="number" min="1"><small>Consecutive failures before DOWN.</small></label>
          <label class="field"><span>Rise</span><input name="rise" value="3" type="number" min="1"><small>Consecutive successes before UP.</small></label>
          <label class="field"><span>Check timeout</span><input name="timeoutCheck" value="${esc(timeoutValue)}" ${timeoutLocked ? 'disabled' : ''}><small>${timeoutLocked ? 'This backend already sets timeout check; it will not be changed.' : 'Added as an explicit backend timeout check.'}</small></label>
          ${tlsCount > 0 ? `<label class="checkbox-field span-2"><input type="checkbox" name="checkSsl" checked><span>Use TLS for health checks on servers marked <code>ssl</code></span><small>Adds <code>check-ssl</code> to newly checked TLS servers. Verify SNI and certificate validation separately.</small></label>` : ''}
        </form>
        <div class="callout warn">${icon('warning')}<div><strong>What you need to know</strong><ul>
          <li>HAProxy sends the request every <code>inter</code>. Only the expected status counts as healthy.</li>
          <li>A 401, 403, 404 or 405 response is a failed check. Do not point this at an authenticated page or a heavy home page.</li>
          <li>The endpoint should be cheap, side-effect free and not depend on a fragile downstream service unless that is your intended readiness definition.</li>
          <li>After <code>fall</code> consecutive failures the server is marked DOWN. Existing connections usually continue; new traffic moves to the remaining servers.</li>
          <li>Validate with <code>haproxy -c -f</code> and test the exact request with curl from the HAProxy host before deploying.</li>
        </ul></div></div>
        <div data-http-check-errors></div>
        <div class="section-head small"><div><span class="eyebrow">Preview</span><h3>Generated directives</h3></div><p>Nothing is saved until you apply.</p></div>
        <pre class="health-check-preview" data-http-check-preview></pre>
        <label class="checkbox-field modal-ack"><input type="checkbox" data-http-check-ack><span>${single ? 'I understand this backend has only one server, so a false positive will cause a full outage. I have tested the endpoint and timing.' : 'I understand a failed check removes servers from rotation. I have tested the endpoint and timing.'}</span></label>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="cancel-http-check">Cancel</button>
          <button class="btn btn-primary" type="button" data-action="apply-http-check" disabled>${icon('save')}Apply and save version</button>
        </div>
      </div>`;
    document.body.append(dialog);

    const form = dialog.querySelector('[data-http-check-form]');
    const preview = dialog.querySelector('[data-http-check-preview]');
    const errorBox = dialog.querySelector('[data-http-check-errors]');
    const acknowledgement = dialog.querySelector('[data-http-check-ack]');
    const applyButton = dialog.querySelector('[data-action="apply-http-check"]');

    const readOptions = () => {
      const data = new FormData(form);
      return {
        method: String(data.get('method') || 'GET'),
        uri: String(data.get('uri') || '').trim(),
        status: String(data.get('status') || '').trim(),
        host: String(data.get('host') || '').trim(),
        inter: String(data.get('inter') || '').trim(),
        fall: String(data.get('fall') || '').trim(),
        rise: String(data.get('rise') || '').trim(),
        timeoutCheck: String(form.querySelector('[name="timeoutCheck"]')?.value || '').trim(),
        checkSsl: Boolean(form.querySelector('[name="checkSsl"]')?.checked),
      };
    };

    const refresh = () => {
      const options = readOptions();
      const validationErrors = validateHttpHealthCheckOptions(options);
      const result = validationErrors.length
        ? null
        : applyHttpHealthCheck(current.text, model, backendName, { ...options, stamp: false });
      const errors = validationErrors.length ? validationErrors : (result?.errors || []);
      const proposedModel = result && errors.length === 0 ? parseConfig(result.text) : null;
      const proposedAnalysis = proposedModel ? analyzeConfig(proposedModel) : null;
      const errorIncrease = proposedAnalysis
        ? proposedAnalysis.counts.error > analysis.counts.error
        : false;
      const messages = [...errors];
      if (errorIncrease) {
        messages.push('The proposed configuration has more errors than the current one. Fix it manually before applying.');
      }
      errorBox.innerHTML = messages.length
        ? `<div class="callout danger">${icon('warning')}<div><strong>Review before applying</strong><ul>${messages.map((message) => `<li>${esc(message)}</li>`).join('')}</ul></div></div>`
        : '';
      if (result && errors.length === 0) {
        const diff = diffLines(current.text, result.text);
        const removed = diff.rows.filter((row) => row.type === 'del').map((row) => `- ${row.text}`);
        const added = diff.rows.filter((row) => row.type === 'add').map((row) => `+ ${row.text}`);
        preview.textContent = [...removed, ...added].join('\n') || result.summary;
      } else {
        preview.textContent = '';
      }
      applyButton.disabled = !acknowledgement.checked || messages.length > 0;
    };

    const close = () => {
      if (dialog.open) dialog.close();
    };
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    acknowledgement.addEventListener('change', refresh);
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="cancel-http-check"]') || event.target === dialog) {
        close();
        return;
      }
      if (event.target.closest('[data-action="apply-http-check"]')) {
        if (applyButton.disabled) return;
        const options = readOptions();
        const validationErrors = validateHttpHealthCheckOptions(options);
        if (validationErrors.length) {
          refresh();
          return;
        }
        const result = applyHttpHealthCheck(current.text, model, backendName, options);
        if (result.errors?.length) {
          refresh();
          return;
        }
        const proposedModel = parseConfig(result.text);
        const proposedAnalysis = analyzeConfig(proposedModel);
        if (proposedAnalysis.counts.error > analysis.counts.error) {
          toast('The proposed configuration has more errors. Fix it manually before applying.', { tone: 'danger', duration: 6000 });
          return;
        }
        const committed = commitConfig(result.text, {
          filename: current.filename || 'haproxy.cfg',
          label: `Configured HTTP health check: ${backend.name}`,
          source: 'http-check-editor',
          note: result.summary,
        });
        if (!committed.ok) {
          toast(committed.error?.message || 'Could not save the HTTP health check.', { tone: 'danger' });
          return;
        }
        close();
        toast('HTTP health check saved as a new local version. Validate with haproxy -c before deployment.', { tone: 'ok', duration: 6000 });
        reloadRoute();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('close', () => dialog.remove());
    refresh();
    dialog.showModal();
  };

  view.querySelector('[data-finding-list]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-fix-finding]');
    if (!button) return;
    const finding = analysis.findings[Number(button.dataset.fixFinding)];
    if (finding) openFindingFix(finding);
  });

  view.addEventListener('click', (event) => {
    const configure = event.target.closest('[data-configure-http-check]');
    if (configure) {
      openHttpCheckEditor(configure.dataset.configureHttpCheck);
      return;
    }
    if (event.target.closest('[data-open-http-checks]')) {
      setTab('best-practices');
      view.querySelector('[data-http-check-card]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
    const appliedFixes = result.applied
      .map((item) => BEST_PRACTICE_FIXES.find((fix) => fix.id === item.id))
      .filter(Boolean);
    const risks = [...new Set(appliedFixes.map((fix) => fix.risk).filter(Boolean))];
    const singleServerCheck = result.applied.some((item) => item.id === 'server-checks')
      && model.backends.some((backend) => backend.servers.length === 1
        && !isBareHttpCheckBackend(model, backend.name)
        && backend.servers.some((server) => !server.flags.has('check')));
    pendingFix = { ...result, proposedModel, proposedAnalysis, appliedFixes, risks, singleServerCheck };
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
      ${risks.length ? `<div class="callout warn fix-risk">${icon('warning')}<div><strong>What you need to know</strong><ul>${risks.map((risk) => `<li>${esc(risk)}</li>`).join('')}${singleServerCheck ? '<li>Single-server backends: a false positive takes the only server out of rotation and causes a full outage. Test the endpoint and timing first.</li>' : ''}</ul></div></div>` : ''}
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
      const details = [
        ...pendingFix.applied.map((item) => `${item.title}: ${item.summary}`),
        ...pendingFix.risks.map((risk) => `Risk: ${risk}`),
        ...(pendingFix.singleServerCheck
          ? ['Single-server backends: a false positive removes the only server and causes a full outage.']
          : []),
        `Score ${analysis.score} → ${pendingFix.proposedAnalysis.score}.`,
        'Validate the result with `haproxy -c -f` using the target binary and test in staging before deployment.',
        'The previous version stays in History.',
      ];
      const requiresAcknowledgement = pendingFix.appliedFixes
        .some((fix) => fix.requiresAcknowledgement);
      const proceed = await confirmDialog({
        title: 'Do you want to apply these best-practice changes?',
        message: 'Review what will change and what you need to know before applying. This saves a new local version; it does not deploy to HAProxy.',
        confirmLabel: 'Apply and save version',
        details,
        detailsTitle: 'What you need to know',
        acknowledgement: requiresAcknowledgement
          ? 'I understand these changes can affect production traffic. I will validate the result with `haproxy -c` and staging before deployment.'
          : null,
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
      } else if (type === 'http-checks') {
        setTab('best-practices');
        view.querySelector('[data-http-check-card]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
