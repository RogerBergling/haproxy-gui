import { analyzeConfig } from '../config/analyzer.js';
import { parseConfig } from '../config/parser.js';
import { SECTION_GUIDE, explainBindOption, explainItem, explainServerOption } from '../data/directives.js';
import { getHistory, commitConfig } from '../storage.js';
import { confirmDialog, formatRelative, icon, openImportDialog, storageNotice, toast } from '../ui.js';
import { commitImportedConfig, downloadCurrent, requireConfig } from './common.js';

function sectionGuide(type) {
  return SECTION_GUIDE[type] || null;
}

function badgeForSection(section) {
  const guide = sectionGuide(section.type);
  return guide?.summary || '';
}

function prettyArgs(item) {
  if (item.keyword === 'bind' && item.binds) {
    return item.binds.map((bind) => bind.raw).join(', ');
  }
  return item.args.join(' ');
}

function directiveRow(item, section) {
  const explanation = explainItem(item);
  const bindDetails = item.binds
    ? item.binds.map((bind) => {
      const options = Object.keys(bind.options).filter((key) => !['ssl', 'crt', 'crt-list'].includes(key));
      const details = [
        bind.ssl ? 'TLS termination' : 'no TLS termination',
        bind.cert ? `cert ${bind.cert}` : '',
        bind.certList ? `crt-list ${bind.certList}` : '',
        bind.isLoopback ? 'loopback bind' : '',
        ...options.map((key) => `${key} ${bind.options[key] === true ? '' : bind.options[key]}`.trim()),
      ].filter(Boolean);
      return `<div class="bind-detail"><code>${escape(bind.raw)}</code><span>${details.map(escape).join(' · ')}</span></div>`;
    }).join('')
    : '';
  const serverDetails = item.server
    ? `<div class="server-detail"><strong>${escape(item.server.name)}</strong><span>${escape(item.server.address)}</span>
      ${item.server.flags.has('check') ? '<span class="pill ok tiny">check</span>' : '<span class="pill warn tiny">no check</span>'}
      ${item.server.flags.has('backup') ? '<span class="pill tiny">backup</span>' : ''}
      ${item.server.flags.has('ssl') ? '<span class="pill accent tiny">upstream TLS</span>' : ''}
    </div>`
    : '';
  const optionNotes = item.binds
    ? Object.keys(item.binds[0]?.options || {})
      .map((option) => {
        const text = explainBindOption(option);
        return text ? `<li><code>${escape(option)}</code> — ${escape(text)}</li>` : '';
      }).filter(Boolean).join('')
    : item.server
      ? [...item.server.flags]
        .map((option) => {
          const text = explainServerOption(option);
          return text ? `<li><code>${escape(option)}</code> — ${escape(text)}</li>` : '';
        }).filter(Boolean).join('')
      : '';

  return `<details class="directive-row" id="line-${item.line}">
    <summary>
      <span class="line-no">${item.line}</span>
      <code class="directive-code"><span class="kw">${escape(item.keyword)}</span> ${escape(prettyArgs(item))}</code>
      <span class="explain-hint">${icon('info')}Explain</span>
    </summary>
    <div class="directive-body">
      ${bindDetails}
      ${serverDetails}
      <div class="explain-head">
        <div>
          <span class="pill accent tiny">${escape(explanation.title)}</span>
          <p class="explain-summary">${escape(explanation.summary)}</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-jump-line="${item.line}">Go to line</button>
      </div>
      <p class="explain-detail">${escape(explanation.detail)}</p>
      ${explanation.syntax ? `<div class="syntax-box"><span>Syntax</span><code>${escape(explanation.syntax)}</code></div>` : ''}
      ${explanation.tips?.length ? `<div class="explain-block"><h4>Why it matters</h4><ul>${explanation.tips.map((tip) => `<li>${escape(tip)}</li>`).join('')}</ul></div>` : ''}
      ${explanation.advanced?.length ? `<div class="explain-block"><h4>Operator notes</h4><ul>${explanation.advanced.map((tip) => `<li>${escape(tip)}</li>`).join('')}</ul></div>` : ''}
      ${optionNotes ? `<div class="explain-block"><h4>Options on this line</h4><ul>${optionNotes}</ul></div>` : ''}
      ${explanation.seeAlso?.length ? `<div class="explain-links">${explanation.seeAlso.map((slug) => `<a href="#/learn/${encodeURIComponent(slug)}">Learn: ${escape(slug.replace(/-/g, ' '))} ${icon('arrow')}</a>`).join('')}</div>` : ''}
      ${item.comment ? `<p class="inline-comment">${icon('info')}${escape(item.comment)}</p>` : ''}
    </div>
  </details>`;
}

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionCard(section, model) {
  const guide = sectionGuide(section.type);
  const mode = section.effectiveMode ? section.effectiveMode.toUpperCase() : section.type === 'global' || section.type === 'defaults' ? '' : '—';
  const isProxy = ['frontend', 'backend', 'listen'].includes(section.type);
  const sectionTitle = section.name || (section.type === 'global' ? 'process-wide' : section.type === 'defaults' ? (section.name || 'unnamed defaults') : '(unnamed)');
  const binds = section.binds.length
    ? section.binds.map((bind) => `<span class="pill tiny ${bind.ssl ? 'accent' : ''}">${bind.ssl ? icon('lock') : ''}${escape(bind.raw)}</span>`).join('')
    : '';
  const filters = section.items.length > 40 ? 'long-section' : '';
  return `<article class="section-card section-${escape(section.type)}">
    <details ${section.items.length <= 18 ? 'open' : ''} class="section-details ${filters}">
      <summary class="section-summary">
        <span class="section-type">${escape(section.type)}</span>
        <span class="section-name">${escape(sectionTitle)}</span>
        <span class="section-lines">lines ${section.line}–${section.endLine}</span>
        ${mode ? `<span class="pill tiny">${escape(mode)}</span>` : ''}
        <span class="section-count">${section.items.length} directive${section.items.length === 1 ? '' : 's'}</span>
        <span class="chev">${icon('chevron')}</span>
      </summary>
      <div class="section-body">
        ${guide ? `<div class="section-guide">
          <p>${escape(guide.summary)}</p>
          <details class="section-guide-more"><summary>Section guide: why it matters</summary>
            <p>${escape(guide.purpose)}</p>
            <div class="guide-columns">
              <div><h4>Key points</h4><ul>${guide.keyPoints.map((item) => `<li>${escape(item)}</li>`).join('')}</ul></div>
              <div><h4>Common mistakes</h4><ul>${guide.commonMistakes.map((item) => `<li>${escape(item)}</li>`).join('')}</ul></div>
            </div>
          </details>
        </div>` : ''}
        <div class="section-meta">${binds}
          ${section.servers.length ? `<span class="pill tiny">${section.servers.length} server${section.servers.length === 1 ? '' : 's'}</span>` : ''}
          ${section.rules.length ? `<span class="pill tiny">${section.rules.length} routing rule${section.rules.length === 1 ? '' : 's'}</span>` : ''}
          ${section.defaultBackend ? `<span class="pill tiny">default ${escape(section.defaultBackend)}</span>` : ''}
        </div>
        <div class="directive-list">
          ${section.items.length ? section.items.map((item) => directiveRow(item, section)).join('') : '<p class="muted">No directives in this section.</p>'}
        </div>
      </div>
    </details>
  </article>`;
}

