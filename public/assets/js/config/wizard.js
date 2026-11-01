/**
 * Guided service wizard.
 *
 * The wizard inspects the imported configuration, finds a safe insertion point
 * (existing TLS termination, plain HTTP frontend, SNI passthrough edge, or a
 * loopback termination behind a passthrough bridge), then returns a complete
 * proposed configuration. Nothing is applied until the caller saves it.
 */

import { stampWorkbenchChange } from './change.js';
import { applyEdits, ensureTrailingNewline } from './edit.js';
import { findBackend, isLoopbackHost, parseConfig } from './parser.js';
import { evaluateCondition } from './simulate.js';
import { detectConfigStyle, describeStyle, resourceComment, routeComment, styleLines } from './style.js';

export const SERVICE_KINDS = [
  {
    id: 'https',
    label: 'HTTPS website',
    short: 'TLS termination',
    description: 'Terminate TLS in HAProxy, route by Host header and forward to an application server.',
    icon: 'lock',
  },
  {
    id: 'http',
    label: 'HTTP website',
    short: 'Cleartext HTTP',
    description: 'Route a hostname over HTTP, or add a host route to an existing HTTP/HTTPS listener.',
    icon: 'globe',
  },
  {
    id: 'tcp',
    label: 'TLS passthrough',
    short: 'TCP / SNI',
    description: 'Forward an encrypted TLS stream by SNI without terminating it in HAProxy.',
    icon: 'shuffle',
  },
];

const HOST_RE = /^(\*\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function sanitizeName(value, fallback = 'service') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

function uniqueName(base, existing, suffix = '') {
  let candidate = `${base}${suffix}`;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${base}${suffix}_${index}`;
    index += 1;
  }
  existing.add(candidate);
  return candidate;
}

function parseHosts(value) {
  return [...new Set(
    String(value || '')
      .split(/[\s,]+/)
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  )];
}

function validateHosts(hosts) {
  const errors = [];
  for (const host of hosts) {
    if (host.includes('://') || host.includes('/')) {
      errors.push(`"${host}" is not a hostname. Enter only the DNS name, without scheme or path.`);
    } else if (host.startsWith('*.')) {
      const suffix = host.slice(2);
      if (!suffix || suffix.includes('*') || !HOST_RE.test(suffix)) {
        errors.push(`"${host}" is not a valid wildcard hostname. Use a form such as *.example.com.`);
      }
    } else if (!HOST_RE.test(host) && !IPV4_RE.test(host)) {
      errors.push(`"${host}" does not look like a valid hostname.`);
    }
  }
  return errors;
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

/**
 * A service entry can be a short host ("app"), a wildcard ("*.apps"), an apex
 * marker ("@"), or a fully qualified name. Short names receive the entered
 * domain so generated ACLs never use a bare host name by accident.
 */
function resolveHosts(entries, domain, errors) {
  const resolved = [];
  if (domain && (!HOST_RE.test(domain) || domain.startsWith('*.') || domain.includes('://') || domain.includes('/'))) {
    errors.push(`"${domain}" is not a valid domain. Use a DNS domain such as example.com.`);
  }
  for (const entry of entries) {
    let host = entry;
    if (host === '@') {
      if (!domain) {
        errors.push('Use @ for the apex domain only after entering a domain.');
        continue;
      }
      host = domain;
    } else {
      const wildcard = host.startsWith('*.');
      const bare = wildcard ? host.slice(2) : host;
      const isIp = IPV4_RE.test(bare);
      if (!isIp && !bare.includes('.')) {
        if (!domain) {
          errors.push(`"${entry}" is only a host name. Enter a domain or use a fully qualified hostname.`);
          continue;
        }
        host = `${wildcard ? '*.' : ''}${bare}.${domain}`;
      } else if (wildcard && !bare.includes('.') && domain) {
        host = `*.${bare}.${domain}`;
      }
    }
    resolved.push(host);
  }
  return [...new Set(resolved)];
}

function parseAddress(value, defaultPort) {
  const input = String(value || '').trim();
  if (!input) return { error: 'Enter the application server address, for example 192.0.2.50:8000.' };
  if (/\s/.test(input)) return { error: 'The server address must not contain spaces.' };
  if (input.includes('://')) return { error: 'Use host:port without a scheme (for example 192.0.2.50:8000).' };

  let host = '';
  let port = '';
  if (input.startsWith('[')) {
    const close = input.indexOf(']');
    if (close < 0) return { error: 'Invalid IPv6 address; use [2001:db8::10]:8000.' };
    host = input.slice(1, close);
    const rest = input.slice(close + 1);
    port = rest.startsWith(':') ? rest.slice(1) : '';
  } else {
    const colon = input.lastIndexOf(':');
    if (colon >= 0) {
      host = input.slice(0, colon);
      port = input.slice(colon + 1);
    } else {
      host = input;
    }
  }
  if (!host) return { error: 'Enter a server hostname or IP address.' };
  if (!port) {
    port = String(defaultPort);
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { error: 'The server port must be a number between 1 and 65535.' };
  }
  return { host, port, address: host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`, warning: value.includes(':') ? null : `No port supplied; using ${port}.` };
}

