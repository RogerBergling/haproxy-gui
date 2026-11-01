import { analyzeConfig } from '../config/analyzer.js';
import { parseConfig } from '../config/parser.js';
import {
  BRANCHES,
  BREAKING_CHANGES,
  REVIEWED_AT,
  UPGRADE_MATRIX,
  UPGRADE_STEPS,
  VERSION_SOURCES,
} from '../data/versions.js';
import { getCurrent } from '../storage.js';
import { esc, formatDate, icon } from '../ui.js';

function branchCard(branch) {
  return `<article class="branch-card ${branch.tone}">
    <div class="branch-head">
      <div><span class="branch-number">${esc(branch.branch)}</span><span class="pill ${branch.tone}">${esc(branch.status)}</span></div>
      <span class="branch-eol">EOL ${esc(branch.eol)}</span>
    </div>
    <h3>${esc(branch.headline)}</h3>
    <p class="branch-dates">Released ${esc(branch.released)} · ${esc(branch.support)}</p>
    <p>${esc(branch.summary)}</p>
    <div class="branch-columns">
      <div><h4>What changed</h4><ul>${branch.changes.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
      <div><h4>Upgrade notes</h4><ul>${branch.upgradeNotes.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
    </div>
  </article>`;
}

function breakingCard(change) {
  return `<article class="breaking-card">
    <div class="breaking-head"><span class="pill tiny warn">${esc(change.introduced)}</span><span class="pill tiny">${esc(change.area)}</span></div>
    <h3>${esc(change.change)}</h3>
    <p>${esc(change.impact)}</p>
    <div class="breaking-action">${icon('arrow')}<span><strong>Action:</strong> ${esc(change.action)}</span></div>
    ${change.finding ? `<a class="learn-link" href="#/workbench">Analyzer rule: ${esc(change.finding)} ${icon('arrow')}</a>` : ''}
  </article>`;
}

export async function renderVersions(view) {
  const current = getCurrent();
  let versionFindings = [];
  if (current) {
    const analysis = analyzeConfig(parseConfig(current.text));
    versionFindings = analysis.findings.filter((finding) => finding.category === 'version');
  }

  view.innerHTML = `
    <header class="page-head versions-head">
      <div class="page-head-copy">
        <span class="eyebrow">HAProxy version guide</span>
        <h1>Choose a branch. Understand the jump.</h1>
        <p class="page-lede">A practical map of HAProxy LTS branches, the features that matter, and what can break when a 2.x configuration meets a 3.x binary. Reviewed ${esc(formatDate(REVIEWED_AT))}.</p>
        <div class="meta-strip">
          <span class="pill ok">Current LTS: 3.4</span>
          <span class="pill">Next feature branch: 3.5-dev</span>
          <span class="pill">Reviewed ${esc(formatDate(REVIEWED_AT))}</span>
        </div>
      </div>
      <div class="page-actions wrap">
        <a class="btn btn-ghost" href="https://www.haproxy.org/" target="_blank" rel="noopener noreferrer">${icon('external')}Official release list</a>
        ${current ? `<a class="btn btn-primary" href="#/analyze">${icon('shield')}Check my config</a>` : `<a class="btn btn-primary" href="#/">${icon('upload')}Import a config</a>`}
      </div>
    </header>

    <div class="callout info">${icon('info')}<p><strong>The config file does not state its HAProxy version.</strong> Manage branches explicitly in packages, images and units. A configuration that validates on one branch can fail on another; the Workbench targets 3.x guidance but cannot execute your binary. Check with <code>haproxy -vv</code> and <code>haproxy -c -f</code>.</p></div>

    ${current ? `<section class="version-check-strip">
      <div>${icon('code')}<div><strong>${esc(current.label || current.filename)}</strong><span>${versionFindings.length ? `${versionFindings.length} version-specific finding${versionFindings.length === 1 ? '' : 's'} in the saved config` : 'No known removed or deprecated syntax was detected'}</span></div></div>
      <a class="btn btn-ghost btn-sm" href="#/analyze">Open analysis ${icon('arrow')}</a>
    </section>` : ''}

    <div class="section-head"><div><span class="eyebrow">Branches</span><h2>What is still supported?</h2></div><p>Even-numbered branches are LTS releases maintained for five years. Odd-numbered branches introduce features with shorter support. Exact EOL dates and patch levels are maintained by the HAProxy project.</p></div>
    <div class="branch-grid">${BRANCHES.map(branchCard).join('')}</div>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Migration</span><h2>Upgrade paths</h2></div><p>Difficulty depends more on automation, Lua and old syntax than on the raw config size. Test the target binary early.</p></div>
      <div class="table-scroll"><table class="data-table upgrade-table"><thead><tr><th>From</th><th>To</th><th>Effort</th><th>What to expect</th></tr></thead><tbody>
        ${UPGRADE_MATRIX.map((row) => `<tr><td><code>${esc(row.from)}</code></td><td><code>${esc(row.to)}</code></td><td><span class="pill tiny ${row.difficulty.startsWith('Low') ? 'ok' : 'warn'}">${esc(row.difficulty)}</span></td><td>${esc(row.note)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">2.x → 3.x</span><h2>What will actually happen</h2></div><p>Most valid 2.x configs still parse. The dangerous changes are the ones that fail validation, alter runtime automation, or make two names ambiguous.</p></div>
      <div class="callout warn">${icon('warning')}<div><strong>The short answer</strong><p>Expect a config validation pass with warnings, then a small set of hard failures around removed syntax and duplicate names. The bigger hidden risk is automation: Runtime API multi-command behaviour, dynamic-server keywords, stats scraping and certificate tooling. Test those alongside the config file.</p></div></div>
      <div class="breaking-grid">${BREAKING_CHANGES.map(breakingCard).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Runbook</span><h2>Upgrade checklist</h2></div><p>A safe migration is mostly inventory and failure testing, not a single binary swap.</p></div>
      <ol class="upgrade-steps">${UPGRADE_STEPS.map((step, index) => `<li><span class="step-number">${String(index + 1).padStart(2, '0')}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.detail)}</p></div></li>`).join('')}</ol>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Sources</span><h2>Verify before you migrate</h2></div><p>Branch facts and release notes change. These links are the authoritative starting points.</p></div>
      <div class="source-list">${VERSION_SOURCES.map((source) => `<a href="${esc(source.href)}" target="_blank" rel="noopener noreferrer"><span>${icon('external')}${esc(source.label)}</span><small>${esc(source.note)}</small></a>`).join('')}</div>
    </section>

    <div class="callout info">${icon('info')}<p><strong>Not affiliated with HAProxy Technologies.</strong> This guide is an independent operator summary, not official support. Use the exact branch manual for syntax and the official release announcements for security fixes.</p></div>
  `;

  return null;
}