function learnContext(item, section, model) {
  if (item.keyword === 'bind' && item.binds) {
    return item.binds.map((bind) => {
      const tls = bind.ssl ? `TLS terminates here${bind.cert ? ` with ${bind.cert}` : ''}` : 'TLS is not terminated here (plain TCP or passthrough)';
      return `Opens ${bind.raw}; ${tls}.`;
    }).join(' ');
  }
  if (item.keyword === 'mode') {
    const mode = section.effectiveMode === 'http' ? 'HTTP' : 'TCP';
    return `This section runs in ${mode} mode${section.mode ? '' : ' (inherited from defaults)'}. ${mode === 'HTTP' ? 'HAProxy can inspect headers, paths and cookies.' : 'HAProxy forwards an opaque byte stream.'}`;
  }
  if (item.keyword === 'server' && item.server) {
    return `Defines upstream server "${item.server.name}" at ${item.server.address}. Active health checks are ${item.server.flags.has('check') ? 'enabled' : 'not enabled'}; upstream TLS is ${item.server.flags.has('ssl') ? 'enabled' : 'not enabled'}.`;
  }
  if (item.keyword === 'use_backend') {
    return `When ${item.condition ? 'its condition matches' : 'reached'}, this rule sends traffic to backend "${item.backend}". Rules are evaluated in order.`;
  }
  if (item.keyword === 'default_backend') {
    return `This is the fallback backend "${item.backend}" when no use_backend rule matches.`;
  }
  if (item.keyword === 'acl') {
    return `Defines the named condition "${item.acl?.name}" using ${item.acl?.criterion}. Other rules can reference it by name.`;
  }
  if (item.keyword === 'timeout') {
    return `Sets the ${item.timeoutName} timer to ${item.timeoutValue} in this section unless a narrower override applies.`;
  }
  if (item.keyword === 'balance') {
    return `Chooses the "${item.algorithm}" algorithm for selecting servers in this backend.`;
  }
  if (item.keyword === 'http-request' || item.keyword === 'http-response' || item.keyword === 'tcp-request' || item.keyword === 'tcp-response') {
    return `Runs the "${item.action}" ${item.keyword.split('-')[0].toUpperCase()}-level action${item.condition ? ' only when its condition matches' : ' for all traffic'}.`;
  }
  if (item.keyword === 'log') {
    return 'Sends HAProxy log messages to the configured destination. Logging is for humans and external collectors; it does not change routing.';
  }
  if (item.keyword === 'stats' && item.args[0] === 'socket') {
    return 'Creates the Runtime API/admin socket. Treat this as a live control interface, not just a monitoring URL.';
  }
  if (item.keyword === 'ssl-default-bind-options' || item.keyword === 'ssl-default-bind-ciphers' || item.keyword === 'ssl-default-bind-ciphersuites') {
    return 'Sets a process-wide default inherited by TLS binds unless an individual bind overrides it.';
  }
  if (item.keyword === 'option') {
    return `Enables the "${item.value}" behaviour for this section (or inherited defaults). It changes how HAProxy treats connections, HTTP, health checks or logging.`;
  }
  return `This line belongs to the ${section.type} section and is executed by HAProxy as part of that section’s behaviour.`;
}

