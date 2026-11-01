import { analyzeConfig } from '../config/analyzer.js';
import { diffLines } from '../config/diff.js';
import { parseConfig } from '../config/parser.js';
import { detectArchitecture, simulateRequest } from '../config/simulate.js';
import { SERVICE_KINDS, buildServicePlan, serviceCandidates } from '../config/wizard.js';
import { commitConfig } from '../storage.js';
import {
  confirmDialog,
  esc,
  icon,
  renderDiff,
  toast,
} from '../ui.js';
import { requireConfig } from './common.js';

function kindCard(kind) {
  return `<label class="type-card" data-kind-card="${kind.id}">
    <input type="radio" name="kind" value="${kind.id}" ${kind.id === 'https' ? 'checked' : ''}>
    <span class="type-icon">${icon(kind.icon)}</span>
    <strong>${esc(kind.label)}</strong>
    <small>${esc(kind.short)}</small>
    <p>${esc(kind.description)}</p>
  </label>`;
}

function detectionHTML(model) {
  const architecture = detectArchitecture(model);
  const items = [
    { label: 'Entry', value: architecture.entryFrontends.map((fe) => fe.name).join(', ') || 'none' },
    { label: 'SNI passthrough', value: architecture.tlsPassthrough.map((fe) => fe.name).join(', ') || 'none' },
    { label: 'TLS termination', value: model.frontends.filter((fe) => fe.binds.some((bind) => bind.ssl)).map((fe) => fe.name).join(', ') || 'none' },
    { label: 'Loopback', value: architecture.internalFrontends.map((fe) => fe.name).join(', ') || 'none' },
  ];
  return `<div class="detection-card">
    <span class="eyebrow">Running configuration</span>
    <h3>Detected architecture</h3>
    <dl>${items.map((item) => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join('')}</dl>
    <p class="muted-note">${icon('info')}The wizard considers these frontends, their modes, ssl binds and loopback hand-offs when placing the new service.</p>
  </div>`;
}

function resultBadge(result) {
  if (!result) return { label: 'Unknown', tone: 'neutral', text: 'No result' };
  if (result.outcome === 'tunnel') return { label: 'Tunnel', tone: 'ok', text: 'TCP tunnel established' };
  if (result.outcome === 'reset') return { label: 'Reset', tone: 'danger', text: 'Connection reset' };
  if (result.outcome === 'refused') return { label: 'Refused', tone: 'danger', text: 'Connection refused' };
  if (result.outcome === 'failed') return { label: 'Failed', tone: 'danger', text: 'Connection failed' };
  const tone = result.code >= 500 ? 'danger' : result.code >= 400 ? 'warn' : 'ok';
  return { label: `HTTP ${result.code}`, tone, text: result.summary };
}

