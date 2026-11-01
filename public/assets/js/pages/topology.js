import { diagramSummaryRows, nodeDetails, renderDiagramSVG } from '../config/diagram.js';
import { parseConfig } from '../config/parser.js';
import {
  detectArchitecture,
  formatCondition,
  simulateRequest,
} from '../config/simulate.js';
import {
  downloadText,
  esc,
  icon,
  toast,
} from '../ui.js';
import { requireConfig } from './common.js';

function collectScenario(model) {
  // Prefer an HTTP Host rule: it produces a full request trace and a response.
  for (const frontend of model.frontends) {
    for (const rule of frontend.rules) {
      if (!rule.condition?.some((token) => token.includes('hdr(host)'))) continue;
      for (let index = 0; index < rule.condition.length; index += 1) {
        const token = rule.condition[index];
        if (['-i', '-m'].includes(token)) {
          const value = rule.condition[index + 1];
          const host = String(value || '').replace(/^\./, '');
          if (host.includes('.') && host.split('.').length >= 2) {
            return { host, sni: host, scheme: 'https', port: '443' };
          }
        }
      }
    }
  }
  // Fall back to an SNI rule so TLS passthrough configs still get a useful demo.
  for (const frontend of model.frontends) {
    for (const rule of frontend.rules) {
      if (!rule.condition) continue;
      for (let index = 0; index < rule.condition.length; index += 1) {
        const token = rule.condition[index];
        if (['-i', '-m'].includes(token)) {
          const value = rule.condition[index + 1];
          const host = String(value || '').replace(/^\./, '');
          if (host.includes('.') && host.split('.').length >= 2) {
            return { host, sni: host, scheme: 'https', port: '443' };
          }
        }
      }
    }
  }
  return { host: 'example.com', sni: 'example.com', scheme: 'https', port: '443' };
}

function architectureHTML(model) {
  const architecture = detectArchitecture(model);
  const allTls = model.frontends.filter((frontend) => frontend.binds.some((bind) => bind.ssl));
  const cards = [
    { label: 'Entry frontends', value: architecture.entryFrontends.length, rows: architecture.entryFrontends.map((fe) => `${fe.name} (${fe.effectiveMode})`) },
    { label: 'TLS passthrough', value: architecture.tlsPassthrough.length, rows: architecture.tlsPassthrough.map((fe) => fe.name) },
    { label: 'TLS termination', value: allTls.length, rows: allTls.map((fe) => fe.name) },
    { label: 'Loopback frontends', value: architecture.internalFrontends.length, rows: architecture.internalFrontends.map((fe) => fe.name) },
  ];
  return `<div class="architecture-grid">${cards.map((card) => `<div class="architecture-card"><strong>${card.value}</strong><span>${esc(card.label)}</span><small>${esc(card.rows.join(', ') || 'none detected')}</small></div>`).join('')}</div>`;
}