function entryFrontends(model, kind) {
  const result = [];
  for (const frontend of model.frontends) {
    const publicBinds = frontend.binds.filter((bind) => !isLoopbackHost(bind.host));
    if (publicBinds.length === 0) continue;
    if (kind === 'https') {
      if (frontend.effectiveMode === 'http' && frontend.binds.some((bind) => bind.ssl)) {
        result.push({ frontend, publicBinds, loopback: false });
      }
    } else if (kind === 'http') {
      if (frontend.effectiveMode === 'http' && frontend.binds.some((bind) => !bind.ssl)) {
        result.push({ frontend, publicBinds, loopback: false });
      }
    } else if (kind === 'tcp') {
      if (
        frontend.effectiveMode === 'tcp' &&
        frontend.binds.some((bind) => !bind.ssl) &&
        (frontend.rules.some((rule) => rule.condition?.some((token) => token.includes('ssl_sni'))) ||
          frontend.binds.some((bind) => bind.port === '443'))
      ) {
        result.push({ frontend, publicBinds, loopback: false });
      }
    }
  }
  return result;
}

function internalHttpsFrontends(model) {
  return model.frontends.filter((frontend) =>
    frontend.effectiveMode === 'http' &&
    frontend.binds.some((bind) => bind.ssl) &&
    frontend.binds.some((bind) => isLoopbackHost(bind.host)),
  );
}