function bindProposedSim(container, plan) {
  if (!container) return;
  const proposedModel = parseConfig(plan.proposed);
  const request = plan.request;
  container.innerHTML = `
    <form class="proposed-sim-form" data-proposed-sim-form>
      <label class="field"><span>Scheme</span><select name="scheme">
        <option value="https" ${request.scheme === 'https' ? 'selected' : ''}>HTTPS</option>
        <option value="http" ${request.scheme === 'http' ? 'selected' : ''}>HTTP</option>
        <option value="tcp" ${request.scheme === 'tcp' ? 'selected' : ''}>TCP / TLS</option>
      </select></label>
      <label class="field"><span>Host</span><input name="host" value="${esc(request.host)}" autocomplete="off"></label>
      <label class="field"><span>SNI</span><input name="sni" value="${esc(request.sni || request.host)}" autocomplete="off"></label>
      <label class="field"><span>Port</span><input name="port" value="${esc(request.port)}" inputmode="numeric" autocomplete="off"></label>
      <label class="field"><span>Path</span><input name="path" value="${esc(request.path || '/')}" autocomplete="off"></label>
      <label class="field"><span>Source</span><input name="source" value="203.0.113.10" autocomplete="off"></label>
      <button class="btn btn-primary btn-sm" type="submit">${icon('shuffle')}Run against new file</button>
    </form>
    <div class="proposed-sim-output" data-proposed-sim-output></div>`;

  const form = container.querySelector('[data-proposed-sim-form]');
  const output = container.querySelector('[data-proposed-sim-output]');
  const run = () => {
    const input = {
      scheme: form.elements.scheme.value,
      host: form.elements.host.value.trim(),
      sni: form.elements.sni.value.trim() || form.elements.host.value.trim(),
      port: form.elements.port.value.trim(),
      path: form.elements.path.value || '/',
      method: 'GET',
      source: form.elements.source.value.trim() || '203.0.113.10',
      clientCert: false,
    };
    const result = simulateRequest(proposedModel, input);
    const badge = resultBadge(result);
    const route = [
      result.frontend ? `frontend ${result.frontend}` : null,
      result.backend ? `backend ${result.backend}` : null,
      result.server ? `server ${typeof result.server === 'string' ? result.server : result.server.name}` : null,
    ].filter(Boolean);
    output.innerHTML = `<div class="sim-result ${badge.tone}" data-proposed-sim-result>
      <div class="sim-result-head">
        <div class="sim-status"><span class="status-orb ${badge.tone}"></span><div><span class="eyebrow">New file result</span><h3>${esc(badge.label)}</h3></div></div>
        <span class="pill ${badge.tone}">${esc(result.outcome)}</span>
      </div>
      <p class="sim-summary">${esc(result.summary)}</p>
      ${route.length ? `<div class="route-line">${route.map((item, index) => `${index ? `<span class="route-arrow">${icon('arrow')}</span>` : ''}<span class="route-node">${esc(item)}</span>`).join('')}</div>` : ''}
      ${result.warnings.length ? `<div class="callout warn">${icon('warning')}<div><strong>Simulation warnings</strong><ul>${result.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div></div>` : ''}
      <details class="proposed-trace" open><summary>Decision trace (${result.steps.length} steps)</summary>
        <ol class="timeline">${result.steps.map((step) => `<li class="timeline-item ${step.level || 'info'}"><span class="timeline-dot"></span><div class="timeline-copy"><div class="timeline-title"><strong>${esc(step.title)}</strong>${step.line ? `<a class="line-link" href="#/workbench?line=${step.line}">line ${step.line}</a>` : ''}</div><p>${esc(step.detail)}</p></div></li>`).join('')}</ol>
      </details>
    </div>`;
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run();
  });
  run();
}

function simulationCompareHTML(currentResult, proposedResult) {
  const currentBadge = resultBadge(currentResult);
  const proposedBadge = resultBadge(proposedResult);
  const changed = currentResult?.summary !== proposedResult?.summary || currentBadge.label !== proposedBadge.label;
  return `<div class="sim-compare ${changed ? 'changed' : ''}">
    <div class="compare-column">
      <span class="eyebrow">Current config</span>
      <div class="compare-status"><span class="pill ${currentBadge.tone}">${esc(currentBadge.label)}</span></div>
      <p>${esc(currentResult?.summary || 'No routing result.')}</p>
    </div>
    <div class="compare-arrow">${icon('arrow')}</div>
    <div class="compare-column">
      <span class="eyebrow">Proposed config</span>
      <div class="compare-status"><span class="pill ${proposedBadge.tone}">${esc(proposedBadge.label)}</span></div>
      <p>${esc(proposedResult?.summary || 'No routing result.')}</p>
    </div>
  </div>`;
}

function targetOptions(model, kind, selected) {
  const candidates = serviceCandidates(model, kind);
  const grouped = candidates.map((candidate) => `<option value="${esc(candidate.id)}" ${selected === candidate.id ? 'selected' : ''}>${esc(candidate.label)}</option>`).join('');
  return `<option value="auto" ${selected === 'auto' ? 'selected' : ''}>Auto-detect (recommended)</option>
    ${grouped ? `<optgroup label="Existing frontends and bridges">${grouped}</optgroup>` : ''}
    <option value="new" ${selected === 'new' ? 'selected' : ''}>Create a new frontend…</option>`;
}

