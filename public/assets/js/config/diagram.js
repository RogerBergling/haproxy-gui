/**
 * SVG topology renderer.
 *
 * Edges represent the actual routing graph: frontends to backends, loopback
 * backends to internal frontends, and backends to servers. The renderer is
 * deliberately dependency-free and clickable via data attributes.
 */

import { findBackend, isLoopbackHost } from './parser.js';

const WIDTHS = {
  client: 118,
  frontend: 236,
  backend: 226,
  server: 218,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(value, max = 30) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function conditionLabel(rule) {
  if (!rule.condition || rule.condition.length === 0) return 'always';
  const inline = [];
  let criterion = '';
  let values = [];
  for (let index = 0; index < rule.condition.length; index += 1) {
    const token = rule.condition[index];
    if (token === '{') {
      criterion = rule.condition[index + 1] || '';
      values = [];
      index += 2;
      while (index < rule.condition.length && rule.condition[index] !== '}') {
        const value = rule.condition[index];
        if (!value.startsWith('-') && value !== 'or' && value !== '||') values.push(value);
        index += 1;
      }
      inline.push({ criterion, values });
    } else if (!['if', 'unless', 'and', 'or', '||', '}'].includes(token) && !token.startsWith('-')) {
      inline.push({ criterion: token, values: [] });
    }
  }
  if (inline.length === 0) return 'condition';
  const first = inline[0];
  const label = first.criterion.includes('ssl_sni') ? 'SNI' : first.criterion.includes('host') ? 'host' : first.criterion;
  if (first.values.length === 0) return label;
  return `${label} ${first.values[0]}`;
}

function collectFrontends(model) {
  const entry = [];
  const internal = [];
  for (const frontend of model.frontends) {
    const publicBinds = frontend.binds.filter((bind) => !isLoopbackHost(bind.host));
    if (publicBinds.length > 0) entry.push(frontend);
    else if (frontend.binds.length > 0) internal.push(frontend);
  }
  return { entry, internal };
}

function nodeText(lines, x, y, options = {}) {
  return lines.map((line, index) => {
    const cls = index === 0 ? 'diagram-title' : index === 1 ? 'diagram-subtitle' : 'diagram-meta';
    return `<text class="${cls}" x="${x}" y="${y + index * (options.lineHeight || 17)}">${esc(truncate(line, options.max || 32))}</text>`;
  }).join('');
}

function frontendNode(frontend, x, y, category) {
  const tls = frontend.binds.some((bind) => bind.ssl);
  const mode = frontend.effectiveMode.toUpperCase();
  const binds = frontend.binds.map((bind) => bind.raw.replace(/^[a-z0-9]+@/i, '')).slice(0, 2).join(', ');
  const lines = [
    frontend.name || '(unnamed)',
    `${frontend.type} · ${mode}${tls ? ' · TLS termination' : frontend.type === 'frontend' && frontend.effectiveMode === 'tcp' ? ' · passthrough' : ''}`,
    binds || 'no bind',
    `${frontend.rules.length} rule${frontend.rules.length === 1 ? '' : 's'} · default ${frontend.defaultBackend || '—'}`,
  ];
  return `<g class="diagram-node diagram-frontend ${tls ? 'tls' : ''} ${category}" data-node-type="frontend" data-node-name="${esc(frontend.name)}" tabindex="0" role="button" aria-label="${esc(frontend.type)} ${esc(frontend.name)}">
    <title>${esc(frontend.type)} ${esc(frontend.name)} — ${esc(binds)} (${mode})</title>
    <rect x="${x}" y="${y}" width="${WIDTHS.frontend}" height="88" rx="12"></rect>
    <rect class="diagram-accent" x="${x}" y="${y}" width="4" height="88" rx="2"></rect>
    ${nodeText(lines, x + 16, y + 23, { max: 34 })}
    ${tls ? `<text class="diagram-badge" x="${x + WIDTHS.frontend - 16}" y="${y + 21}" text-anchor="end">TLS</text>` : ''}
  </g>`;
}

function backendNode(backend, x, y) {
  const servers = backend.servers;
  const lines = [
    backend.name,
    `backend · ${backend.effectiveMode.toUpperCase()} · ${backend.balance || 'random (3.3+)'}`,
    `${servers.length} server${servers.length === 1 ? '' : 's'}${servers.length ? ` · ${servers.filter((server) => server.flags.has('check')).length} checked` : ''}`,
  ];
  return `<g class="diagram-node diagram-backend" data-node-type="backend" data-node-name="${esc(backend.name)}" tabindex="0" role="button" aria-label="backend ${esc(backend.name)}">
    <title>backend ${esc(backend.name)} — ${servers.length} servers</title>
    <rect x="${x}" y="${y}" width="${WIDTHS.backend}" height="82" rx="12"></rect>
    <rect class="diagram-accent" x="${x}" y="${y}" width="4" height="82" rx="2"></rect>
    ${nodeText(lines, x + 16, y + 23, { max: 30 })}
  </g>`;
}

function serverNode(server, backend, x, y) {
  const checked = server.flags.has('check');
  const tls = server.flags.has('ssl');
  const lines = [
    server.name || '(unnamed)',
    server.address || 'no address',
    `${checked ? 'check' : 'no check'}${tls ? ' · TLS upstream' : ''}${server.flags.has('backup') ? ' · backup' : ''}`,
  ];
  return `<g class="diagram-node diagram-server ${checked ? 'checked' : 'unchecked'}" data-node-type="server" data-node-name="${esc(server.name)}" data-node-backend="${esc(backend.name)}" tabindex="0" role="button" aria-label="server ${esc(server.name)} in ${esc(backend.name)}">
    <title>server ${esc(server.name)} — ${esc(server.address)} (${checked ? 'check enabled' : 'no check'})</title>
    <rect x="${x}" y="${y}" width="${WIDTHS.server}" height="64" rx="10"></rect>
    ${nodeText(lines, x + 14, y + 21, { max: 31, lineHeight: 16 })}
  </g>`;
}

function serverPositionForBackend(backend, layout, server, index) {
  const backendNodePosition = layout.backends.get(backend.name);
  return {
    x: layout.serverX,
    y: (backendNodePosition?.y || 70) + index * 72,
  };
}

function edge(source, target, label, options = {}) {
  const reverse = options.reverse === true;
  const x1 = reverse ? source.x : source.x + source.width;
  const y1 = source.y + source.height / 2;
  const x2 = reverse ? target.x + target.width : target.x;
  const y2 = target.y + target.height / 2;
  const curve = Math.max(22, Math.abs(x2 - x1) * 0.45);
  const path = reverse
    ? `M ${x1} ${y1} C ${x1 - curve} ${y1}, ${x2 + curve} ${y2}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const text = truncate(label, 30);
  const width = Math.max(44, text.length * 6.2 + 14);
  const marker = options.kind === 'bridge' ? 'bridge' : options.kind === 'tcp' ? 'tcp' : 'http';
  const labelMarkup = options.showLabel === false || !label
    ? ''
    : `<rect class="diagram-edge-label-bg" x="${midX - width / 2}" y="${midY - 20}" width="${width}" height="17" rx="5"></rect>
       <text class="diagram-edge-label" x="${midX}" y="${midY - 8}" text-anchor="middle">${esc(text)}</text>`;
  return `<g class="diagram-edge ${options.kind || ''}">
    ${options.title ? `<title>${esc(options.title)}</title>` : ''}
    <path d="${path}" marker-end="url(#arrow-${marker})"></path>
    ${labelMarkup}
  </g>`;
}

function collectFrontendTargets(frontend, model) {
  const targets = new Map();
  for (const rule of frontend.rules) {
    if (!rule.backend) continue;
    if (!targets.has(rule.backend)) targets.set(rule.backend, { labels: [], rules: [] });
    targets.get(rule.backend).labels.push(conditionLabel(rule));
    targets.get(rule.backend).rules.push(rule);
  }
  if (frontend.defaultBackend) {
    if (!targets.has(frontend.defaultBackend)) targets.set(frontend.defaultBackend, { labels: ['default'], rules: [] });
    else targets.get(frontend.defaultBackend).labels.unshift('default');
  } else if (frontend.type === 'listen' && frontend.servers.length > 0) {
    targets.set(frontend.name, { labels: ['own servers'], rules: [] });
  }
  return targets;
}

export function layoutDiagram(model) {
  const { entry, internal } = collectFrontends(model);
  const hasInternal = internal.length > 0;
  const columns = {
    clientX: 24,
    entryX: 188,
    internalX: hasInternal ? 468 : null,
    backendX: hasInternal ? 748 : 468,
    serverX: hasInternal ? 1048 : 768,
  };
  const width = hasInternal ? 1300 : 1020;
  const layout = {
    entry: [],
    internal: [],
    backends: new Map(),
    servers: [],
    columns,
    width,
    hasInternal,
  };

  let entryY = 74;
  for (const frontend of entry) {
    layout.entry.push({ frontend, x: columns.entryX, y: entryY, width: WIDTHS.frontend, height: 88 });
    entryY += 108;
  }

  let internalY = 74;
  for (const frontend of internal) {
    layout.internal.push({ frontend, x: columns.internalX, y: internalY, width: WIDTHS.frontend, height: 88 });
    internalY += 108;
  }

  const backends = model.backends;
  let backendY = 74;
  for (const backend of backends) {
    layout.backends.set(backend.name, {
      backend,
      x: columns.backendX,
      y: backendY,
      width: WIDTHS.backend,
      height: 82,
    });
    let serverY = backendY;
    for (const server of backend.servers) {
      layout.servers.push({
        backend,
        server,
        x: columns.serverX,
        y: serverY,
        width: WIDTHS.server,
        height: 64,
      });
      serverY += 72;
    }
    backendY = Math.max(backendY + 104, serverY + 18);
  }

  const clientTop = layout.entry.length ? layout.entry[0].y : 74;
  const clientBottom = layout.entry.length ? layout.entry[layout.entry.length - 1].y + 88 : clientTop + 88;
  layout.client = {
    x: columns.clientX,
    y: Math.max(74, (clientTop + clientBottom) / 2 - 45),
    width: WIDTHS.client,
    height: 90,
  };

  layout.height = Math.max(
    300,
    ...layout.entry.map((entryNode) => entryNode.y + entryNode.height),
    ...layout.internal.map((entryNode) => entryNode.y + entryNode.height),
    ...[...layout.backends.values()].map((entryNode) => entryNode.y + entryNode.height),
    ...layout.servers.map((entryNode) => entryNode.y + entryNode.height),
  ) + 42;

  return layout;
}

export function renderDiagramSVG(model) {
  const layout = layoutDiagram(model);
  const showLabels = (model.stats.rules || 0) <= 6;
  const parts = [];
  parts.push(`<svg class="topology-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-labelledby="topo-title topo-desc" xmlns="http://www.w3.org/2000/svg">
    <title id="topo-title">HAProxy routing topology</title>
    <desc id="topo-desc">Clients connect to frontends, which route to backends and servers. Loopback hand-offs represent internal TLS termination.</desc>
    <defs>
      <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M 28 0 L 0 0 0 28" fill="none" stroke="currentColor" stroke-opacity=".055" stroke-width="1"></path>
      </pattern>
      <marker id="arrow-http" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path></marker>
      <marker id="arrow-tcp" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path></marker>
      <marker id="arrow-bridge" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path></marker>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" class="diagram-grid"></rect>`);

  const client = layout.client;
  parts.push(`<g class="diagram-client">
    <rect x="${client.x}" y="${client.y}" width="${client.width}" height="${client.height}" rx="14"></rect>
    <text class="diagram-title" x="${client.x + 16}" y="${client.y + 27}">Clients</text>
    <text class="diagram-subtitle" x="${client.x + 16}" y="${client.y + 47}">TLS / HTTP / TCP</text>
    <text class="diagram-meta" x="${client.x + 16}" y="${client.y + 66}">Internet or LAN</text>
  </g>`);

  for (const node of layout.entry) {
    parts.push(frontendNode(node.frontend, node.x, node.y, 'entry'));
    // Client edges intentionally have no labels.
    const path = `M ${client.x + client.width} ${client.y + client.height / 2} C ${client.x + client.width + 40} ${client.y + client.height / 2}, ${node.x - 40} ${node.y + 44}, ${node.x} ${node.y + 44}`;
    parts.push(`<path class="diagram-edge-line ${node.frontend.effectiveMode === 'tcp' ? 'tcp' : 'http'}" d="${path}" marker-end="url(#arrow-${node.frontend.effectiveMode === 'tcp' ? 'tcp' : 'http'})"></path>`);
  }

  for (const node of layout.internal) {
    parts.push(frontendNode(node.frontend, node.x, node.y, 'internal'));
  }

  for (const node of layout.backends.values()) {
    parts.push(backendNode(node.backend, node.x, node.y));
  }

  for (const node of layout.servers) {
    parts.push(serverNode(node.server, node.backend, node.x, node.y));
  }

  // Frontend -> backend routes.
  for (const node of [...layout.entry, ...layout.internal]) {
    const targets = collectFrontendTargets(node.frontend, model);
    for (const [backendName, info] of targets) {
      const target = layout.backends.get(backendName);
      if (!target) continue;
      const labels = [...new Set(info.labels)];
      const visible = labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '');
      parts.push(edge(node, target, visible, {
        kind: node.frontend.effectiveMode === 'tcp' ? 'tcp' : 'http',
        title: `${node.frontend.name} → ${backendName}: ${labels.join(', ')}`,
        showLabel: showLabels,
      }));
    }
  }

  // Loopback backend -> internal frontend hand-offs.
  for (const node of layout.backends.values()) {
    for (const server of node.backend.servers) {
      if (!isLoopbackHost(server.host)) continue;
      const internalNode = layout.internal.find((entry) =>
        entry.frontend.binds.some((bind) => String(bind.port) === String(server.port) && isLoopbackHost(bind.host)),
      );
      if (internalNode) {
        parts.push(edge(node, internalNode, 'TLS hand-off', {
          kind: 'bridge',
          reverse: true,
          showLabel: showLabels,
          title: `${node.backend.name} server ${server.name} (${server.address}) → ${internalNode.frontend.name}`,
        }));
      }
    }
  }

  // Backend -> server edges.
  for (const node of layout.servers) {
    const backendNode = layout.backends.get(node.backend.name);
    if (backendNode) {
      const path = `M ${backendNode.x + backendNode.width} ${backendNode.y + backendNode.height / 2} C ${backendNode.x + backendNode.width + 35} ${backendNode.y + backendNode.height / 2}, ${node.x - 35} ${node.y + 32}, ${node.x} ${node.y + 32}`;
      parts.push(`<path class="diagram-edge-line ${node.backend.effectiveMode === 'tcp' ? 'tcp' : 'http'}" d="${path}" marker-end="url(#arrow-${node.backend.effectiveMode === 'tcp' ? 'tcp' : 'http'})"></path>`);
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function diagramSummaryRows(model) {
  const rows = [];
  for (const frontend of model.frontends) {
    rows.push({
      kind: frontend.type,
      name: frontend.name,
      detail: `${frontend.effectiveMode.toUpperCase()} · binds ${frontend.binds.map((bind) => bind.raw).join(', ') || 'none'} · ${frontend.rules.length} routing rule(s)`,
    });
  }
  for (const backend of model.backends) {
    rows.push({
      kind: backend.type,
      name: backend.name,
      detail: `${backend.effectiveMode.toUpperCase()} · ${backend.balance || 'roundrobin'} · ${backend.servers.length} server(s)`,
    });
  }
  return rows;
}

export function nodeDetails(model, type, name, backendName = '') {
  if (type === 'frontend') {
    const frontend = model.frontends.find((entry) => entry.name === name);
    if (!frontend) return null;
    return {
      title: `${frontend.type} ${frontend.name}`,
      subtitle: `${frontend.effectiveMode.toUpperCase()} mode · lines ${frontend.line}–${frontend.endLine}`,
      bullets: [
        ...frontend.binds.map((bind) => `bind ${bind.raw}${bind.ssl ? ' (TLS termination)' : ''}${isLoopbackHost(bind.host) ? ' (loopback)' : ''}`),
        ...frontend.rules.map((rule) => `use_backend ${rule.backend}${rule.condition ? ` if ${rule.condition.join(' ')}` : ''}`),
        frontend.defaultBackend ? `default_backend ${frontend.defaultBackend}` : 'No default_backend',
      ],
    };
  }
  if (type === 'backend') {
    const backend = findBackend(model, name);
    if (!backend) return null;
    return {
      title: `backend ${backend.name}`,
      subtitle: `${backend.effectiveMode.toUpperCase()} · ${backend.balance || 'roundrobin'} · ${backend.servers.length} server(s)`,
      bullets: backend.servers.map((server) => `${server.name} → ${server.address}${server.flags.has('check') ? ' · check' : ' · no check'}${server.flags.has('backup') ? ' · backup' : ''}`),
    };
  }
  if (type === 'server') {
    const backend = findBackend(model, backendName);
    const server = backend?.servers.find((entry) => entry.name === name);
    if (!server) return null;
    return {
      title: `server ${server.name}`,
      subtitle: `${server.address} in ${backendName}`,
      bullets: [
        server.flags.has('check') ? 'Active health check enabled' : 'No active health check',
        server.flags.has('backup') ? 'Backup server' : 'Primary server',
        server.options.weight ? `Weight ${server.options.weight}` : 'Default weight',
        server.flags.has('ssl') ? 'Upstream TLS enabled' : 'No upstream TLS',
      ],
    };
  }
  return null;
}