function learningRow(item, section, model) {
  const explanation = explainItem(item);
  const context = learnContext(item, section, model);
  const syntax = explanation.syntax ? `<div class="learn-syntax"><span>Syntax</span><code>${escape(explanation.syntax)}</code></div>` : '';
  const tips = explanation.tips?.length
    ? `<div class="learn-tip-block"><h4>Why it matters</h4><ul>${explanation.tips.map((tip) => `<li>${escape(tip)}</li>`).join('')}</ul></div>`
    : '';
  const seeAlso = explanation.seeAlso?.length
    ? `<div class="explain-links">${explanation.seeAlso.map((slug) => `<a href="#/learn/${encodeURIComponent(slug)}">Learn: ${escape(slug.replace(/-/g, ' '))} ${icon('arrow')}</a>`).join('')}</div>`
    : '';
  return `<article class="learn-row" data-learn-line="${item.line}" data-learning-search="${escape(`${item.keyword} ${item.args.join(' ')} ${explanation.summary} ${context} ${section.type} ${section.name}`.toLowerCase())}">
    <span class="learn-line-no">${item.line}</span>
    <div class="learn-row-main">
      <div class="learn-row-head">
        <code class="directive-code"><span class="kw">${escape(item.keyword)}</span> ${escape(prettyArgs(item))}</code>
        <button class="btn btn-ghost btn-xs" type="button" data-learn-jump="${item.line}">Go to source</button>
      </div>
      <p class="learn-context">${escape(context)}</p>
      <p class="learn-summary"><strong>What it does:</strong> ${escape(explanation.summary)}</p>
      ${item.comment ? `<p class="learn-comment"># ${escape(item.comment)}</p>` : ''}
      <details class="learn-detail">
        <summary>Explain this line</summary>
        <p>${escape(explanation.detail)}</p>
        ${syntax}
        ${tips}
        ${seeAlso}
      </details>
    </div>
  </article>`;
}

function learningHTML(model, filter = '') {
  const query = filter.trim().toLowerCase();
  const sections = model.sections.map((section) => {
    const guide = sectionGuide(section.type);
    const rows = section.items.filter((item) =>
      !query || `${item.keyword} ${item.args.join(' ')} ${item.comment} ${section.type} ${section.name}`.toLowerCase().includes(query),
    );
    if (rows.length === 0 && !section.items.some((item) => !query)) return null;
    if (rows.length === 0 && query) return null;
    return `<section class="learn-config-section">
      <header class="learn-section-head">
        <div class="learn-section-title"><span class="section-type">${escape(section.type)}</span><h2>${escape(section.name || (section.type === 'global' ? 'process-wide' : section.type === 'defaults' ? 'defaults' : '(unnamed)'))}</h2><span class="section-lines">lines ${section.line}–${section.endLine}</span></div>
        ${guide ? `<p>${escape(guide.summary)}</p>` : ''}
        <div class="section-meta">
          ${section.effectiveMode && ['frontend','backend','listen'].includes(section.type) ? `<span class="pill tiny">${escape(section.effectiveMode.toUpperCase())}</span>` : ''}
          ${section.binds.length ? `<span class="pill tiny">${section.binds.length} bind${section.binds.length === 1 ? '' : 's'}</span>` : ''}
          ${section.servers.length ? `<span class="pill tiny">${section.servers.length} server${section.servers.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${guide ? `<details class="learn-section-guide"><summary>Why this section exists and what to watch out for</summary>
          <p>${escape(guide.purpose)}</p>
          <div class="guide-columns"><div><h4>Key points</h4><ul>${guide.keyPoints.map((point) => `<li>${escape(point)}</li>`).join('')}</ul></div><div><h4>Common mistakes</h4><ul>${guide.commonMistakes.map((point) => `<li>${escape(point)}</li>`).join('')}</ul></div></div>
        </details>` : ''}
      </header>
      <div class="learn-rows">${rows.length ? rows.map((item) => learningRow(item, section, model)).join('') : '<p class="muted">No matching directives in this section.</p>'}</div>
    </section>`;
  }).filter(Boolean);

  return `<div class="learn-config-intro">
    <div><span class="eyebrow">Learning mode</span><h2>Every row, explained in context</h2><p>This is a guided walkthrough of the imported file, not just an editor. Each directive is tied to its section, its effective behaviour and the reason it matters. Comments are shown on the directive they annotate.</p></div>
    <div class="learn-config-stats"><div><strong>${model.stats.sections}</strong><span>sections</span></div><div><strong>${model.stats.sections ? model.sections.reduce((sum, section) => sum + section.items.length, 0) : 0}</strong><span>explained rows</span></div><div><strong>${model.stats.servers}</strong><span>servers</span></div></div>
  </div>
  <div class="structure-toolbar">
    <label class="search-field">${icon('search')}<input type="search" placeholder="Find a directive, section or behaviour…" data-learning-search value="${escape(filter)}" aria-label="Search the config walkthrough"></label>
    <a class="btn btn-ghost btn-sm" href="#/glossary">${icon('book')}Glossary</a>
    <a class="btn btn-ghost btn-sm" href="#/learn">${icon('book')}Learning articles</a>
  </div>
  <div class="learn-config-list" data-learning-list>${sections.length ? sections.join('') : `<div class="empty-filter">${icon('search')}No config row matches “${escape(filter)}”.</div>`}</div>
  <div class="callout info">${icon('info')}<p><strong>Learning, not executing.</strong> Explanations describe the imported text and the target HAProxy 3.x semantics. Unknown directives are preserved and marked generically. Always confirm exact behavior with <code>haproxy -c</code> and the manual for your deployed branch.</p></div>`;
}

