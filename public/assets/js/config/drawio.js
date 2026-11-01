/**
 * Export the topology as an editable draw.io / diagrams.net document.
 * The output is a normal .drawio XML file with named nodes, route labels and
 * dashed loopback TLS hand-offs. It is meant for documentation and review, not
 * as a deployment artifact.
 */

import { layoutDiagram } from './diagram.js';
import { isLoopbackHost } from './parser.js';

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlLabel(title, lines) {
  return `<b>${xmlEscape(title)}</b>${lines.map((line) => `<br><font style="font-size:9px;color:#475569">${xmlEscape(line)}</font>`).join('')}`;
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
        if (!value.startsWith('-') && !['or', '||', 'if', 'unless'].includes(value)) values.push(value);
        index += 1;
      }
      inline.push({ criterion, values });
    } else if (!['if', 'unless', 'and', 'or', '||', '}'].includes(token) && !token.startsWith('-')) {
      inline.push({ criterion: token, values: [] });
    }
  }
  if (inline.length === 0) return 'condition';
  const first = inline[0];
  const name = first.criterion.includes('ssl_sni') ? 'SNI' : first.criterion.includes('host') ? 'host' : first.criterion;
  return first.values.length ? `${name} ${first.values[0]}` : name;
}

function frontendTargets(frontend) {
  const targets = new Map();
  for (const rule of frontend.rules) {
    if (!rule.backend) continue;
    if (!targets.has(rule.backend)) targets.set(rule.backend, new Set());
    targets.get(rule.backend).add(conditionLabel(rule));
  }
  if (frontend.defaultBackend) {
    if (!targets.has(frontend.defaultBackend)) targets.set(frontend.defaultBackend, new Set());
    targets.get(frontend.defaultBackend).add('default');
  } else if (frontend.type === 'listen' && frontend.servers.length > 0) {
    targets.set(frontend.name, new Set(['own servers']));
  }
  return targets;
}

/**
 * @param {object} model parsed configuration
 * @param {{version?: string}} options
 * @returns {string} draw.io XML
 */