function bridgeCandidates(model) {
  const candidates = [];
  const seen = new Set();
  for (const frontend of model.frontends) {
    if (frontend.effectiveMode !== 'tcp') continue;
    if (!frontend.binds.some((bind) => !isLoopbackHost(bind.host))) continue;
    const targets = [
      ...frontend.rules.map((rule) => ({ backend: rule.backend, rule })),
      ...(frontend.defaultBackend ? [{ backend: frontend.defaultBackend, rule: null }] : []),
    ];
    for (const target of targets) {
      const backend = target.backend ? findBackend(model, target.backend) : null;
      if (!backend || backend.effectiveMode !== 'tcp') continue;
      for (const server of backend.servers) {
        if (!isLoopbackHost(server.host)) continue;
        const internal = model.frontends.find((candidate) =>
          candidate !== frontend &&
          candidate.effectiveMode === 'http' &&
          candidate.binds.some((bind) => String(bind.port) === String(server.port) && isLoopbackHost(bind.host)) &&
          candidate.binds.some((bind) => bind.ssl),
        );
        if (!internal) continue;
        const id = `bridge:${frontend.name}:${backend.name}:${internal.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push({
          id,
          kind: 'bridge',
          label: `${frontend.name} → ${internal.name}`,
          detail: `SNI at ${frontend.name}, encrypted stream handed to ${internal.name} on ${server.address}, then routed by Host.`,
          frontend: internal,
          edgeFrontend: frontend,
          bridgeBackend: backend,
          loopback: true,
          score: 80,
        });
      }
    }
  }
  return candidates;
}

function directCandidates(model, kind) {
  const result = [];
  if (kind === 'https') {
    for (const frontend of model.frontends) {
      if (frontend.effectiveMode !== 'http' || !frontend.binds.some((bind) => bind.ssl)) continue;
      const publicBind = frontend.binds.some((bind) => bind.ssl && !isLoopbackHost(bind.host));
      result.push({
        id: `frontend:${frontend.name}`,
        kind: 'direct',
        label: `Terminate at ${frontend.name}`,
        detail: publicBind
          ? `Add a Host rule to the existing public TLS frontend ${frontend.name}.`
          : `${frontend.name} terminates TLS on a loopback bind. The new host must also be routed to it by an edge frontend.`,
        frontend,
        loopback: !publicBind,
        score: publicBind ? 100 : 30,
      });
    }
  } else if (kind === 'http') {
    for (const frontend of model.frontends) {
      if (frontend.effectiveMode !== 'http' || !frontend.binds.some((bind) => !bind.ssl)) continue;
      const publicPlain = frontend.binds.some((bind) => !bind.ssl && !isLoopbackHost(bind.host));
      result.push({
        id: `frontend:${frontend.name}`,
        kind: 'direct',
        label: `Route at ${frontend.name}`,
        detail: `${publicPlain ? 'Add a Host rule to the existing HTTP frontend' : 'Add a Host rule to the loopback HTTP frontend'} ${frontend.name}.`,
        frontend,
        loopback: !publicPlain,
        score: publicPlain ? 95 : 25,
      });
    }
  } else {
    for (const frontend of model.frontends) {
      if (frontend.effectiveMode !== 'tcp') continue;
      if (!frontend.binds.some((bind) => !bind.ssl && !isLoopbackHost(bind.host))) continue;
      const hasSni = frontend.rules.some((rule) => rule.condition?.some((token) => token.includes('ssl_sni')));
      result.push({
        id: `frontend:${frontend.name}`,
        kind: 'direct',
        label: `SNI route at ${frontend.name}`,
        detail: hasSni
          ? `Add a req_ssl_sni rule to the existing TCP frontend ${frontend.name}.`
          : `${frontend.name} is a TCP listener; SNI routing will be added. Confirm that clients send SNI.`,
        frontend,
        loopback: false,
        score: hasSni ? 95 : 70,
      });
    }
  }
  return result;
}

function candidateList(model, kind) {
  const list = [...directCandidates(model, kind)];
  if (kind === 'https') list.push(...bridgeCandidates(model));
  return list.sort((left, right) => right.score - left.score);
}

function findTarget(candidates, id) {
  if (!id || id === 'auto') return candidates[0] || null;
  return candidates.find((candidate) => candidate.id === id) || null;
}

function routingInsertionLine(frontend) {
  const firstRule = frontend.items.find((item) => item.keyword === 'use_backend');
  if (firstRule) return firstRule.line;
  const defaultBackend = frontend.items.find((item) => item.keyword === 'default_backend');
  if (defaultBackend) return defaultBackend.line;
  return frontend.endLine + 1;
}

/**
 * Insert before the first existing rule that would match one of the new hosts,
 * otherwise immediately before default_backend. This preserves the existing
 * grouping/order as much as possible while still guaranteeing precedence.
 */
function safeRoutingInsertionLine(frontend, hosts, criterion) {
  let earliestRule = null;
  for (const host of hosts) {
    const match = hostRoutedTo(frontend, host, '', criterion);
    if (match?.rule?.line) {
      earliestRule = earliestRule === null ? match.rule.line : Math.min(earliestRule, match.rule.line);
    }
  }
  if (earliestRule !== null) return earliestRule;
  const defaultBackend = frontend.items.find((item) => item.keyword === 'default_backend');
  if (defaultBackend) return defaultBackend.line;
  return frontend.endLine + 1;
}

function insertionAfterLastSection(model, types, fallbackTypes) {
  const sections = model.sections.filter((section) => types.includes(section.type));
  if (sections.length > 0) return sections[sections.length - 1].endLine + 1;
  const fallback = model.sections.filter((section) => fallbackTypes.includes(section.type));
  if (fallback.length > 0) return fallback[fallback.length - 1].endLine + 1;
  return model.lines.length + (model.text.endsWith('\n') ? 0 : 1);
}

function frontendInsertionLine(model) {
  return insertionAfterLastSection(model, ['frontend', 'listen'], ['global', 'defaults']);
}

function backendInsertionLine(model) {
  return insertionAfterLastSection(model, ['backend', 'listen'], ['frontend']);
}

function routeLine(backend, host, criterion) {
  if (host.startsWith('*.')) {
    return `use_backend ${backend} if { ${criterion} -m end ${host.slice(1)} }`;
  }
  return `use_backend ${backend} if { ${criterion} -i ${host} }`;
}

function routeBlock(style, hosts, backend, criterion) {
  return [
    ...routeComment(style, hosts, backend).map((line) => `${style.indent}${line}`),
    ...styleLines(style, hosts.map((host) => routeLine(backend, host, criterion))),
  ];
}

function portInUse(model, port) {
  return model.frontends.some((frontend) =>
    frontend.binds.some((bind) => String(bind.port) === String(port)),
  );
}

function normalizedBindHost(host) {
  const value = String(host || '*').trim().toLowerCase();
  if (!value || value === '*' || value === '0.0.0.0' || value === '::' || value === '[::]') return '*';
  return value.replace(/^\[|\]$/g, '');
}

/** Find an existing bind that would collide with a proposed address/port. */
export function findBindConflict(model, address, port) {
  const host = normalizedBindHost(address);
  for (const frontend of model.frontends) {
    for (const bind of frontend.binds) {
      if (String(bind.port) !== String(port)) continue;
      const existingHost = normalizedBindHost(bind.host);
      if (host === '*' || existingHost === '*' || host === existingHost) {
        return { frontend, bind };
      }
    }
  }
  return null;
}

export function validateBindAddress(address) {
  const value = String(address || '').trim();
  if (!value) return null;
  if (/\s/.test(value)) return 'Listen address must not contain spaces.';
  if (value === '*' || value === '0.0.0.0' || value === '::' || value === '[::]') return null;
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(value) || /^\[[^\]]+\]:\d+$/.test(value)) {
    return 'Put the listen port in the port field, not in the IP address.';
  }
  const withoutBrackets = value.replace(/^\[|\]$/g, '');
  if (withoutBrackets.includes(':')) {
    if (!/^[0-9a-f:]+$/i.test(withoutBrackets) || !withoutBrackets.includes('::') && withoutBrackets.split(':').length < 3) {
      return 'Use a valid IPv6 address, or put the port in the port field.';
    }
    return null;
  }
  if (!/^[a-z0-9._-]+$/i.test(value)) {
    return 'Use *, an IPv4/IPv6 address, or a hostname/interface name without spaces.';
  }
  return null;
}

export function formatBindHost(address) {
  const value = String(address || '').trim();
  if (!value || value === '*') return '*';
  if (value.startsWith('[') && value.endsWith(']')) return value;
  if (value.includes(':')) return `[${value}]`;
  return value;
}

function hostRoutedTo(frontend, host, backendName, criterion) {
  const request = {
    scheme: 'https',
    host,
    sni: host,
    port: '443',
    path: '/',
    method: 'GET',
    source: '203.0.113.10',
    headers: {},
  };
  const context = { tlsTerminated: false, httpVisible: frontend.effectiveMode === 'http' };
  for (const rule of frontend.rules) {
    const result = evaluateCondition(rule.condition, rule.negate, request, context, frontend);
    if (result.matched) return { backend: rule.backend, rule };
  }
  return frontend.defaultBackend ? { backend: frontend.defaultBackend, rule: null } : null;
}

function normalizeForm(form, model) {
  const kind = SERVICE_KINDS.some((entry) => entry.id === form.kind) ? form.kind : 'https';
  const domain = normalizeDomain(form.domain);
  const entries = parseHosts(form.hosts);
  const errors = [];
  if (entries.length === 0) errors.push('Enter at least one hostname.');
  if (entries.length > 20) errors.push('Add at most 20 hostnames at a time.');
  const hosts = resolveHosts(entries, domain, errors);
  errors.push(...validateHosts(hosts));
  const defaultPort = kind === 'http' ? 80 : 443;
  const server = parseAddress(form.server, defaultPort);
  if (server.error) errors.push(server.error);
  const name = sanitizeName(
    form.name ||
    hosts[0]?.replace(/^\*\./, '').split('.')[0] ||
    domain.split('.')[0] ||
    'service',
  );
  const entryPort = String(form.entryPort || (kind === 'http' ? 80 : 443));
  if (!/^\d+$/.test(entryPort) || Number(entryPort) < 1 || Number(entryPort) > 65535) {
    errors.push('Entry port must be between 1 and 65535.');
  }
  const bindAddress = String(form.bindAddress || '*').trim() || '*';
  const check = form.check !== false;
  const balance = ['roundrobin', 'leastconn', 'source', 'first'].includes(form.balance) ? form.balance : 'roundrobin';
  return {
    kind,
    hosts,
    domain,
    name,
    server,
    entryPort,
    bindAddress,
    check,
    balance,
    serverSsl: Boolean(form.serverSsl),
    cert: String(form.cert || '').trim(),
    target: form.target || 'auto',
    errors,
  };
}

/**
 * Build a complete add-service proposal.
 *
 * @param {object} model parsed current configuration
 * @param {object} form
 * @returns {object}
 */
export function buildServicePlan(model, form) {
  const input = normalizeForm(form, model);
  const kind = SERVICE_KINDS.find((entry) => entry.id === input.kind);
  const style = detectConfigStyle(model);
  const candidates = candidateList(model, input.kind);
  const forceNewFrontend = input.target === 'new';
  let target = forceNewFrontend ? null : findTarget(candidates, input.target);
  const errors = [...input.errors];
  const warnings = [];
  if (input.target && input.target !== 'auto' && input.target !== 'new' && !target) {
    errors.push('The selected target frontend no longer exists. Reload the page and choose again.');
  }

  if (target && input.kind === 'https' && target.kind === 'direct' && !target.frontend.binds.some((bind) => bind.ssl)) {
    errors.push(`Frontend ${target.frontend.name} has no TLS bind. Choose another target or create a new frontend.`);
    target = null;
  }
  if (target && input.kind === 'tcp' && target.frontend.binds.some((bind) => bind.ssl)) {
    errors.push(`Frontend ${target.frontend.name} terminates TLS. SNI passthrough requires a bind without ssl.`);
    target = null;
  }

  const existingNames = new Set(model.sections.map((section) => section.name).filter(Boolean));
  const backendName = uniqueName(`bk_${input.name}`, existingNames, '');
  const serverName = sanitizeName(input.name, 'app').slice(0, 26);
  const routeFrontend = target ? target.frontend : null;
  const newFrontend = forceNewFrontend || !target;
  const newFrontendName = newFrontend ? uniqueName(`ft_${input.name}`, existingNames, '') : null;
  const cert = input.cert || `/etc/haproxy/certs/${input.domain || input.name}.pem`;
  const bindHost = formatBindHost(input.bindAddress);
  const bind = `${bindHost}:${input.entryPort}`;
  const serverFlags = [input.check ? 'check inter 2s fall 3 rise 2' : '', input.serverSsl ? 'ssl' : '']
    .filter(Boolean)
    .join(' ');
  const serverAddress = input.server.address || '192.0.2.1:1';
  const edits = [];
  const additions = [];

  if (newFrontend) {
    const bindError = validateBindAddress(input.bindAddress);
    if (bindError) errors.push(bindError);
    const conflict = findBindConflict(model, input.bindAddress, input.entryPort);
    if (conflict) {
      errors.push(
        `Bind ${bind} is already used by ${conflict.frontend.name} (${conflict.bind.raw}). Choose an existing target, a different listen IP, or a different entry port.`,
      );
    }
    if (input.kind === 'https' && !input.cert) {
      warnings.push(`No certificate path was supplied; the proposal uses the placeholder ${cert}. Replace it with a real certificate path before deploying.`);
    }
    const directives = input.kind === 'https'
      ? [
        `bind ${bind} ssl crt ${cert}`,
        'mode http',
        'option httplog',
        'option forwardfor',
        'http-request set-header X-Forwarded-Proto https',
        `default_backend ${backendName}`,
      ]
      : input.kind === 'http'
        ? [
          `bind ${bind}`,
          'mode http',
          'option httplog',
          'option forwardfor',
          `default_backend ${backendName}`,
        ]
        : [
          `bind ${bind}`,
          'mode tcp',
          `default_backend ${backendName}`,
        ];
    const frontendLines = [
      '',
      ...resourceComment(style, `Frontend: ${newFrontendName}`, [
        `Service: ${input.hosts.join(', ')}`,
        `Listen: ${bind}`,
        `Mode: ${input.kind === 'tcp' ? 'TCP' : 'HTTP'}${input.kind === 'https' ? ' with TLS termination' : ''}`,
        `Upstream: ${serverAddress}`,
        'Managed by HAProxy Workbench',
      ]),
      `frontend ${newFrontendName}`,
      ...styleLines(style, directives.map((line) => `\t${line}`)),
      '',
    ];
    edits.push({ type: 'insert', line: frontendInsertionLine(model), lines: frontendLines });
    additions.push(...frontendLines);
  } else if (routeFrontend) {
    const criterion = input.kind === 'tcp' ? 'req_ssl_sni' : 'hdr(host)';
    const internalRoute = target.kind === 'bridge';

    if (target.kind === 'bridge') {
      const existingEdge = hostRoutedTo(target.edgeFrontend, input.hosts[0], target.bridgeBackend.name, 'req_ssl_sni');
      const coveredByBridge = input.hosts.every((host) => {
        const match = hostRoutedTo(target.edgeFrontend, host, target.bridgeBackend.name, 'req_ssl_sni');
        return match?.backend === target.bridgeBackend.name;
      });
      if (!coveredByBridge) {
        const edgeBlock = routeBlock(style, input.hosts, target.bridgeBackend.name, 'req_ssl_sni');
        edits.push({
          type: 'insert',
          line: safeRoutingInsertionLine(target.edgeFrontend, input.hosts, 'req_ssl_sni'),
          lines: edgeBlock,
        });
        additions.push(...edgeBlock);
        if (existingEdge) {
          warnings.push(
            `An existing rule on ${target.edgeFrontend.name} would have matched ${input.hosts[0]} (${existingEdge.backend}). The new, more specific SNI rules are inserted above it so this service takes precedence.`,
          );
        }
        warnings.push(
          `The SNI rules are added to ${target.edgeFrontend.name}; review certificate routing so ${input.hosts.join(', ')} reaches ${target.frontend.name}.`,
        );
      }
      warnings.push(
        `TLS terminates at ${target.frontend.name} after the loopback hand-off from ${target.edgeFrontend.name}. Confirm the certificate on that bind covers the new hostname.`,
      );
      if (!internalRoute) warnings.push('The internal termination target is not a bridge; verify reachability.');
    } else {
      if (target.loopback) {
        warnings.push(`${routeFrontend.name} is bound to loopback. A public edge frontend must route the hostname to this internal frontend for the service to be reachable.`);
      }
      if (input.kind === 'https' && routeFrontend.binds.every((bind) => !bind.ssl)) {
        errors.push(`${routeFrontend.name} has no TLS bind. Choose a termination target.`);
      }
      if (input.kind === 'http' && routeFrontend.binds.every((bind) => bind.ssl)) {
        warnings.push(`${routeFrontend.name} only has TLS binds. The new service will be reachable over HTTPS, not plain HTTP.`);
      }
      if (input.kind === 'http' && routeFrontend.binds.some((bind) => bind.ssl) && routeFrontend.binds.some((bind) => !bind.ssl)) {
        warnings.push(`${routeFrontend.name} serves both HTTP and HTTPS. The new host rule applies to both schemes; add an explicit redirect if plaintext should be rejected.`);
      }
      const existing = hostRoutedTo(routeFrontend, input.hosts[0], backendName, criterion);
      if (existing) {
        warnings.push(
          `${routeFrontend.name} already routes ${input.hosts[0]} to ${existing.backend}. The new rule is inserted above the first matching rule and will take precedence.`,
        );
      }
      if (input.hosts.some((host) => host.startsWith('*.'))) {
        warnings.push('Wildcard hostnames use `-m end`; they do not match the apex domain unless you add it separately.');
      }
    }

    const finalRouteBlock = routeBlock(style, input.hosts, backendName, criterion);
    edits.push({
      type: 'insert',
      line: safeRoutingInsertionLine(routeFrontend, input.hosts, criterion),
      lines: finalRouteBlock,
    });
    additions.push(...finalRouteBlock);

    if (input.kind === 'https') {
      warnings.push(
        `Certificate selection happens on the existing bind(s) of ${routeFrontend.name}. If its crt/crt-list does not cover ${input.hosts.join(', ')}, add a SAN or an SNI certificate entry.`,
      );
    }
  }

  const backendDirectives = [
    `mode ${input.kind === 'tcp' ? 'tcp' : 'http'}`,
    `balance ${input.balance}`,
    `server ${serverName} ${serverAddress}${serverFlags ? ` ${serverFlags}` : ''}`,
  ];
  const backendBlock = [
    '',
    ...resourceComment(style, `Backend: ${backendName}`, [
      `Service: ${input.hosts.join(', ')}`,
      `Upstream: ${serverAddress}`,
      `Mode: ${input.kind === 'tcp' ? 'TCP' : 'HTTP'}`,
      'Managed by HAProxy Workbench',
    ]),
    `backend ${backendName}`,
    ...styleLines(style, backendDirectives.map((line) => `\t${line}`)),
  ];
  edits.push({ type: 'insert', line: backendInsertionLine(model), lines: backendBlock });
  additions.push(...backendBlock);

  let proposed = ensureTrailingNewline(applyEdits(model.text, edits));
  proposed = stampWorkbenchChange(
    proposed,
    `Added ${kind.label} service ${input.hosts.join(', ')} -> ${serverAddress}`,
  );

  if (input.server.warning) warnings.push(input.server.warning);
  if (input.check) {
    warnings.push('The generated check is a TCP connect check. For HTTP applications, prefer an application health endpoint with `option httpchk GET /health`.');
  }
  if (input.server.address?.endsWith(':443') && input.kind !== 'tcp' && !input.serverSsl) {
    warnings.push('The server address uses port 443 but upstream TLS is not enabled. Add the upstream TLS option if the application expects HTTPS.');
  }
  if (input.serverSsl) {
    warnings.push('Upstream TLS is enabled without certificate verification. Add `verify required ca-file ...` (or an explicit verification policy) before production use.');
  }
  if (newFrontend) {
    warnings.push(`A new frontend is created on ${bind}. Update DNS/firewall/service exposure and validate that the address and port are not managed outside this config.`);
  }

  if (errors.length === 0) {
    const probe = parseConfig(proposed);
    if (probe.issues.some((issue) => issue.severity === 'error')) {
      errors.push(`The generated configuration still has ${probe.issues.filter((issue) => issue.severity === 'error').length} structural error(s). Review the diff before applying.`);
    }
  }

  const primaryHost = input.hosts[0] || '';
  let previewPort = input.entryPort;
  if (target) {
    if (target.kind === 'bridge') {
      const edgeBind = target.edgeFrontend.binds.find((bind) => !isLoopbackHost(bind.host));
      previewPort = edgeBind?.port || input.entryPort;
    } else {
      const binds = target.frontend.binds.filter((entry) => !isLoopbackHost(entry.host));
      const preferred = input.kind === 'https'
        ? binds.find((entry) => entry.ssl)
        : input.kind === 'http'
          ? binds.find((entry) => !entry.ssl)
          : binds[0];
      const bind = preferred || binds[0] || target.frontend.binds[0];
      previewPort = bind?.port || input.entryPort;
    }
  }
  const request = input.kind === 'tcp'
    ? { scheme: 'tcp', host: primaryHost, sni: primaryHost, port: previewPort, path: '', method: 'GET' }
    : { scheme: input.kind === 'https' ? 'https' : 'http', host: primaryHost, sni: primaryHost, port: previewPort, path: '/', method: 'GET' };

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    kind: input.kind,
    kindLabel: kind.label,
    form: input,
    candidates,
    target,
    backendName,
    newFrontend,
    newFrontendName,
    bind: { address: bindHost, port: input.entryPort, raw: bind },
    style,
    styleLabel: describeStyle(style),
    placementLabel: newFrontend
      ? 'New frontend after the last frontend; backend after the last backend; comments follow the detected style.'
      : 'Route inserted before the first matching rule/default; backend after the last backend; comments follow the detected style.',
    proposed: ensureTrailingNewline(proposed),
    additions,
    request,
    summary: newFrontend
      ? `Create a new ${input.kind === 'https' ? 'HTTPS' : input.kind === 'http' ? 'HTTP/www' : 'TCP/TLS passthrough'} frontend on ${bind} and backend ${backendName}.`
      : target.kind === 'bridge'
        ? `Route ${input.hosts.join(', ')} through ${target.edgeFrontend.name} → ${target.frontend.name} to new backend ${backendName}.`
        : `Route ${input.hosts.join(', ')} at ${routeFrontend.name} to new backend ${backendName}.`,
  };
}

export function serviceCandidates(model, kind) {
  return candidateList(model, kind);
}

export { sanitizeName, parseHosts, parseAddress, portInUse, routingInsertionLine };