export function structureHTML(model, query = '') {
  const normalized = query.trim().toLowerCase();
  const sections = normalized
    ? model.sections
      .map((section) => {
        const sectionMatches = `${section.type} ${section.name}`.toLowerCase().includes(normalized);
        const items = section.items.filter((item) =>
          `${item.keyword} ${item.args.join(' ')} ${item.comment}`.toLowerCase().includes(normalized),
        );
        if (!sectionMatches && items.length === 0) return null;
        return { ...section, items: sectionMatches ? section.items : items };
      })
      .filter(Boolean)
    : model.sections;

  const content = sections.length
    ? sections.map((section) => sectionCard(section, model)).join('')
    : `<div class="empty-filter">${icon('search')}No section or directive matches “${escape(query)}”.</div>`;

  return `<div class="structure-overview">
    <div class="stat-row">
      <div class="stat"><strong>${model.stats.sections}</strong><span>sections</span></div>
      <div class="stat"><strong>${model.stats.frontends + model.stats.listens}</strong><span>frontends</span></div>
      <div class="stat"><strong>${model.stats.backends + model.stats.listens}</strong><span>backends</span></div>
      <div class="stat"><strong>${model.stats.servers}</strong><span>servers</span></div>
      <div class="stat"><strong>${model.stats.rules}</strong><span>routing rules</span></div>
    </div>
    <div class="structure-tips">${icon('info')} Mode and timeouts may be inherited from defaults. Bind and server details are shown inside each directive.</div>
  </div>
  <div class="structure-list">${content}</div>`;
}