function routingMapHTML(model) {
  const rows = [];
  for (const frontend of model.frontends) {
    for (const rule of frontend.rules) {
      rows.push({
        frontend: frontend.name,
        mode: frontend.effectiveMode,
        condition: formatCondition(rule.condition, rule.negate),
        backend: rule.backend,
        line: rule.line,
        fallback: false,
      });
    }
    if (frontend.defaultBackend) {
      rows.push({
        frontend: frontend.name,
        mode: frontend.effectiveMode,
        condition: 'fallback',
        backend: frontend.defaultBackend,
        line: frontend.line,
        fallback: true,
      });
    }
  }
  if (rows.length === 0) return '';
  return `<details class="routing-map" open>
    <summary>${icon('layers')}Routing conditions (${rows.length})</summary>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Frontend</th><th>Mode</th><th>Condition</th><th>Backend</th><th>Line</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td><code>${esc(row.frontend)}</code></td>
        <td><span class="pill tiny">${esc(row.mode)}</span></td>
        <td><code class="condition-code">${esc(row.condition)}</code>${row.fallback ? ' <span class="pill tiny">default</span>' : ''}</td>
        <td><code>${esc(row.backend)}</code></td>
        <td><a class="line-link" href="#/workbench?line=${row.line}">${row.line} ${icon('arrow')}</a></td>
      </tr>`).join('')}
    </tbody></table></div>
  </details>`;
}

function resultClass(result) {
  if (result.outcome === 'tunnel') return 'ok';
  if (result.outcome === 'reset' || result.outcome === 'failed' || result.outcome === 'refused') return 'danger';
  if (typeof result.code === 'number' && result.code >= 500) return 'danger';
  if (typeof result.code === 'number' && result.code >= 400) return 'warn';
  if (typeof result.code === 'number' && result.code >= 300) return 'info';
  return 'ok';
}

function statusText(result) {
  if (result.outcome === 'tunnel') return 'TCP tunnel established';
  if (result.outcome === 'reset') return 'Connection reset';
  if (result.outcome === 'refused') return 'Connection refused';
  if (result.outcome === 'failed') return 'Connection failed';
  return `HTTP ${result.code}`;
}

function renderResult(result, request) {
  const level = resultClass(result);
  const route = [
    result.frontend ? `frontend ${result.frontend}` : null,
    result.backend ? `backend ${result.backend}` : null,
    result.server ? `server ${typeof result.server === 'string' ? result.server : result.server.name}` : null,
  ].filter(Boolean);
  return `<div class="sim-result ${level}" data-sim-result>
    <div class="sim-result-head">
      <div class="sim-status"><span class="status-orb ${level}"></span><div><span class="eyebrow">Simulation result</span><h2>${esc(statusText(result))}</h2></div></div>
      <span class="pill ${level}">${result.outcome}</span>
    </div>
    <p class="sim-summary">${esc(result.summary)}</p>
    ${route.length ? `<div class="route-line">${route.map((item, index) => `${index ? `<span class="route-arrow">${icon('arrow')}</span>` : ''}<span class="route-node">${esc(item)}</span>`).join('')}</div>` : ''}
    <div class="sim-request">
      ${icon('globe')}
      <span><strong>${esc(request.scheme.toUpperCase())}</strong> ${esc(request.host || '(no host)')}${request.port ? `:${esc(request.port)}` : ''}${esc(request.path || '')}</span>
      <span>SNI <strong>${esc(request.sni || '(none)')}</strong></span>
      <span>source <strong>${esc(request.source)}</strong></span>
      ${request.clientCert ? '<span class="pill tiny accent">client cert</span>' : ''}
    </div>
    ${result.warnings.length ? `<div class="callout warn sim-warning">${icon('warning')}<div><strong>Simulation warnings</strong><ul>${result.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div></div>` : ''}
    <div class="sim-trace">
      <h3>Decision trace</h3>
      <ol class="timeline">
        ${result.steps.map((step) => `<li class="timeline-item ${step.level || 'info'}">
          <span class="timeline-dot"></span>
          <div class="timeline-copy">
            <div class="timeline-title"><strong>${esc(step.title)}</strong>${step.line ? `<a href="#/workbench?line=${step.line}" class="line-link">line ${step.line}</a>` : ''}</div>
            <p>${esc(step.detail)}</p>
          </div>
        </li>`).join('')}
      </ol>
    </div>
    <p class="muted-note">${icon('info')}Simulation assumes HTTP request semantics, no DNS resolution and no live health-check timing. Servers are considered up unless you mark them down. Unsupported ACLs are reported and treated as not matching.</p>
  </div>`;
}

export async function renderTopology(view, query) {
  const current = requireConfig(view, {
    title: 'Import a configuration to see its topology',
    message: 'The graph and request simulator run from a locally stored configuration. Import a file to follow its routing paths.',
  });
  if (!current) return null;

  const model = parseConfig(current.text);
  const architecture = detectArchitecture(model);
  const detectedScenario = collectScenario(model);
  const scenario = {
    host: query.get('host') || detectedScenario.host,
    sni: query.get('sni') || query.get('host') || detectedScenario.sni,
    scheme: ['http', 'https', 'tcp'].includes(query.get('scheme')) ? query.get('scheme') : detectedScenario.scheme,
    port: query.get('port') || detectedScenario.port,
  };
  const svg = renderDiagramSVG(model);
  const tableRows = diagramSummaryRows(model);
  const initialTab = query.get('tab') === 'simulate' ? 'simulate' : 'diagram';
  const allServers = model.backends.flatMap((backend) => backend.servers.map((server) => ({ backend, server })));

  view.innerHTML = `
    <header class="page-head topology-head">
      <div class="page-head-copy">
        <span class="eyebrow">Topology & simulation</span>
        <h1>${esc(current.label || 'HAProxy routing graph')}</h1>
        <p class="page-lede">See the configuration as a graph, then follow a request through binds, SNI/Host ACLs, loopback TLS hand-offs, backend selection and failover.</p>
        <div class="meta-strip">
          <span class="pill">${icon('code')}${esc(current.filename || 'haproxy.cfg')}</span>
          <span class="pill">${model.stats.frontends + model.stats.listens} frontend${model.stats.frontends + model.stats.listens === 1 ? '' : 's'}</span>
          <span class="pill">${model.stats.backends + model.stats.listens} backend${model.stats.backends + model.stats.listens === 1 ? '' : 's'}</span>
          <span class="pill">${model.stats.servers} server${model.stats.servers === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="page-actions wrap">
        <a class="btn btn-ghost" href="#/analyze">${icon('shield')}Analyze</a>
        <a class="btn btn-primary" href="#/services">${icon('plus')}Add service</a>
      </div>
    </header>

    ${architectureHTML(model)}

    <div class="tabbar" role="tablist" aria-label="Topology views">
      <button class="tab" type="button" role="tab" data-topo-tab="diagram" aria-selected="${initialTab === 'diagram'}">${icon('topology')}Routing graph</button>
      <button class="tab" type="button" role="tab" data-topo-tab="simulate" aria-selected="${initialTab === 'simulate'}">${icon('shuffle')}Request simulator</button>
    </div>

    <section class="tab-panel" data-topo-panel="diagram" ${initialTab === 'diagram' ? '' : 'hidden'}>
      <div class="diagram-toolbar">
        <div class="legend">
          <span><i class="legend-dot fe"></i>frontend</span>
          <span><i class="legend-dot be"></i>backend</span>
          <span><i class="legend-dot srv"></i>server</span>
          <span><i class="legend-line tcp"></i>TCP rule</span>
          <span><i class="legend-line http"></i>HTTP rule</span>
          <span><i class="legend-line bridge"></i>loopback TLS hand-off</span>
        </div>
        <div class="diagram-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="download-svg">${icon('download')}Download SVG</button>
        </div>
      </div>
      <div class="topology-scroll" data-topology-scroll>${svg}</div>
      <div class="node-details" data-node-details hidden>
        <div class="node-details-empty">${icon('info')}Select a node in the graph to inspect its binds, rules or servers.</div>
      </div>
      <div class="diagram-help">
        <p>${icon('info')}Click any node for details. Dashed edges are loopback TLS hand-offs: a TCP backend forwards encrypted bytes to an internal frontend that terminates TLS. The routing table below is the exact simplified ACL view; open the Workbench for the source.</p>
      </div>
      ${routingMapHTML(model)}
      <details class="text-topology">
        <summary>Text summary of the topology</summary>
        <table class="data-table"><thead><tr><th>Type</th><th>Name</th><th>Details</th></tr></thead><tbody>
          ${tableRows.map((row) => `<tr><td><span class="pill tiny">${esc(row.kind)}</span></td><td><code>${esc(row.name)}</code></td><td>${esc(row.detail)}</td></tr>`).join('')}
        </tbody></table>
      </details>
    </section>

    <section class="tab-panel" data-topo-panel="simulate" ${initialTab === 'simulate' ? '' : 'hidden'}>
      <div class="sim-grid">
        <form class="sim-form" data-sim-form>
          <div class="section-head small"><div><span class="eyebrow">Request</span><h2>What should HAProxy do?</h2></div></div>
          <div class="form-grid">
            <label class="field"><span>Scheme</span><select name="scheme">
              <option value="https">HTTPS (TLS)</option>
              <option value="http">HTTP (cleartext)</option>
              <option value="tcp">TCP/TLS passthrough</option>
            </select></label>
            <label class="field"><span>Host header</span><input name="host" value="${esc(scenario.host)}" placeholder="learning.example.com" autocomplete="off"></label>
            <label class="field"><span>SNI</span><input name="sni" value="${esc(scenario.sni)}" placeholder="same as host" autocomplete="off"></label>
            <label class="field"><span>Port</span><input name="port" value="${esc(scenario.port)}" inputmode="numeric" autocomplete="off"></label>
            <label class="field"><span>Path</span><input name="path" value="/" autocomplete="off"></label>
            <label class="field"><span>Method</span><select name="method"><option>GET</option><option>HEAD</option><option>POST</option><option>PUT</option><option>DELETE</option><option>OPTIONS</option></select></label>
            <label class="field"><span>Client source</span><input name="source" value="203.0.113.10" autocomplete="off"></label>
            <label class="field checkbox-field"><span>Client certificate presented</span><input name="clientCert" type="checkbox"></label>
          </div>
          <div class="scenario-row">
            <button class="button-like" type="button" data-scenario="configured">Configured host</button>
            <button class="button-like" type="button" data-scenario="unknown">Unknown host</button>
            <button class="button-like" type="button" data-scenario="cleartext">Cleartext HTTP</button>
          </div>

          <details class="server-state">
            <summary>${icon('layers')}Simulate server availability <span class="badge-count">${allServers.length}</span></summary>
            <p class="muted-note">Tick servers to mark them down in this simulation. Health-check timers are not simulated.</p>
            ${allServers.length ? allServers.map(({ backend, server }) => `<label class="server-check"><input type="checkbox" data-down-server="${esc(`${backend.name}/${server.name}`)}"><span><strong>${esc(server.name)}</strong><small>${esc(server.address)} · ${esc(backend.name)}</small></span></label>`).join('') : '<p class="muted">No servers defined.</p>'}
          </details>

          <div class="sim-actions">
            <button class="btn btn-primary" type="submit">${icon('shuffle')}Run simulation</button>
            <button class="btn btn-ghost" type="button" data-action="reset-sim">${icon('history')}Reset</button>
          </div>
        </form>
        <div class="sim-output" data-sim-output>
          <div class="sim-placeholder">${icon('shuffle')}<h2>Run a request</h2><p>The simulator traces the entry frontend, request actions, use_backend order, default backend, server selection and loopback TLS hand-off.</p></div>
        </div>
      </div>
      <div class="callout info">${icon('info')}<p><strong>Model, not packet capture.</strong> The simulator evaluates a documented ACL subset, assumes HTTP/1.1 semantics, and does not resolve DNS or model TLS handshakes. Always validate with a staged HAProxy and the target configuration.</p></div>
    </section>
  `;

  const form = view.querySelector('[data-sim-form]');
  const output = view.querySelector('[data-sim-output]');
  const schemeSelect = form.elements.scheme;
  schemeSelect.value = scenario.scheme;
  if (scenario.scheme === 'http' && !query.get('port')) form.elements.port.value = '80';
  const hostInput = form.elements.host;
  const sniInput = form.elements.sni;
  const portInput = form.elements.port;
  const pathInput = form.elements.path;
  const methodSelect = form.elements.method;
  const sourceInput = form.elements.source;
  const clientCertInput = form.elements.clientCert;

  const setTab = (tab) => {
    view.querySelectorAll('[data-topo-tab]').forEach((button) => {
      button.setAttribute('aria-selected', button.dataset.topoTab === tab ? 'true' : 'false');
    });
    view.querySelectorAll('[data-topo-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.topoPanel !== tab;
    });
    const base = location.hash.split('?')[0] || '#/topology';
    history.replaceState(null, '', `${base}?tab=${tab}`);
  };

  view.querySelectorAll('[data-topo-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.topoTab));
  });

  const run = () => {
    const request = {
      scheme: schemeSelect.value,
      host: hostInput.value.trim(),
      sni: sniInput.value.trim() || hostInput.value.trim(),
      port: portInput.value.trim() || (schemeSelect.value === 'http' ? '80' : '443'),
      path: pathInput.value || '/',
      method: methodSelect.value,
      source: sourceInput.value.trim() || '203.0.113.10',
      clientCert: clientCertInput.checked,
      downServers: [...view.querySelectorAll('[data-down-server]:checked')].map((input) => input.dataset.downServer),
    };
    try {
      const result = simulateRequest(model, request);
      output.innerHTML = renderResult(result, result.request);
    } catch (error) {
      console.error(error);
      output.innerHTML = `<div class="callout danger">${icon('warning')}<p>Simulation failed: ${esc(error.message)}</p></div>`;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run();
  });
  view.querySelector('[data-action="reset-sim"]')?.addEventListener('click', () => {
    form.reset();
    schemeSelect.value = 'https';
    hostInput.value = scenario.host;
    sniInput.value = scenario.sni;
    portInput.value = '443';
    pathInput.value = '/';
    methodSelect.value = 'GET';
    sourceInput.value = '203.0.113.10';
    clientCertInput.checked = false;
    view.querySelectorAll('[data-down-server]').forEach((input) => { input.checked = false; });
    output.innerHTML = `<div class="sim-placeholder">${icon('shuffle')}<h2>Run a request</h2><p>The simulator traces the entry frontend, request actions, use_backend order, default backend, server selection and loopback TLS hand-off.</p></div>`;
  });

  view.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.scenario;
      if (value === 'configured') {
        schemeSelect.value = 'https';
        hostInput.value = scenario.host;
        sniInput.value = scenario.sni;
        portInput.value = '443';
        pathInput.value = '/';
        methodSelect.value = 'GET';
      } else if (value === 'unknown') {
        schemeSelect.value = 'https';
        hostInput.value = 'unknown.invalid';
        sniInput.value = 'unknown.invalid';
        portInput.value = '443';
        pathInput.value = '/';
        methodSelect.value = 'GET';
      } else {
        schemeSelect.value = 'http';
        hostInput.value = scenario.host;
        sniInput.value = '';
        portInput.value = '80';
        pathInput.value = '/';
        methodSelect.value = 'GET';
      }
      run();
    });
  });

  schemeSelect.addEventListener('change', () => {
    if (schemeSelect.value === 'http') portInput.value = '80';
    else portInput.value = '443';
  });
  hostInput.addEventListener('input', () => {
    if (!sniInput.value || sniInput.dataset.auto === 'true') {
      sniInput.value = hostInput.value;
      sniInput.dataset.auto = 'true';
    }
  });
  sniInput.addEventListener('input', () => { sniInput.dataset.auto = 'false'; });

  // Diagram interactions.
  const details = view.querySelector('[data-node-details]');
  const showNode = (target) => {
    const type = target.dataset.nodeType;
    const name = target.dataset.nodeName;
    const backendName = target.dataset.nodeBackend || '';
    const detail = nodeDetails(model, type, name, backendName);
    if (!detail) return;
    details.hidden = false;
    details.innerHTML = `<div class="node-details-head"><div><span class="eyebrow">${esc(type)}</span><h2>${esc(detail.title)}</h2><p>${esc(detail.subtitle)}</p></div><button class="btn btn-icon" type="button" data-close-node aria-label="Close node details">×</button></div>
      <ul>${detail.bullets.map((bullet) => `<li>${esc(bullet)}</li>`).join('')}</ul>`;
    details.querySelector('[data-close-node]')?.addEventListener('click', () => {
      details.hidden = true;
    });
    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  view.querySelector('[data-topology-scroll]')?.addEventListener('click', (event) => {
    const node = event.target.closest('[data-node-type]');
    if (node) showNode(node);
  });
  view.querySelector('[data-topology-scroll]')?.addEventListener('keydown', (event) => {
    const node = event.target.closest('[data-node-type]');
    if (node && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      showNode(node);
    }
  });

  view.querySelector('[data-action="download-svg"]')?.addEventListener('click', () => {
    const source = view.querySelector('.topology-svg');
    if (!source) return;
    const clone = source.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      text { font-family: Inter, system-ui, sans-serif; fill: #e7eefb; }
      .diagram-title { font-size: 13px; font-weight: 700; }
      .diagram-subtitle { font-size: 10px; fill: #93a3bb; }
      .diagram-meta { font-size: 9.5px; fill: #6b7c96; font-family: ui-monospace, monospace; }
      .diagram-badge { font-size: 8px; fill: #38bdf8; font-weight: 700; letter-spacing: .08em; }
      .diagram-node rect { fill: #0d1526; stroke: #334155; stroke-width: 1.2; }
      .diagram-frontend .diagram-accent { fill: #38bdf8; stroke: none; }
      .diagram-frontend.internal .diagram-accent { fill: #a78bfa; stroke: none; }
      .diagram-backend .diagram-accent { fill: #2dd4bf; stroke: none; }
      .diagram-server rect { fill: #0a1020; stroke: #334155; }
      .diagram-server.unchecked rect { stroke: #fbbf24; }
      .diagram-client rect { fill: #101b30; stroke: #334155; }
      .diagram-edge-line { fill: none; stroke: #38bdf8; stroke-width: 1.4; color: #38bdf8; }
      .diagram-edge-line.tcp { stroke: #fb923c; color: #fb923c; }
      .diagram-edge path { fill: none; stroke: #334155; stroke-width: 1.3; color: #334155; }
      .diagram-edge.tcp path { stroke: #fb923c; color: #fb923c; }
      .diagram-edge.bridge path { stroke: #a78bfa; color: #a78bfa; stroke-dasharray: 5 4; }
      .diagram-edge-label { font-size: 9px; fill: #93a3bb; font-family: ui-monospace, monospace; }
      .diagram-edge-label-bg { fill: #070b14; opacity: .9; }
      .diagram-grid { color: #94a3b8; }
    `;
    clone.prepend(style);
    const serialized = new XMLSerializer().serializeToString(clone);
    downloadText('haproxy-topology.svg', `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`, 'image/svg+xml;charset=utf-8');
    toast('Topology SVG downloaded.', { tone: 'ok' });
  });

  // Auto-run the default scenario so the page is immediately useful.
  const autoRunTimer = setTimeout(run, 80);

  return () => clearTimeout(autoRunTimer);
}