export function renderDrawio(model, options = {}) {
  const layout = layoutDiagram(model);
  const generatedAt = new Date().toISOString();
  const cells = [
    '<mxCell id="0"/>',
    '<mxCell id="1" parent="0"/>',
  ];

  const vertex = (id, value, style, geometry) => {
    cells.push(`<mxCell id="${xmlEscape(id)}" value="${xmlEscape(value)}" style="${xmlEscape(style)}" vertex="1" parent="1"><mxGeometry x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" as="geometry"/></mxCell>`);
  };
  const edge = (id, source, target, value, kind = 'http') => {
    const color = kind === 'tcp' ? '#ea580c' : kind === 'bridge' ? '#7c3aed' : '#0284c7';
    const dashed = kind === 'bridge' ? 'dashed=1;' : '';
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;endFill=1;strokeColor=${color};strokeWidth=1.5;${dashed}labelBackgroundColor=#ffffff;fontSize=9;fontColor=#475569;`;
    cells.push(`<mxCell id="${xmlEscape(id)}" value="${xmlEscape(value)}" style="${xmlEscape(style)}" edge="1" parent="1" source="${xmlEscape(source)}" target="${xmlEscape(target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  };

  const titleStyle = 'text;html=1;align=left;verticalAlign=top;spacingLeft=0;spacingTop=0;fontSize=14;fontColor=#0f172a;fillColor=none;strokeColor=none;';
  cells.push(`<mxCell id="title" value="${xmlEscape(`<b>HAProxy Workbench — routing topology</b><br><font style="font-size:10px;color:#475569">${model.stats.frontends + model.stats.listens} frontend(s) · ${model.stats.backends + model.stats.listens} backend(s) · ${model.stats.servers} server(s) · generated ${generatedAt}${options.version ? ` · version ${options.version}` : ''}<br>Use at your own risk; validate with haproxy -c before deployment.</font>`)}" style="${xmlEscape(titleStyle)}" vertex="1" parent="1"><mxGeometry x="24" y="10" width="900" height="58" as="geometry"/></mxCell>`);

  const frontendIds = new Map();
  const backendIds = new Map();
  let frontendIndex = 0;
  let backendIndex = 0;
  let serverIndex = 0;

  vertex('client', htmlLabel('Clients', ['TLS / HTTP / TCP', 'Internet or LAN']), 'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=12;spacingTop=8;fillColor=#f1f5f9;strokeColor=#64748b;fontColor=#0f172a;', layout.client);

  for (const node of [...layout.entry, ...layout.internal]) {
    frontendIndex += 1;
    const id = `fe-${frontendIndex}`;
    frontendIds.set(node.frontend, id);
    const tls = node.frontend.binds.some((bind) => bind.ssl);
    const category = layout.entry.includes(node) ? 'entry' : 'loopback';
    const lines = [
      `${node.frontend.type} · ${node.frontend.effectiveMode.toUpperCase()}${tls ? ' · TLS termination' : ''}`,
      node.frontend.binds.map((bind) => bind.raw).join(', ') || 'no bind',
      `${node.frontend.rules.length} routing rule(s)${node.frontend.defaultBackend ? ` · default ${node.frontend.defaultBackend}` : ''}`,
      category,
    ];
    const style = `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=12;spacingTop=8;fillColor=${category === 'loopback' ? '#ede9fe' : '#e0f2fe'};strokeColor=${category === 'loopback' ? '#7c3aed' : '#0284c7'};fontColor=#0f172a;`;
    vertex(id, htmlLabel(node.frontend.name || '(unnamed)', lines), style, node);
  }

  for (const node of layout.backends.values()) {
    backendIndex += 1;
    const id = `be-${backendIndex}`;
    backendIds.set(node.backend.name, id);
    const checked = node.backend.servers.filter((server) => server.flags.has('check')).length;
    const lines = [
      `backend · ${node.backend.effectiveMode.toUpperCase()} · ${node.backend.balance || 'random (3.3+)'}`,
      `${node.backend.servers.length} server(s) · ${checked} checked`,
    ];
    vertex(id, htmlLabel(node.backend.name, lines), 'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=12;spacingTop=8;fillColor=#ccfbf1;strokeColor=#0f766e;fontColor=#0f172a;', node);
  }

  const serverIds = new Map();
  for (const node of layout.servers) {
    serverIndex += 1;
    const id = `srv-${serverIndex}`;
    serverIds.set(node, id);
    const lines = [
      node.server.address,
      `${node.server.flags.has('check') ? 'check enabled' : 'no check'}${node.server.flags.has('ssl') ? ' · upstream TLS' : ''}`,
    ];
    const style = `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fillColor=${node.server.flags.has('check') ? '#f8fafc' : '#fffbeb'};strokeColor=${node.server.flags.has('check') ? '#475569' : '#d97706'};fontColor=#0f172a;`;
    vertex(id, htmlLabel(node.server.name, lines), style, node);
  }

  let edgeIndex = 0;
  const addEdge = (source, target, label, kind) => {
    edgeIndex += 1;
    edge(`e-${edgeIndex}`, source, target, label, kind);
  };

  for (const node of layout.entry) {
    const id = frontendIds.get(node.frontend);
    if (id) addEdge('client', id, '', node.frontend.effectiveMode === 'tcp' ? 'tcp' : 'http');
  }

  for (const node of [...layout.entry, ...layout.internal]) {
    const source = frontendIds.get(node.frontend);
    for (const [backendName, labels] of frontendTargets(node.frontend)) {
      const target = backendIds.get(backendName);
      if (!target) continue;
      addEdge(source, target, [...labels].join(', '), node.frontend.effectiveMode === 'tcp' ? 'tcp' : 'http');
    }
  }

  for (const node of layout.backends.values()) {
    const source = backendIds.get(node.backend.name);
    for (const server of node.backend.servers) {
      if (!isLoopbackHost(server.host)) continue;
      const internalNode = layout.internal.find((entry) =>
        entry.frontend.binds.some((bind) => String(bind.port) === String(server.port) && isLoopbackHost(bind.host)),
      );
      if (internalNode) {
        const target = frontendIds.get(internalNode.frontend);
        if (target) addEdge(source, target, 'TLS hand-off', 'bridge');
      }
    }
  }

  for (const node of layout.servers) {
    const source = backendIds.get(node.backend.name);
    const target = serverIds.get(node);
    if (source && target) addEdge(source, target, '', node.backend.effectiveMode === 'tcp' ? 'tcp' : 'http');
  }

  const pageWidth = Math.max(1400, layout.width + 80);
  const pageHeight = Math.max(900, layout.height + 110);
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="HAProxy Workbench" modified="${generatedAt}" agent="HAProxy Workbench" version="1.0" type="device">
  <diagram id="haproxy-topology" name="HAProxy routing topology">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

export { xmlEscape };