function metricsHTML(model, analysis) {
  const errors = analysis?.counts.error || 0;
  const warnings = analysis?.counts.warning || 0;
  const recs = analysis?.counts.recommendation || 0;
  return `<div class="editor-metrics" data-editor-metrics>
    <span>${model.stats.lines} lines</span>
    <span>${model.stats.sections} sections</span>
    <span class="${errors ? 'text-danger' : ''}">${errors} error${errors === 1 ? '' : 's'}</span>
    <span class="${warnings ? 'text-warn' : ''}">${warnings} warning${warnings === 1 ? '' : 's'}</span>
    <span>${recs} advice</span>
  </div>`;
}

export async function renderWorkbench(view, param, query) {
  const current = requireConfig(view, {
    title: 'Import a configuration to open the workbench',
    message: 'The workbench parses and explains the config locally. Import a file or paste it; nothing is uploaded.',
  });
  if (!current) return null;

  const initialModel = parseConfig(current.text);
  const initialAnalysis = analyzeConfig(initialModel);
  const history = getHistory();
  const requestedTabParam = query.get('tab');
  const requestedTab = ['structure', 'learn'].includes(requestedTabParam) ? requestedTabParam : 'source';
  const requestedLine = Number(query.get('line') || 0);
  const filename = current.filename || 'haproxy.cfg';

  view.innerHTML = `
    ${storageNotice()}
    <header class="page-head workbench-head">
      <div class="page-head-copy">
        <span class="eyebrow">Workbench</span>
        <h1>${escape(current.label || 'Configuration')}</h1>
        <div class="meta-strip">
          <span class="pill">${icon('code')}${escape(filename)}</span>
          <span class="pill">${initialModel.stats.lines} lines</span>
          <span class="pill">saved ${escape(formatRelative(current.updatedAt))}</span>
          <span class="pill">${history.length}/100 versions</span>
        </div>
        <p class="page-lede">Edit the source, inspect the structure, or switch to the guided walkthrough that explains every directive in this file. Saving creates a local version you can inspect or restore.</p>
      </div>
      <div class="page-actions wrap">
        <button class="btn btn-ghost" type="button" data-action="import">${icon('upload')}Import</button>
        <button class="btn btn-ghost" type="button" data-action="copy">${icon('copy')}Copy</button>
        <button class="btn btn-ghost" type="button" data-action="download">${icon('download')}Export</button>
        <button class="btn btn-primary" type="button" data-action="save" id="save-version">${icon('save')}Save version</button>
        <a class="btn btn-ghost" href="#/analyze" data-requires-save>${icon('shield')}Analyze</a>
      </div>
    </header>

    <section class="workbench-shell">
      <div class="tabbar" role="tablist" aria-label="Workbench views">
        <button class="tab" type="button" role="tab" data-tab="source" aria-selected="${requestedTab === 'source'}">${icon('code')}Source</button>
        <button class="tab" type="button" role="tab" data-tab="structure" aria-selected="${requestedTab === 'structure'}">${icon('layers')}Structure</button>
        <button class="tab" type="button" role="tab" data-tab="learn" aria-selected="${requestedTab === 'learn'}">${icon('book')}Learn this config</button>
        <div class="tabbar-status" data-dirty-status><span class="save-dot"></span><span data-dirty-label>Saved</span></div>
      </div>

      <div class="tab-panel" data-panel="source" ${requestedTab === 'source' ? '' : 'hidden'}>
        <div class="editor-toolbar">
          <div class="editor-toolbar-left">
            <span class="editor-lang">haproxy.cfg</span>
            ${metricsHTML(initialModel, initialAnalysis)}
          </div>
          <div class="editor-toolbar-right">
            <button class="btn btn-ghost btn-sm" type="button" data-action="revert">${icon('history')}Revert unsaved</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="validate">${icon('check')}Validate</button>
          </div>
        </div>
        <div class="editor-shell">
          <pre class="line-numbers" aria-hidden="true" data-line-numbers></pre>
          <textarea id="config-editor" class="config-editor" spellcheck="false" wrap="off" aria-label="HAProxy configuration source" autocomplete="off" autocapitalize="off">${escape(current.text)}</textarea>
        </div>
        <div class="editor-footer">
          <span>${icon('lock')}Local only. Nothing is uploaded when you edit or validate.</span>
          <span>Tab inserts two spaces · Ctrl/Cmd+S saves a version</span>
        </div>
        <div class="validation-panel" data-validation-panel hidden></div>
      </div>

      <div class="tab-panel" data-panel="structure" ${requestedTab === 'structure' ? '' : 'hidden'}>
        <div class="structure-toolbar">
          <label class="search-field">
            ${icon('search')}
            <input type="search" placeholder="Filter sections, directives, comments…" data-structure-search aria-label="Filter configuration structure">
          </label>
          <button class="btn btn-ghost btn-sm" type="button" data-action="expand-all">Expand all</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="collapse-all">Collapse all</button>
        </div>
        <div data-structure-body>${structureHTML(initialModel)}</div>
      </div>

      <div class="tab-panel" data-panel="learn" ${requestedTab === 'learn' ? '' : 'hidden'}>
        <div data-learning-body></div>
      </div>
    </section>

    <section class="workbench-next">
      <a class="next-card" href="#/analyze" data-requires-save><span class="feature-icon">${icon('shield')}</span><div><strong>Analyze safety and best practices</strong><span>Find TLS, timeout, health-check, logging and upgrade issues.</span></div>${icon('arrow')}</a>
      <a class="next-card" href="#/topology" data-requires-save><span class="feature-icon">${icon('topology')}</span><div><strong>Inspect the graph and simulate</strong><span>Follow Host/SNI routing, server selection and failure paths.</span></div>${icon('arrow')}</a>
      <a class="next-card" href="#/services" data-requires-save><span class="feature-icon">${icon('plus')}</span><div><strong>Add a service safely</strong><span>Generate a route and backend, then review the diff first.</span></div>${icon('arrow')}</a>
    </section>
  `;

  const textarea = view.querySelector('#config-editor');
  const lineNumbers = view.querySelector('[data-line-numbers]');
  let metrics = view.querySelector('[data-editor-metrics]');
  const dirtyStatus = view.querySelector('[data-dirty-status]');
  const dirtyLabel = view.querySelector('[data-dirty-label]');
  const validationPanel = view.querySelector('[data-validation-panel]');
  const structureBody = view.querySelector('[data-structure-body]');
  const learningBody = view.querySelector('[data-learning-body]');
  const searchInput = view.querySelector('[data-structure-search]');
  const saveButton = view.querySelector('#save-version');
  let savedText = current.text;
  let workingAnalysis = initialAnalysis;
  let dirty = false;
  let lineQueryApplied = false;
  let debounceTimer = null;

  const lineCount = () => {
    const count = textarea.value.split('\n').length;
    let output = '';
    for (let index = 1; index <= count; index += 1) output += `${index}\n`;
    lineNumbers.textContent = output;
  };

  const syncScroll = () => {
    lineNumbers.scrollTop = textarea.scrollTop;
  };

  const updateDefinition = () => {
    dirty = textarea.value !== savedText;
    dirtyStatus.classList.toggle('dirty', dirty);
    dirtyLabel.textContent = dirty ? 'Unsaved changes' : 'Saved';
    saveButton.innerHTML = `${icon('save')}Save version`;
    lineCount();
  };

  const updateDiagnostics = () => {
    const text = textarea.value;
    try {
      const model = parseConfig(text);
      workingAnalysis = analyzeConfig(model);
      metrics.outerHTML = metricsHTML(model, workingAnalysis);
      metrics = view.querySelector('[data-editor-metrics]');
    } catch (error) {
      console.error(error);
    }
    updateDefinition();
  };

  const scheduleDiagnostics = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateDiagnostics, 220);
  };

  const scrollToLine = (lineNumber) => {
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) return;
    const lines = textarea.value.split('\n');
    let position = 0;
    for (let index = 0; index < lineNumber - 1 && index < lines.length; index += 1) {
      position += lines[index].length + 1;
    }
    const end = position + (lines[lineNumber - 1]?.length || 0);
    activateTab('source');
    textarea.focus();
    textarea.setSelectionRange(position, end);
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 21;
    textarea.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
    syncScroll();
  };

  const bindLearning = () => {
    learningBody.querySelectorAll('[data-learn-jump]').forEach((button) => {
      button.addEventListener('click', () => scrollToLine(Number(button.dataset.learnJump)));
    });
    const learningSearch = learningBody.querySelector('[data-learning-search]');
    learningSearch?.addEventListener('input', () => {
      const query = learningSearch.value.trim().toLowerCase();
      learningBody.querySelectorAll('.learn-row').forEach((row) => {
        row.hidden = Boolean(query) && !row.dataset.learningSearch.includes(query);
      });
      learningBody.querySelectorAll('.learn-config-section').forEach((section) => {
        section.hidden = ![...section.querySelectorAll('.learn-row')].some((row) => !row.hidden);
      });
    });
  };

  const renderLearning = () => {
    const model = parseConfig(textarea.value);
    learningBody.innerHTML = learningHTML(model);
    bindLearning();
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    params.set('tab', 'learn');
    window.history.replaceState(null, '', `#/workbench?${params.toString()}`);
  };

  const activateTab = (tab) => {
    view.querySelectorAll('[data-tab]').forEach((button) => {
      button.setAttribute('aria-selected', button.dataset.tab === tab ? 'true' : 'false');
    });
    view.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
    if (tab === 'structure') {
      renderStructure(searchInput.value);
    }
    if (tab === 'learn') {
      renderLearning();
    }
  };

  const renderStructure = (filter = '') => {
    const model = parseConfig(textarea.value);
    structureBody.innerHTML = structureHTML(model, filter);
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    params.set('tab', 'structure');
    window.history.replaceState(null, '', `#/workbench?${params.toString()}`);
  };

  const dirtyGuard = async () => {
    if (!dirty) return true;
    return confirmDialog({
      title: 'Save your edits before leaving?',
      message: 'The next view uses the saved version, not the text currently in the editor.',
      confirmLabel: 'Save and continue',
      cancelLabel: 'Stay here',
      details: ['Saving creates a version in local history.', 'You can still revert to an earlier version.'],
    });
  };

  const save = () => {
    if (!textarea.value.trim()) {
      toast('The configuration is empty. Nothing was saved.', { tone: 'danger' });
      return false;
    }
    if (textarea.value === savedText && getHistory().some((entry) => entry.text === textarea.value)) {
      toast('No changes since the last saved version.', { tone: 'neutral' });
      savedText = textarea.value;
      updateDefinition();
      return true;
    }
    const result = commitConfig(textarea.value, {
      filename,
      label: 'Manual edit',
      source: 'manual',
      note: 'Saved from the Workbench source editor.',
    });
    if (!result.ok) {
      toast(result.error?.message || 'Could not save the version.', { tone: 'danger', duration: 6500 });
      return false;
    }
    savedText = textarea.value;
    updateDefinition();
    if (result.duplicate) toast('This version is already in history.', { tone: 'neutral' });
    else toast('Version saved locally. Use History to compare or restore it.', { tone: 'ok' });
    return true;
  };

  const download = () => {
    const name = filename.replace(/[^\w.-]+/g, '_') || 'haproxy.cfg';
    downloadCurrent(current, textarea.value);
    if (!name) return;
    // downloadCurrent keeps the stored filename; the editor may contain unsaved
    // changes, which are still exported deliberately.
  };

  textarea.addEventListener('input', () => {
    syncScroll();
    updateDefinition();
    scheduleDiagnostics();
  });
  textarea.addEventListener('scroll', syncScroll);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = `${textarea.value.slice(0, start)}  ${textarea.value.slice(end)}`;
      textarea.selectionStart = start + 2;
      textarea.selectionEnd = start + 2;
      scheduleDiagnostics();
    }
  });

  document.addEventListener('keydown', handleSaveShortcut);
  function handleSaveShortcut(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      if (!textarea.isConnected) return;
      event.preventDefault();
      save();
    }
  }

  const beforeUnload = (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  view.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  view.querySelector('[data-action="import"]')?.addEventListener('click', async () => {
    if (dirty) {
      const proceed = await dirtyGuard();
      if (!proceed || !save()) return;
    }
    openImportDialog({
      onLoad: (text, newFilename) => {
        const result = commitImportedConfig(text, newFilename);
        if (result) window.dispatchEvent(new CustomEvent('workbench:reload'));
      },
    });
  });
  view.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
    const { copyText } = await import('../ui.js');
    copyText(textarea.value, 'Configuration copied from the editor.');
  });
  view.querySelector('[data-action="download"]')?.addEventListener('click', download);
  view.querySelector('[data-action="save"]')?.addEventListener('click', save);
  view.querySelector('[data-action="revert"]')?.addEventListener('click', () => {
    if (!dirty) {
      toast('There are no unsaved changes.', { tone: 'neutral' });
      return;
    }
    textarea.value = savedText;
    updateDiagnostics();
    toast('Editor reset to the last saved version.', { tone: 'ok' });
  });
  view.querySelector('[data-action="validate"]')?.addEventListener('click', () => {
    const model = parseConfig(textarea.value);
    const analysis = analyzeConfig(model);
    validationPanel.hidden = false;
    const top = analysis.findings.slice(0, 6);
    validationPanel.innerHTML = `
      <div class="validation-head">
        <div><span class="pill ${analysis.counts.error ? 'danger' : analysis.counts.warning ? 'warn' : 'ok'}">${analysis.counts.error ? 'Errors present' : analysis.counts.warning ? 'Warnings present' : 'No errors or warnings'}</span>
        <strong>${analysis.score}/100 · grade ${analysis.grade}</strong></div>
        <button class="btn btn-ghost btn-sm" type="button" data-validation-close>Close</button>
      </div>
      ${top.length ? `<ul class="validation-list">${top.map((finding) => `<li><span class="sev-dot ${finding.severity}"></span><a href="#/workbench?line=${finding.line || 1}">${escape(finding.title)}</a><span>${escape(finding.section || '')}</span></li>`).join('')}</ul>` : '<p>No findings in the saved parser. This is not a substitute for <code>haproxy -c</code>.</p>'}
      <p class="muted-note">Save the version, then open Analyze for the full report and best-practice fixes.</p>`;
    validationPanel.querySelector('[data-validation-close]')?.addEventListener('click', () => { validationPanel.hidden = true; });
  });

  view.querySelector('[data-action="expand-all"]')?.addEventListener('click', () => {
    view.querySelectorAll('.section-details').forEach((details) => { details.open = true; });
  });
  view.querySelector('[data-action="collapse-all"]')?.addEventListener('click', () => {
    view.querySelectorAll('.section-details').forEach((details) => { details.open = false; });
  });
  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderStructure(searchInput.value), 160);
  });

  structureBody.addEventListener('click', (event) => {
    const jump = event.target.closest('[data-jump-line]');
    if (jump) {
      event.preventDefault();
      scrollToLine(Number(jump.dataset.jumpLine));
    }
  });

  view.querySelectorAll('[data-requires-save]').forEach((anchor) => {
    anchor.addEventListener('click', async (event) => {
      if (!dirty) return;
      event.preventDefault();
      const proceed = await dirtyGuard();
      if (proceed && save()) location.hash = anchor.getAttribute('href');
    });
  });

  // Guard other internal navigation (topbar, footer, structure links) while
  // the editor contains unsaved text. The explicit [data-requires-save]
  // links above have their own confirmation flow.
  const onDocumentClick = async (event) => {
    if (!dirty || event.defaultPrevented) return;
    const anchor = event.target.closest('a[href^="#/"]');
    if (!anchor || anchor.hasAttribute('data-requires-save') || anchor.dataset.guardBypass) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const proceed = await dirtyGuard();
    if (!proceed || !save()) return;
    anchor.dataset.guardBypass = 'true';
    location.hash = anchor.getAttribute('href');
  };
  document.addEventListener('click', onDocumentClick, true);

  lineCount();
  updateDefinition();
  if (requestedLine > 0 && !lineQueryApplied) {
    lineQueryApplied = true;
    setTimeout(() => scrollToLine(requestedLine), 60);
  } else if (requestedTab === 'structure') {
    renderStructure();
  } else if (requestedTab === 'learn') {
    renderLearning();
  }

  return () => {
    clearTimeout(debounceTimer);
    document.removeEventListener('keydown', handleSaveShortcut);
    document.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