export async function renderServices(view, query) {
  const current = requireConfig(view, {
    title: 'Import a configuration before adding a service',
    message: 'The service wizard needs to see your current frontends, TLS architecture and routing rules so it can place the new service safely.',
  });
  if (!current) return null;

  const model = parseConfig(current.text);
  const initialAnalysis = analyzeConfig(model);
  const architecture = detectArchitecture(model);
  const suggestedHost = (() => {
    for (const frontend of model.frontends) {
      for (const rule of frontend.rules) {
        for (let index = 0; index < (rule.condition?.length || 0); index += 1) {
          if (['-i', '-m'].includes(rule.condition[index])) {
            const value = rule.condition[index + 1];
            if (value?.includes('.') && !value.startsWith('-')) return value.replace(/^\./, '');
          }
        }
      }
    }
    return 'learning.example.com';
  })();

  view.innerHTML = `
    <header class="page-head service-head">
      <div class="page-head-copy">
        <span class="eyebrow">Guided change</span>
        <h1>Add a service to the running config</h1>
        <p class="page-lede">Choose HTTPS termination, plain HTTP or TLS passthrough, then choose exactly where it listens: an existing TLS/HTTP frontend, an SNI edge → loopback termination bridge, or a new frontend with your own listen IP and port. Set the upstream IP and port separately, preview the diff and simulation, then apply locally.</p>
        <div class="meta-strip">
          <span class="pill">${icon('code')}${esc(current.filename || 'haproxy.cfg')}</span>
          <span class="pill">based on the saved version</span>
          <span class="pill">${architecture.entryFrontends.length} entry frontend${architecture.entryFrontends.length === 1 ? '' : 's'}</span>
          <span class="pill">${initialAnalysis.counts.error} errors · ${initialAnalysis.counts.warning} warnings</span>
        </div>
      </div>
      <div class="page-actions"><a class="btn btn-ghost" href="#/workbench">${icon('edit')}Edit source first</a></div>
    </header>

    <div class="service-layout">
      <form class="service-form" data-service-form>
        <div class="section-head small"><div><span class="eyebrow">Step 1</span><h2>What kind of service?</h2></div></div>
        <div class="type-grid">${SERVICE_KINDS.map(kindCard).join('')}</div>

        <div class="section-head small"><div><span class="eyebrow">Step 2</span><h2>Service name and hostnames</h2></div></div>
        <div class="form-grid">
          <label class="field"><span>Service name</span><input name="name" placeholder="myapp" autocomplete="off" title="Letters, digits, underscores and hyphens; unsafe characters are normalised"></label>
          <label class="field"><span>Domain</span><input name="domain" placeholder="example.com" autocomplete="off"><small>Used to complete short host names. Fully qualified host names are used as-is.</small></label>
          <label class="field span-2"><span>Hostnames</span><textarea name="hosts" rows="2" placeholder="app, api, @, *.apps" autocomplete="off"></textarea><small>Short names are appended to the domain (<code>app</code> → <code>app.example.com</code>). Use <code>@</code> for the apex and <code>*.apps</code> for a wildcard.</small></label>
        </div>

        <div class="section-head small"><div><span class="eyebrow">Step 3</span><h2>Where should it listen?</h2></div></div>
        <div class="form-grid">
          <label class="field span-2"><span>Placement</span><select name="target" data-target-select>${targetOptions(model, 'https', 'auto')}</select><small>Choose an existing TLS/HTTP frontend, an SNI edge → loopback termination bridge, or explicitly create a new frontend.</small></label>
        </div>
        <div class="placement-planner">
          <div class="draggable-service" draggable="true" data-drag-service tabindex="0" role="button" aria-label="Drag the new service onto a placement target">
            <span class="drag-grip" aria-hidden="true">⠿</span>
            <div><strong data-drag-service-label>New service</strong><small>Drag onto a target below, or click a target.</small></div>
          </div>
          <div class="placement-targets" data-placement-targets aria-label="Placement targets"></div>
        </div>
        <div class="target-hint" data-target-hint></div>
        <fieldset class="form-section new-frontend-fields" data-new-frontend-fields>
          <legend>New frontend bind</legend>
          <p class="form-section-note">These values are used only when the placement is <strong>Create a new frontend</strong>, or when auto-detection finds no suitable existing frontend.</p>
          <div class="form-grid">
            <label class="field"><span>Listen IP / interface</span><input name="bindAddress" value="*" placeholder="* or 0.0.0.0 or 192.0.2.10" autocomplete="off"><small><code>*</code> binds all addresses. You can use a specific IPv4/IPv6 address or interface name.</small></label>
            <label class="field"><span>Listen port</span><input name="entryPort" value="443" inputmode="numeric" autocomplete="off"><small>Port exposed to clients. It must not conflict with an existing bind on the same address.</small></label>
            <label class="field cert-field span-2"><span>Certificate path (new TLS frontend only)</span><input name="cert" placeholder="/etc/haproxy/certs/myapp.pem" autocomplete="off"><small>Existing targets keep their current certificate selection. This value is only used when a new TLS frontend is generated.</small></label>
          </div>
        </fieldset>

        <div class="section-head small"><div><span class="eyebrow">Step 4</span><h2>Where should traffic go?</h2></div></div>
        <fieldset class="form-section">
          <legend>Upstream application</legend>
          <div class="form-grid">
            <label class="field"><span>Upstream IP / hostname</span><input name="serverHost" placeholder="192.0.2.50" autocomplete="off"><small>The application server HAProxy connects to. Documentation IPs and hostnames are fine for planning.</small></label>
            <label class="field"><span>Upstream port</span><input name="serverPort" value="80" inputmode="numeric" autocomplete="off"><small>The listening port on the application server.</small></label>
            <label class="field"><span>Load balancing</span><select name="balance">
              <option value="roundrobin">Round robin</option>
              <option value="leastconn">Least connections</option>
              <option value="source">Source IP hash</option>
              <option value="first">First available</option>
            </select></label>
            <label class="field checkbox-field"><span>Upstream speaks TLS</span><input name="serverSsl" type="checkbox"><small>Adds <code>ssl</code> to the server line. Certificate verification still needs an explicit policy.</small></label>
            <label class="field checkbox-field span-2"><span>Enable TCP health check</span><input name="check" type="checkbox" checked><small>Adds <code>check inter 2s fall 3 rise 2</code>. Use an HTTP health endpoint for application-level readiness.</small></label>
          </div>
        </fieldset>

        <div class="service-actions">
          <button class="btn btn-primary" type="submit">${icon('arrow')}Preview changes</button>
          <span class="muted-note" data-preview-stale hidden>${icon('warning')}Inputs changed — preview again.</span>
        </div>
      </form>

      <aside class="service-side">
        ${detectionHTML(model)}
        <div class="callout info">${icon('lock')}<p><strong>This proposes; it does not deploy.</strong> No HAProxy command runs. The diff is generated locally and applied only to your browser-local copy after you confirm.</p></div>
        <div class="callout warn">${icon('warning')}<p><strong>Certificates and DNS are external.</strong> The wizard can verify structure, not whether a certificate covers the hostname, whether DNS points here, or whether the port is reachable.</p></div>
      </aside>
    </div>

    <section class="preview-section" data-service-preview hidden></section>
  `;

  const form = view.querySelector('[data-service-form]');
  const preview = view.querySelector('[data-service-preview]');
  const targetSelect = form.elements.target;
  const targetHint = view.querySelector('[data-target-hint]');
  const placementTargets = view.querySelector('[data-placement-targets]');
  const dragService = view.querySelector('[data-drag-service]');
  const newFrontendFields = view.querySelector('[data-new-frontend-fields]');
  const certField = view.querySelector('.cert-field');
  const stale = view.querySelector('[data-preview-stale]');
  const serverPort = form.elements.serverPort;
  let currentKind = 'https';
  let hasPreview = false;
  let latestPlan = null;
  let lastServerPortDefault = '80';

  const markStale = () => {
    if (!hasPreview) return;
    stale.hidden = false;
    preview.querySelectorAll('[data-action="apply-service"]').forEach((button) => {
      button.disabled = true;
    });
  };

  const candidatesForCurrentKind = () => serviceCandidates(model, currentKind);

  const renderPlacementTargets = () => {
    if (!placementTargets) return;
    const candidates = candidatesForCurrentKind();
    const targets = [
      {
        id: 'auto',
        label: 'Auto-detect',
        meta: candidates[0]?.label || 'Create a new frontend',
        detail: 'Recommended',
      },
      ...candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        meta: candidate.frontend?.binds?.map((bind) => bind.raw).join(', ') || 'existing binds',
        detail: candidate.kind === 'bridge' ? 'SNI bridge' : candidate.frontend?.effectiveMode?.toUpperCase() || 'frontend',
      })),
      {
        id: 'new',
        label: 'Create a new frontend',
        meta: `${form.elements.bindAddress.value || '*'}:${form.elements.entryPort.value || '—'}`,
        detail: 'Dedicated listener',
      },
    ];
    placementTargets.innerHTML = targets.map((target) => `
      <button class="placement-target ${targetSelect.value === target.id ? 'selected' : ''}" type="button" data-placement-target="${esc(target.id)}" aria-pressed="${targetSelect.value === target.id}">
        <span class="placement-target-type">${esc(target.detail)}</span>
        <strong>${esc(target.label)}</strong>
        <small>${esc(target.meta)}</small>
      </button>`).join('');
  };

  const choosePlacement = (id) => {
    if (![...targetSelect.options].some((option) => option.value === id)) return;
    targetSelect.value = id;
    updateTargetHint();
    updateNewFrontendFields();
    renderPlacementTargets();
    markStale();
  };

  const willCreateNewFrontend = () => {
    if (targetSelect.value === 'new') return true;
    if (targetSelect.value !== 'auto') return false;
    return candidatesForCurrentKind().length === 0;
  };

  const updateNewFrontendFields = () => {
    const needsNew = willCreateNewFrontend();
    newFrontendFields.hidden = !needsNew;
    certField.hidden = currentKind !== 'https' || !needsNew;
  };

  const updateTargetHint = () => {
    const candidates = candidatesForCurrentKind();
    const selected = candidates.find((candidate) => candidate.id === targetSelect.value);
    const bindText = `${form.elements.bindAddress.value.trim() || '*'}:${form.elements.entryPort.value.trim() || '—'}`;

    if (targetSelect.value === 'new' || (targetSelect.value === 'auto' && candidates.length === 0)) {
      targetHint.innerHTML = `<div class="target-hint-card new">
        ${icon('plus')}
        <div><strong>Create a new frontend</strong>
        <span>A dedicated frontend will be generated. Bind: <code>${esc(bindText)}</code>${currentKind === 'https' ? ' with TLS termination' : currentKind === 'http' ? ' as a plain HTTP listener' : ' as a TCP listener'}. The listen IP, port and certificate below are used.</span></div>
      </div>`;
    } else if (selected) {
      const binds = selected.frontend?.binds?.map((bind) => bind.raw).join(', ') || 'existing binds';
      targetHint.innerHTML = `<div class="target-hint-card existing">
        ${icon('topology')}
        <div><strong>${esc(selected.label)}</strong>
        <span>${esc(selected.detail)}</span>
        <span class="target-binds">Existing bind${selected.frontend?.binds?.length === 1 ? '' : 's'}: <code>${esc(binds)}</code></span></div>
      </div>`;
    } else {
      targetHint.innerHTML = `<div class="target-hint-card auto">
        ${icon('search')}
        <div><strong>Auto-detect will use ${esc(candidates[0].label)}</strong>
        <span>${esc(candidates[0].detail)}</span>
        <span class="target-binds">You can override this with any existing target or explicitly create a new frontend.</span></div>
      </div>`;
    }
    updateNewFrontendFields();
    renderPlacementTargets();
  };

  const rebuildTargets = () => {
    const kind = form.querySelector('input[name="kind"]:checked')?.value || 'https';
    const previous = targetSelect.value;
    targetSelect.innerHTML = targetOptions(model, kind, previous);
    if (![...targetSelect.options].some((option) => option.value === previous)) targetSelect.value = 'auto';
    currentKind = kind;
    form.elements.entryPort.value = kind === 'http' ? '80' : '443';
    const defaultPort = kind === 'tcp' ? '443' : '80';
    if (!serverPort.value || serverPort.value === lastServerPortDefault) serverPort.value = defaultPort;
    lastServerPortDefault = defaultPort;
    updateTargetHint();
    updateNewFrontendFields();
    renderPlacementTargets();
    markStale();
  };

  const buildServerAddress = () => {
    const rawHost = form.elements.serverHost.value.trim();
    const port = serverPort.value.trim();
    if (!rawHost) return '';
    // Accept a combined host:port in the host field, but prefer the dedicated
    // port field for normal use.
    if (/^\[[^\]]+\]:\d+$/.test(rawHost) || /^[^:]+:\d+$/.test(rawHost)) return rawHost;
    if (rawHost.startsWith('[') && rawHost.endsWith(']')) return `${rawHost}:${port}`;
    if (rawHost.includes(':')) return `[${rawHost}]:${port}`;
    return `${rawHost}:${port}`;
  };

  form.querySelectorAll('input[name="kind"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      rebuildTargets();
      view.querySelectorAll('[data-kind-card]').forEach((card) => {
        card.classList.toggle('active', card.dataset.kindCard === currentKind);
      });
    });
  });
  view.querySelectorAll('[data-kind-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.kindCard === currentKind);
  });
  targetSelect.addEventListener('change', () => {
    updateTargetHint();
    updateNewFrontendFields();
    renderPlacementTargets();
  });
  [form.elements.bindAddress, form.elements.entryPort].forEach((input) => {
    input?.addEventListener('input', () => {
      if (willCreateNewFrontend()) updateTargetHint();
      renderPlacementTargets();
    });
  });
  [form.elements.name, form.elements.hosts].forEach((input) => {
    input?.addEventListener('input', () => {
      const label = view.querySelector('[data-drag-service-label]');
      if (label) label.textContent = form.elements.name.value.trim() || form.elements.hosts.value.trim().split(/[\s,]+/)[0] || 'New service';
    });
  });

  dragService?.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'haproxy-workbench-service');
    dragService.classList.add('dragging');
  });
  dragService?.addEventListener('dragend', () => dragService.classList.remove('dragging'));
  placementTargets?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-placement-target]');
    if (target) choosePlacement(target.dataset.placementTarget);
  });
  placementTargets?.addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-placement-target]');
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    target.classList.add('drag-over');
  });
  placementTargets?.addEventListener('dragleave', (event) => {
    event.target.closest('[data-placement-target]')?.classList.remove('drag-over');
  });
  placementTargets?.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-placement-target]');
    if (!target) return;
    event.preventDefault();
    target.classList.remove('drag-over');
    choosePlacement(target.dataset.placementTarget);
    toast(`Placement set to ${target.querySelector('strong')?.textContent || target.dataset.placementTarget}.`, { tone: 'ok' });
  });
  form.elements.serverSsl.addEventListener('change', () => {
    // A common upstream TLS convention; do not overwrite a custom port.
    if (form.elements.serverSsl.checked && serverPort.value === lastServerPortDefault && lastServerPortDefault === '80') {
      serverPort.value = '443';
    }
  });
  form.addEventListener('input', markStale);
  form.addEventListener('change', markStale);
  form.elements.kind?.addEventListener?.('change', markStale);

  const formValues = () => ({
    kind: form.querySelector('input[name="kind"]:checked')?.value || 'https',
    name: form.elements.name.value,
    domain: form.elements.domain.value,
    hosts: form.elements.hosts.value,
    server: buildServerAddress(),
    balance: form.elements.balance.value,
    target: form.elements.target.value,
    bindAddress: form.elements.bindAddress.value,
    entryPort: form.elements.entryPort.value,
    cert: form.elements.cert.value,
    serverSsl: form.elements.serverSsl.checked,
    check: form.elements.check.checked,
  });

  const simulatePlan = (plan) => {
    const request = plan.request;
    const currentResult = simulateRequest(model, request);
    const proposedModel = parseConfig(plan.proposed);
    const proposedResult = simulateRequest(proposedModel, request);
    return { currentResult, proposedResult, proposedAnalysis: analyzeConfig(proposedModel) };
  };

  const renderPreview = (plan) => {
    latestPlan = plan;
    hasPreview = true;
    stale.hidden = true;
    preview.hidden = false;
    const { currentResult, proposedResult, proposedAnalysis } = simulatePlan(plan);
    const diff = diffLines(current.text, plan.proposed);
    const errorDelta = proposedAnalysis.counts.error - initialAnalysis.counts.error;
    const warningDelta = proposedAnalysis.counts.warning - initialAnalysis.counts.warning;
    const target = plan.target;
    const listenText = plan.newFrontend
      ? plan.bind.raw
      : target?.kind === 'bridge'
        ? `${target.edgeFrontend.binds.map((bind) => bind.raw).join(', ')} → ${target.frontend.binds.map((bind) => bind.raw).join(', ')}`
        : target?.frontend?.binds?.map((bind) => bind.raw).join(', ') || 'existing frontend';
    preview.innerHTML = `
      <div class="preview-head">
        <div>
          <span class="eyebrow">Step 5 · Review</span>
          <h2>${esc(plan.summary)}</h2>
          <p>${target ? esc(target.detail) : `No existing frontend fits this service type; a new frontend ${esc(plan.newFrontendName || '')} will be generated on ${esc(plan.bind.raw)}. Review the address and certificate path carefully.`}</p>
        </div>
        <div class="preview-actions">
          <button class="btn btn-primary" type="button" data-action="apply-service" ${plan.ok ? '' : 'disabled'}>${icon('save')}Apply and save version</button>
          <button class="btn btn-ghost" type="button" data-action="cancel-service">Cancel</button>
        </div>
      </div>
      <div class="preview-facts">
        <span><strong>Listen</strong>${esc(listenText)}</span>
        <span><strong>Upstream</strong>${esc(plan.form.server.address || '—')}</span>
        <span><strong>Mode</strong>${plan.kind === 'tcp' ? 'TCP / SNI' : plan.kind === 'https' ? 'HTTP + TLS termination' : 'HTTP'}</span>
        <span><strong>Upstream TLS</strong>${plan.form.serverSsl ? 'yes' : 'no'}</span>
        <span><strong>Config style</strong>${esc(plan.styleLabel)}</span>
      </div>

      ${plan.errors.length ? `<div class="callout danger">${icon('error')}<div><strong>Fix these before applying</strong><ul>${plan.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div></div>` : ''}
      ${plan.warnings.length ? `<div class="callout warn">${icon('warning')}<div><strong>Review these consequences</strong><ul>${plan.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div></div>` : ''}

      <div class="impact-grid">
        <div class="impact-card"><span>Score</span><strong>${initialAnalysis.score} → ${proposedAnalysis.score}</strong><small>${initialAnalysis.grade} → ${proposedAnalysis.grade}</small></div>
        <div class="impact-card"><span>Errors</span><strong class="${errorDelta > 0 ? 'text-danger' : ''}">${initialAnalysis.counts.error} → ${proposedAnalysis.counts.error}</strong><small>${errorDelta > 0 ? `${errorDelta} new` : errorDelta < 0 ? `${Math.abs(errorDelta)} resolved` : 'unchanged'}</small></div>
        <div class="impact-card"><span>Warnings</span><strong class="${warningDelta > 0 ? 'text-warn' : ''}">${initialAnalysis.counts.warning} → ${proposedAnalysis.counts.warning}</strong><small>${warningDelta > 0 ? `${warningDelta} new` : warningDelta < 0 ? `${Math.abs(warningDelta)} resolved` : 'unchanged'}</small></div>
        <div class="impact-card"><span>Changes</span><strong>+${diff.added} / −${diff.removed}</strong><small>lines in diff</small></div>
      </div>

      <div class="section-head small"><div><span class="eyebrow">Before / after</span><h3>Simulated request</h3></div><p>Uses <code>${esc(plan.request.scheme.toUpperCase())} ${esc(plan.request.host)}${esc(plan.request.path || '')}</code> against the current and proposed configurations.</p></div>
      ${simulationCompareHTML(currentResult, proposedResult)}
      <div class="design-note">${icon('code')}<span><strong>Design-aware output:</strong> ${esc(plan.styleLabel)}. ${esc(plan.placementLabel)}</span></div>

      <div class="section-head small"><div><span class="eyebrow">New file simulation</span><h3>Simulate the new configuration</h3></div><p>This runs against the full proposed file, not just the current routing table. Change the request and run it as many times as you like.</p></div>
      <div class="proposed-sim" data-proposed-sim></div>

      <div class="section-head small"><div><span class="eyebrow">Generated diff</span><h3>What will be written</h3></div><p>The new backend is added after existing backends; routing rules are inserted before the first matching rule or default backend.</p></div>
      ${renderDiff(diff, { compact: true })}
      <div class="preview-foot">
        <span class="muted-note">${icon('lock')}Nothing has been applied yet. The current version remains in local history.</span>
        <button class="btn btn-primary" type="button" data-action="apply-service" ${plan.ok ? '' : 'disabled'}>${icon('save')}Apply and save version</button>
      </div>`;
    bindProposedSim(preview.querySelector('[data-proposed-sim]'), plan);
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const buildPreview = () => {
    if (!form.reportValidity()) return;
    try {
      const plan = buildServicePlan(model, formValues());
      renderPreview(plan);
    } catch (error) {
      console.error(error);
      toast(`Could not build the service plan: ${error.message}`, { tone: 'danger', duration: 6500 });
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    buildPreview();
  });

  preview.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action="cancel-service"]')) {
      preview.hidden = true;
      preview.innerHTML = '';
      hasPreview = false;
      latestPlan = null;
      return;
    }
    const apply = event.target.closest('[data-action="apply-service"]');
    if (!apply || !latestPlan) return;
    if (!latestPlan.ok) {
      toast('Fix the errors before applying this service.', { tone: 'danger' });
      return;
    }
    const { currentResult, proposedResult } = simulatePlan(latestPlan);
    const proceed = await confirmDialog({
      title: 'Add this service to the configuration?',
      message: 'This creates a new local version. It does not run HAProxy, reload a server or deploy anything.',
      confirmLabel: 'Apply locally',
      details: [
        latestPlan.summary,
        `Listen: ${latestPlan.newFrontend ? latestPlan.bind.raw : latestPlan.target?.frontend?.binds?.map((bind) => bind.raw).join(', ')}`,
        `Upstream: ${latestPlan.form.server.address}.`,
        `Simulation: ${resultBadge(currentResult).label} → ${resultBadge(proposedResult).label}.`,
        `${latestPlan.warnings.length} review note(s) will be preserved in the history entry.`,
      ],
    });
    if (!proceed) return;
    const result = commitConfig(latestPlan.proposed, {
      filename: current.filename || 'haproxy.cfg',
      label: `Added ${latestPlan.kindLabel}: ${latestPlan.form.hosts.join(', ')}`,
      source: 'service',
      note: latestPlan.warnings.join(' '),
    });
    if (!result.ok) {
      toast(result.error?.message || 'Could not save the proposed service.', { tone: 'danger' });
      return;
    }
    toast('Service added as a new local version. Review the simulated route.', { tone: 'ok' });
    const host = latestPlan.form.hosts[0] || '';
    const scheme = latestPlan.form.kind === 'http' ? 'http' : latestPlan.form.kind === 'tcp' ? 'tcp' : 'https';
    const port = latestPlan.request.port || (scheme === 'http' ? 80 : 443);
    location.hash = `#/topology?tab=simulate&scheme=${encodeURIComponent(scheme)}&host=${encodeURIComponent(host)}&sni=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`;
  });

  rebuildTargets();
  return null;
}
