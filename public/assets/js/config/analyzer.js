/**
 * HAProxy configuration analysis.
 *
 * The analyzer produces explainable findings. It does not try to replace
 * `haproxy -c`; it focuses on safety, security, operability and the issues that
 * commonly bite people during a 2.x → 3.x upgrade.
 */

import {
  effectiveTimeout,
  firstItem,
  getTimeout,
  hasDirective,
  isLoopbackHost,
  timeoutToMs,
} from './parser.js';
import { effectiveHttpCheck, isBareHttpCheck } from './bestpractices.js';

export const SEVERITY_ORDER = { error: 0, warning: 1, recommendation: 2, info: 3 };

export const CATEGORY_LABELS = {
  structure: 'Structure',
  routing: 'Routing',
  timeouts: 'Timeouts',
  tls: 'TLS & certificates',
  security: 'Security',
  health: 'Health checks',
  logging: 'Logging',
  operations: 'Operations',
  performance: 'Performance',
  version: 'Version compatibility',
};

const WEAK_CIPHERS = /(?:^|:)(?:RC4|3DES|DES-CBC3|DES-CBC|MD5|EXPORT|NULL|aNULL|eNULL|ADH|AECDH)/i;
const STRONG_MIN_VERSIONS = new Set(['TLSv1.2', 'TLSv1.3']);

function sectionLabel(section) {
  if (!section) return '';
  if (section.type === 'global') return 'global';
  if (section.type === 'defaults') return section.name ? `defaults ${section.name}` : 'defaults';
  return `${section.type} ${section.name || '(unnamed)'}`;
}

function allProxies(model) {
  return model.sections.filter((section) => ['frontend', 'backend', 'listen'].includes(section.type));
}

function httpProxies(model) {
  return allProxies(model).filter((section) => section.effectiveMode === 'http');
}

function sslBinds(model) {
  const result = [];
  for (const section of model.frontends) {
    for (const bind of section.binds) {
      if (bind.ssl) result.push({ section, bind });
    }
  }
  return result;
}

function optionValue(section, keyword) {
  const item = section?.items.find((entry) => entry.keyword === keyword);
  return item ? item.args : null;
}

function findServerOption(section, option) {
  for (const server of section.servers) {
    if (server.flags.has(option) || Object.hasOwn(server.options, option)) return server;
  }
  return null;
}

function backendAcceptsWithoutServers(backend) {
  return backend.actions.some((action) => {
    if (action.keyword === 'http-request' && action.action === 'return') return true;
    if (action.keyword === 'tcp-request' && action.actionArgs?.includes('reject')) return true;
    if (action.keyword === 'http-request' && action.action === 'deny') return true;
    return false;
  }) || backend.items.some((item) => item.keyword === 'http-request' && item.action === 'return');
}

function evaluateExpectedRoutes(model, section) {
  const backendNames = new Set(model.backends.map((entry) => entry.name));
  return section.rules.filter((rule) => rule.backend && backendNames.has(rule.backend));
}

function parseConditionReferences(tokens) {
  if (!tokens) return [];
  const names = [];
  let depth = 0;
  for (const token of tokens) {
    if (token === '{') depth += 1;
    else if (token === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && !['||', 'or', 'and'].includes(token)) {
      names.push(token.replace(/^!/, ''));
    }
  }
  return names;
}

function hasClientCertFetch(section) {
  return section.items.some((item) =>
    item.raw.includes('ssl_c_') ||
    item.raw.includes('ssl_fc_has_crt') ||
    item.raw.includes('ssl_c_der') ||
    item.raw.includes('ssl_c_s_dn'),
  );
}

function hasVerifiedClientCert(section) {
  return section.binds.some((bind) => {
    const verify = String(bind.options.verify || '');
    return verify.startsWith('required') || verify.startsWith('optional');
  });
}

function modeLabel(mode) {
  return mode === 'http' ? 'HTTP' : 'TCP';
}

/**
 * Analyze a parsed configuration model.
 *
 * @param {object} model
 * @param {{targetVersion?: string}} options
 */
export function analyzeConfig(model, options = {}) {
  const targetVersion = options.targetVersion || '3.4';
  const findings = [];
  const add = (finding) => {
    findings.push({
      severity: 'recommendation',
      category: 'structure',
      weight: 1,
      ...finding,
    });
  };

  // Parser findings are first-class analysis results.
  for (const issue of model.issues || []) {
    add({
      id: `parser-${issue.code}`,
      source: 'parser',
      severity: issue.severity,
      category: issue.code.startsWith('proxy-name') || issue.code.startsWith('parse') || issue.code.includes('duplicate')
        ? 'structure'
        : 'routing',
      title: parserTitle(issue.code),
      detail: issue.message,
      why: 'HAProxy may refuse to start, refuse to reload, or route requests differently than intended.',
      fix: parserFix(issue.code),
      section: issue.section || '',
      line: issue.line,
      docs: 'troubleshooting',
      weight: issue.severity === 'error' ? 3 : 1,
    });
  }

  const all = allProxies(model);
  const http = httpProxies(model);
  const ssl = sslBinds(model);
  const global = model.global;
  const defaults = model.defaults[0] || null;

  if (!global) {
    add({
      id: 'structure-no-global',
      severity: 'warning',
      category: 'structure',
      title: 'No global section',
      detail: 'The configuration does not define a global section. Process-wide settings, TLS defaults, logging and the runtime socket are usually configured there.',
      why: 'A missing global section makes security and operational defaults implicit and easy to overlook.',
      fix: 'Add a global section with logging, user/group or container-appropriate privileges, TLS defaults and a protected stats socket.',
      docs: 'config-anatomy',
      weight: 2,
    });
  }

  if (!defaults) {
    add({
      id: 'structure-no-defaults',
      severity: 'warning',
      category: 'structure',
      title: 'No defaults section',
      detail: 'No defaults section was found. Mode, timeouts, logging and options will fall back to HAProxy built-ins.',
      why: 'Built-in timeout values are not a substitute for explicit production timeouts. New proxies may inherit the wrong mode.',
      fix: 'Add a defaults section with an explicit mode, timeouts, logging and safe connection options.',
      docs: 'config-anatomy',
      weight: 2,
    });
  }

  if (all.length === 0) {
    add({
      id: 'structure-no-proxies',
      severity: 'warning',
      category: 'structure',
      title: 'No frontend, backend or listen section',
      detail: 'The configuration has no proxies, so HAProxy would start without serving any traffic.',
      why: 'An empty proxy configuration is usually an import problem rather than an intentional setup.',
      fix: 'Add a frontend and backend, or load one of the sample configurations to explore the app.',
      docs: 'config-anatomy',
      weight: 2,
    });
  }

  // Logging and operations -------------------------------------------------
  const logLines = [
    ...(global?.items.filter((item) => item.keyword === 'log') || []),
    ...(defaults?.items.filter((item) => item.keyword === 'log') || []),
  ];
  if (logLines.length === 0) {
    add({
      id: 'logging-no-log',
      severity: 'warning',
      category: 'logging',
      title: 'No syslog target configured',
      detail: 'Neither global nor defaults contains a log directive.',
      why: 'Without logs, failed health checks, 5xx responses and ACL behaviour are difficult to diagnose. HAProxy itself keeps running, but you lose the primary troubleshooting signal.',
      fix: 'Add `log /dev/log local0` in global and `log global` in defaults, or configure a remote syslog target.',
      docs: 'timeouts-logging',
      weight: 2,
    });
  }

  const statsSocket = global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'socket');
  const statsTimeout = global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'timeout');
  if (statsSocket && global && !statsTimeout) {
    add({
      id: 'operations-stats-timeout',
      severity: 'recommendation',
      category: 'operations',
      title: 'Runtime socket has no stats timeout',
      detail: 'A stats socket is configured without a `stats timeout`. Slow or abandoned runtime API clients can hold resources.',
      why: 'The Runtime API is powerful; bounding client timeouts keeps an operator mistake from affecting the process.',
      fix: 'Add `stats timeout 30s` to global.',
      section: 'global',
      line: statsSocket.line,
      docs: 'operations',
      weight: 1,
    });
  }

  if (statsSocket) {
    const mode = statsSocket.args[statsSocket.args.indexOf('mode') + 1];
    const levelIndex = statsSocket.args.indexOf('level');
    const level = levelIndex >= 0 ? statsSocket.args[levelIndex + 1] : '';
    if (level === 'admin' && !mode) {
      add({
        id: 'security-stats-socket-mode',
        severity: 'warning',
        category: 'security',
        title: 'Admin runtime socket has no explicit permissions',
        detail: 'The stats socket uses `level admin` without a `mode` restriction.',
        why: 'Anyone who can write to the Runtime API can drain servers, change weights or shut down HAProxy. The socket should be private to the HAProxy operator.',
        fix: 'Restrict it, for example: `stats socket /run/haproxy/admin.sock mode 660 level admin`.',
        section: 'global',
        line: statsSocket.line,
        docs: 'operations',
        weight: 2,
      });
    } else if (mode && /^[0-7]{3,4}$/.test(mode)) {
      const numeric = Number.parseInt(mode, 8);
      if ((numeric & 0o007) !== 0) {
        add({
          id: 'security-stats-socket-world',
          severity: 'warning',
          category: 'security',
          title: 'Runtime socket is accessible by other users',
          detail: `The stats socket mode is ${mode}, which grants access to users outside the HAProxy group.`,
          why: 'The admin socket can change live traffic decisions and should not be world-accessible.',
          fix: 'Use `mode 660` and ensure only the HAProxy group can access the socket.',
          section: 'global',
          line: statsSocket.line,
          docs: 'operations',
          weight: 2,
        });
      }
    }
  }

  if (global?.items.some((item) => item.keyword === 'daemon')) {
    add({
      id: 'operations-daemon',
      severity: 'recommendation',
      category: 'operations',
      title: '`daemon` is set in a supervised deployment',
      detail: 'The global section contains `daemon`. In containers and under systemd, HAProxy is normally run in the foreground so the supervisor can track the process.',
      why: 'Backgrounding can confuse PID tracking, restart policy and log collection. Some container entrypoints pass `-db` to override it.',
      fix: 'If this config runs in Docker or systemd with a foreground unit, remove `daemon` and let the process manager supervise HAProxy. Keep it where the distribution unit expects daemon mode.',
      section: 'global',
      line: global.items.find((item) => item.keyword === 'daemon')?.line,
      docs: 'operations',
      weight: 1,
    });
  }

  const maxconnGlobal = global?.items.some((item) => item.keyword === 'maxconn');
  const maxconnAnywhere = model.sections.some((section) => section.items.some((item) => item.keyword === 'maxconn'));
  if (!maxconnGlobal && !maxconnAnywhere) {
    add({
      id: 'performance-maxconn',
      severity: 'recommendation',
      category: 'performance',
      title: 'No maxconn limit configured',
      detail: 'No `maxconn` is set in global or in any proxy.',
      why: 'Without a limit, a traffic spike or connection leak can exhaust file descriptors and memory. HAProxy may be killed by the kernel instead of shedding load predictably.',
      fix: 'Set a `maxconn` in global, sized to file descriptor and memory limits, and optionally per frontend/backend.',
      section: 'global',
      docs: 'performance',
      weight: 1,
    });
  }

  // Timeouts ---------------------------------------------------------------
  if (defaults) {
    for (const timeoutName of ['connect', 'client', 'server']) {
      if (!getTimeout(defaults, timeoutName)) {
        add({
          id: `timeouts-default-${timeoutName}`,
          severity: 'warning',
          category: 'timeouts',
          title: `Defaults has no timeout ${timeoutName}`,
          detail: `The defaults section does not set \`timeout ${timeoutName}\`.`,
          why: timeoutWhy(timeoutName),
          fix: `Add a deliberate \`timeout ${timeoutName}\` to defaults; start with 5s connect and 30–60s client/server for typical HTTP workloads.`,
          section: sectionLabel(defaults),
          line: defaults.line,
          docs: 'timeouts-logging',
          weight: 2,
        });
      }
    }
  }

  for (const section of model.frontends) {
    if (!effectiveTimeout(model, section, 'client') && !getTimeout(section, 'client')) {
      add({
        id: `timeouts-frontend-client-${section.name}`,
        severity: 'warning',
        category: 'timeouts',
        title: `Timeout client is not defined for ${sectionLabel(section)}`,
        detail: 'No `timeout client` is set on this frontend and defaults does not provide one.',
        why: 'A client that stops reading or writing can hold a connection and its buffers indefinitely.',
        fix: 'Set `timeout client 30s` (or the appropriate value for long-lived protocols).',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 2,
      });
    }
  }

  for (const section of model.backends) {
    if (!effectiveTimeout(model, section, 'server') && !getTimeout(section, 'server')) {
      add({
        id: `timeouts-backend-server-${section.name}`,
        severity: 'warning',
        category: 'timeouts',
        title: `Timeout server is not defined for ${sectionLabel(section)}`,
        detail: 'No `timeout server` is set on this backend and defaults does not provide one.',
        why: 'A stalled application server can hold client connections and buffers until resources run out.',
        fix: 'Set `timeout server 30s` (or a value that matches the application’s worst-case response time).',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 2,
      });
    }
    if (!effectiveTimeout(model, section, 'connect') && !getTimeout(section, 'connect')) {
      add({
        id: `timeouts-backend-connect-${section.name}`,
        severity: 'warning',
        category: 'timeouts',
        title: `Timeout connect is not defined for ${sectionLabel(section)}`,
        detail: 'No `timeout connect` is set for this backend and defaults does not provide one.',
        why: 'An unreachable server can cause clients to wait far too long before HAProxy tries another server.',
        fix: 'Set `timeout connect 5s` in defaults or on the backend.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 2,
      });
    }
  }

  for (const section of model.frontends.filter((entry) => entry.effectiveMode === 'http' && entry.binds.length > 0)) {
    if (!effectiveTimeout(model, section, 'http-request')) {
      add({
        id: `timeouts-http-request-${section.name}`,
        severity: 'recommendation',
        category: 'timeouts',
        title: `No timeout http-request on ${sectionLabel(section)}`,
        detail: 'HTTP headers can arrive slowly. Without `timeout http-request`, a slowloris-style client can occupy connections.',
        why: 'This timeout bounds the time between accepting a connection and receiving complete request headers.',
        fix: 'Add `timeout http-request 10s` to defaults, tuned to your clients and upload patterns.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 1,
      });
    }
    if (!effectiveTimeout(model, section, 'http-keep-alive')) {
      add({
        id: `timeouts-http-keepalive-${section.name}`,
        severity: 'recommendation',
        category: 'timeouts',
        title: `No timeout http-keep-alive on ${sectionLabel(section)}`,
        detail: 'Idle HTTP keep-alive connections use the general client timeout unless `timeout http-keep-alive` is set.',
        why: 'A short keep-alive timeout frees idle connections; a long one reduces handshakes but consumes memory.',
        fix: 'Add `timeout http-keep-alive 30s` (tune to traffic).',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 1,
      });
    }
  }

  for (const section of model.frontends.filter((entry) => entry.effectiveMode === 'tcp')) {
    if (!effectiveTimeout(model, section, 'tunnel')) {
      add({
        id: `timeouts-tunnel-${section.name}`,
        severity: 'recommendation',
        category: 'timeouts',
        title: `No timeout tunnel on TCP proxy ${sectionLabel(section)}`,
        detail: 'Long-lived TCP tunnels (SSH, WebSocket, database) can be cut by client/server timeouts once they are established.',
        why: 'HAProxy applies `timeout tunnel` after a connection switches to tunnel mode; without it, long idle sessions may be disconnected or held too long depending on the protocol.',
        fix: 'Set `timeout tunnel` to a value that matches the longest expected idle period, or a deliberate finite limit.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'timeouts-logging',
        weight: 1,
      });
    }
  }

  for (const section of all) {
    for (const name of ['connect', 'client', 'server', 'http-request', 'http-keep-alive', 'tunnel']) {
      const timeout = getTimeout(section, name);
      if (!timeout) continue;
      const ms = timeoutToMs(timeout.timeoutValue);
      if (ms === null) {
        add({
          id: `timeouts-invalid-${section.name}-${name}`,
          severity: 'warning',
          category: 'timeouts',
          title: `Unrecognised timeout value in ${sectionLabel(section)}`,
          detail: `\`timeout ${name} ${timeout.timeoutValue}\` does not look like a duration (ms, s, m, h).`,
          why: 'HAProxy will reject an invalid timeout, or the value may not mean what you intended.',
          fix: 'Use an explicit unit, for example `30s` or `5000ms`.',
          section: sectionLabel(section),
          line: timeout.line,
          docs: 'timeouts-logging',
          weight: 2,
        });
      } else if (ms === 0 && name !== 'tunnel') {
        add({
          id: `timeouts-zero-${section.name}-${name}`,
          severity: 'warning',
          category: 'timeouts',
          title: `Zero timeout ${name} in ${sectionLabel(section)}`,
          detail: 'A zero timeout disables the timer rather than making it immediate.',
          why: 'Disabling connect/client/server timeouts allows stuck connections to remain forever.',
          fix: 'Use a finite value appropriate for the protocol.',
          section: sectionLabel(section),
          line: timeout.line,
          docs: 'timeouts-logging',
          weight: 2,
        });
      } else if (ms > 60 * 60 * 1000 && name !== 'tunnel' && name !== 'client-fin' && name !== 'server-fin') {
        add({
          id: `timeouts-long-${section.name}-${name}`,
          severity: 'recommendation',
          category: 'timeouts',
          title: `Very long timeout ${name} in ${sectionLabel(section)}`,
          detail: `The value is ${timeout.timeoutValue}, longer than one hour.`,
          why: 'Long timeouts delay failure detection and can pin buffers for hours. They are occasionally correct for streaming workloads, so treat this as a prompt to verify intent.',
          fix: 'Confirm this is required by the protocol. For ordinary HTTP, use seconds rather than hours.',
          section: sectionLabel(section),
          line: timeout.line,
          docs: 'timeouts-logging',
          weight: 1,
        });
      }
    }
  }

  // TLS --------------------------------------------------------------------
  const bindOptions = global ? optionValue(global, 'ssl-default-bind-options') || [] : [];
  const minVersionIndex = bindOptions.indexOf('ssl-min-ver');
  const minVersion = minVersionIndex >= 0 ? bindOptions[minVersionIndex + 1] : null;

  const implicitTlsMin = bindOptions.includes('no-sslv3') &&
    bindOptions.includes('no-tlsv10') &&
    bindOptions.includes('no-tlsv11');

  if (ssl.length > 0) {
    if (!minVersion && !implicitTlsMin) {
      add({
        id: 'tls-min-version-missing',
        severity: 'recommendation',
        category: 'tls',
        title: 'No global TLS minimum version',
        detail: 'SSL binds are used, but `ssl-default-bind-options` does not set `ssl-min-ver` or the equivalent no-sslv3/no-tlsv10/no-tlsv11 combination.',
        why: 'Without an explicit minimum, old TLS versions may remain negotiable depending on the OpenSSL build and distribution policy.',
        fix: 'Add `ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets` to global, then test old clients.',
        section: 'global',
        docs: 'tls',
        weight: 1,
      });
    } else if (minVersion && !STRONG_MIN_VERSIONS.has(minVersion)) {
      add({
        id: 'tls-old-min-version',
        severity: 'warning',
        category: 'tls',
        title: `TLS minimum version is ${minVersion}`,
        detail: 'TLS 1.0 and 1.1 are deprecated and fail modern security baselines.',
        why: 'Those protocols have known weaknesses and are disallowed by PCI DSS and many browsers and APIs.',
        fix: 'Set `ssl-min-ver TLSv1.2` (prefer TLSv1.2 as the floor and allow TLSv1.3).',
        section: 'global',
        docs: 'tls',
        weight: 2,
      });
    }

    if (!bindOptions.includes('no-tls-tickets')) {
      add({
        id: 'tls-tickets-enabled',
        severity: 'recommendation',
        category: 'tls',
        title: 'TLS session tickets are not disabled',
        detail: 'Global bind options do not contain `no-tls-tickets`.',
        why: 'Static ticket keys can undermine forward secrecy if they are not rotated. Disabling tickets is a simple safe default, at a small session-resumption cost.',
        fix: 'Add `no-tls-tickets` to `ssl-default-bind-options`, or rotate ticket keys deliberately.',
        section: 'global',
        docs: 'tls',
        weight: 1,
      });
    }

    const ciphers = global ? optionValue(global, 'ssl-default-bind-ciphers') : null;
    if (!ciphers || ciphers.length === 0) {
      add({
        id: 'tls-ciphers-not-set',
        severity: 'recommendation',
        category: 'tls',
        title: 'No explicit TLS 1.2 cipher list',
        detail: '`ssl-default-bind-ciphers` is not configured.',
        why: 'The effective list depends on the OpenSSL build and distribution. An explicit, modern list makes behaviour more predictable.',
        fix: 'Set a Mozilla-intermediate or organisation-approved cipher string; keep AEAD suites and avoid CBC/3DES.',
        section: 'global',
        docs: 'tls',
        weight: 1,
      });
    } else if (WEAK_CIPHERS.test(ciphers.join(' '))) {
      add({
        id: 'tls-weak-ciphers',
        severity: 'warning',
        category: 'tls',
        title: 'Weak TLS cipher names detected',
        detail: `The configured cipher list contains legacy/weak tokens: ${ciphers.join(' ')}`,
        why: 'RC4, 3DES, NULL and export-grade ciphers are not acceptable for public TLS.',
        fix: 'Replace the list with a modern AEAD cipher string and test with `openssl s_client` or testssl.sh.',
        section: 'global',
        docs: 'tls',
        weight: 2,
      });
    }

    for (const { section, bind } of ssl) {
      if (!bind.cert && !bind.certList) {
        add({
          id: `tls-no-cert-${section.name}-${bind.line}`,
          severity: 'error',
          category: 'tls',
          title: `SSL bind has no certificate source`,
          detail: `Bind ${bind.raw} uses SSL but has no \`crt\` or \`crt-list\` option.`,
          why: 'HAProxy needs a certificate and private key to terminate TLS. A global crt-base only sets the base directory; it does not select a certificate.',
          fix: 'Add `crt /path/to/certificate.pem` (or `crt-list`), and make sure the file is readable by the HAProxy user.',
          section: sectionLabel(section),
          line: bind.line,
          docs: 'tls',
          weight: 3,
        });
      }
    }
  }

  for (const section of model.frontends) {
    const hasPlainHttp = section.binds.some((bind) => !bind.ssl && (bind.port === '80' || bind.port === null));
    if (section.effectiveMode === 'http' && hasPlainHttp) {
      const redirect = section.items.some((item) =>
        item.keyword === 'http-request' && item.action === 'redirect',
      );
      if (!redirect) {
        add({
          id: `tls-no-http-redirect-${section.name}`,
          severity: 'recommendation',
          category: 'tls',
          title: `Plain HTTP listener without an HTTPS redirect on ${sectionLabel(section)}`,
          detail: 'This frontend accepts unencrypted HTTP and has no `http-request redirect` rule.',
          why: 'If the listener is public, credentials and cookies can cross the network in clear text. A redirect is not a substitute for HSTS, but it closes the obvious gap.',
          fix: 'Add an HTTPS redirect or explicitly document why plaintext is required (for example, a trusted internal network).',
          section: sectionLabel(section),
          line: section.line,
          docs: 'tls',
          weight: 1,
        });
      }
    }

    const optionSections = [defaults, section].filter(Boolean);
    const hasForwardfor = optionSections.some((entry) => entry.items.some((item) =>
      item.keyword === 'option' && item.value === 'forwardfor',
    )) || section.items.some((item) => item.raw.includes('X-Forwarded-For') || item.raw.includes('X-Client-IP'));
    if (section.effectiveMode === 'http' && section.binds.length > 0 && !hasForwardfor) {
      add({
        id: `routing-no-forwardfor-${section.name}`,
        severity: 'recommendation',
        category: 'routing',
        title: `No client-IP forwarding on ${sectionLabel(section)}`,
        detail: 'No `option forwardfor` or explicit X-Forwarded-For/X-Client-IP handling was found.',
        why: 'Backends will see HAProxy’s address as the client unless the application receives the original address through a trusted header.',
        fix: 'Add `option forwardfor` (or set a header only for trusted proxies), and configure the application to trust it only from HAProxy.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'routing',
        weight: 1,
      });
    }

    const trustProblem = section.items.find((item) =>
      item.keyword === 'http-request' &&
      item.action === 'set-header' &&
      item.actionArgs[0] === 'X-Forwarded-Proto' &&
      item.actionArgs[1] === 'https' &&
      !item.condition,
    );
    const publicPlainBind = section.binds.some((bind) => !bind.ssl && !isLoopbackHost(bind.host));
    if (trustProblem && publicPlainBind) {
      add({
        id: `security-unconditional-proto-${section.name}`,
        severity: 'warning',
        category: 'security',
        title: 'X-Forwarded-Proto is overwritten unconditionally on a public bind',
        detail: 'The frontend sets `X-Forwarded-Proto: https` without an SSL condition.',
        why: 'If a plaintext request can reach this frontend, an attacker gets the application to believe the connection was HTTPS. Only overwrite the header after a trusted TLS terminator, or guard it with `if { ssl_fc }`.',
        fix: 'Add `if { ssl_fc }` or scope the frontend to a loopback bind behind a trusted TLS terminator.',
        section: sectionLabel(section),
        line: trustProblem.line,
        docs: 'security',
        weight: 2,
      });
    }

    if (hasClientCertFetch(section) && !hasVerifiedClientCert(section)) {
      add({
        id: `security-client-cert-unverified-${section.name}`,
        severity: 'warning',
        category: 'security',
        title: 'Client certificate data is forwarded without verification',
        detail: 'The configuration uses ssl_c_* sample fetches or certificate headers, but no SSL bind requires or verifies a client certificate.',
        why: 'Certificate fields can be empty or attacker-supplied at another layer. Forwarding them does not authenticate the user. Treating them as identity is a serious trust boundary mistake.',
        fix: 'Enable client certificate verification on the bind (`verify required ca-file ...`) and strip incoming client-certificate headers before setting them. Or authenticate at a trusted layer and document it.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'tls',
        weight: 2,
      });
    }

    if (section.effectiveMode === 'http' && !section.binds.some((bind) => bind.ssl) && section.defaultBackend) {
      const target = model.backends.find((backend) => backend.name === section.defaultBackend);
      if (target && target.effectiveMode === 'tcp') {
        add({
          id: `routing-http-to-tcp-${section.name}`,
          severity: 'recommendation',
          category: 'routing',
          title: `HTTP frontend defaults to a TCP backend on ${sectionLabel(section)}`,
          detail: `The frontend runs in HTTP mode but default_backend "${target.name}" runs in TCP mode.`,
          why: 'HTTP parsing ends at the frontend and the raw stream is forwarded. This can be intentional (for example a loopback TLS bridge), but it also hides HTTP-level health checks and headers from the next hop.',
          fix: 'Confirm the mode mismatch is intentional. Use `mode http` end-to-end for HTTP services, or document the TLS handoff.',
          section: sectionLabel(section),
          line: section.line,
          docs: 'tls',
          weight: 1,
        });
      }
    }
  }

  // Routing and backends ---------------------------------------------------
  for (const section of model.frontends) {
    const aclNames = new Set(section.acls.map((acl) => acl.name));
    for (const rule of section.rules) {
      for (const reference of parseConditionReferences(rule.condition)) {
        if (!aclNames.has(reference) && !reference.startsWith('{') && reference !== '') {
          add({
            id: `routing-unknown-acl-${section.name}-${rule.line}-${reference}`,
            severity: 'warning',
            category: 'routing',
            title: `Named ACL "${reference}" is not defined`,
            detail: `use_backend in ${sectionLabel(section)} references the named ACL "${reference}", but no acl line with that name exists in the same section.`,
            why: 'Named ACLs are scoped to the proxy. A missing definition makes the rule behave unexpectedly or fail configuration validation.',
            fix: `Define \`acl ${reference} ...\` in ${sectionLabel(section)} or replace the reference with an inline condition such as \`{ hdr(host) -i example.com }\`.`,
            section: sectionLabel(section),
            line: rule.line,
            docs: 'routing',
            weight: 2,
          });
        }
      }
    }
    if (section.defaultBackend) {
      const backend = model.backends.find((entry) => entry.name === section.defaultBackend);
      if (backend && backend.servers.length === 0 && !backendAcceptsWithoutServers(backend)) {
        add({
          id: `routing-empty-default-${section.name}`,
          severity: 'warning',
          category: 'routing',
          title: `Default backend "${backend.name}" has no servers`,
          detail: `${sectionLabel(section)} sends unmatched requests to ${sectionLabel(backend)}, which has no server lines and no explicit return/reject action.`,
          why: 'Unmatched traffic will receive a 503 (HTTP) or a failed connection (TCP) even though the config looks complete.',
          fix: 'Add servers, add an explicit default response, or route to a backend that can serve traffic.',
          section: sectionLabel(backend),
          line: backend.line,
          docs: 'troubleshooting',
          weight: 2,
        });
      }
    } else if (section.rules.length > 0 &&
      !(section.type === 'listen' && section.servers.length > 0) &&
      !section.actions.some((action) => action.action === 'return' || action.action === 'deny')) {
      add({
        id: `routing-no-default-${section.name}`,
        severity: 'warning',
        category: 'routing',
        title: `No default_backend on ${sectionLabel(section)}`,
        detail: 'The frontend has use_backend rules but no default_backend. Requests that match none of the rules have nowhere to go.',
        why: 'HAProxy returns 503 for unmatched HTTP requests. A catch-all backend or explicit return makes the fallback intentional.',
        fix: 'Add a default_backend, or add an explicit `http-request return status 404` fallback before the routing rules.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'routing',
        weight: 2,
      });
    }
  }

  const implicitBalanceBackends = model.backends.filter(
    (backend) => backend.servers.length > 1 && !backend.balance,
  );
  if (implicitBalanceBackends.length > 0) {
    add({
      id: 'version-implicit-balance-default',
      severity: 'recommendation',
      category: 'version',
      title: 'Multi-server backends rely on an implicit balancing default',
      detail: `${implicitBalanceBackends.length} backend(s) with more than one server do not set a \`balance\` algorithm: ${implicitBalanceBackends.map((backend) => backend.name).join(', ')}.`,
      why: 'HAProxy 3.3 changed the default from roundrobin to random. An upgrade can therefore change traffic distribution for backends that never set balance explicitly, even when the config still validates.',
      fix: 'Set an explicit `balance` algorithm on every multi-server backend (for example `balance roundrobin`, `balance leastconn` or `balance random`) and test the distribution.',
      section: 'multiple backends',
      line: implicitBalanceBackends[0].line,
      docs: 'versions',
      weight: 1,
      versionImpact: '3.3',
    });
  }

  const defaultsReuseNever = defaults?.items.find(
    (item) => item.keyword === 'http-reuse' && item.args[0] === 'never',
  );
  if (defaultsReuseNever) {
    add({
      id: 'performance-http-reuse-defaults',
      severity: 'recommendation',
      category: 'performance',
      title: 'HTTP connection reuse is disabled in defaults',
      detail: '`http-reuse never` in defaults forces a new upstream connection for every request in every HTTP backend unless overridden.',
      why: 'Reusing backend connections reduces handshake overhead and application accept load. `never` is occasionally required for broken servers, but should be a deliberate, scoped exception.',
      fix: 'Consider `http-reuse safe` at defaults or backend level, then test application compatibility before changing production.',
      section: sectionLabel(defaults),
      line: defaultsReuseNever.line,
      docs: 'performance',
      weight: 1,
    });
  }

  for (const backend of model.backends) {
    if (backend.servers.length === 0 && !backendAcceptsWithoutServers(backend)) {
      if (backend.type === 'listen' && backend.binds.length > 0) {
        // A listen section without servers is usually a dead listener.
      }
      add({
        id: `routing-backend-no-servers-${backend.name}`,
        severity: 'warning',
        category: 'routing',
        title: `Backend "${backend.name}" has no servers`,
        detail: 'No server or server-template line is defined, and the backend has no explicit return/reject action.',
        why: 'Traffic routed here will fail with 503 (HTTP) or a connection error (TCP).',
        fix: 'Add at least one server, or make the failure explicit with `http-request return status 503` / `tcp-request content reject`.',
        section: sectionLabel(backend),
        line: backend.line,
        docs: 'load-balancing',
        weight: 2,
      });
    }

    if (backend.servers.length > 0) {
      const hasChecks = backend.servers.some((server) => server.flags.has('check'));
      const hasTcpCheck = backend.items.some((item) => item.keyword === 'option' && item.value === 'tcp-check');
      const httpchk = effectiveHttpCheck(model, backend);
      const hasHttpCheck = Boolean(httpchk);
      const bareHttpCheck = isBareHttpCheck(model, backend);
      if ((hasTcpCheck || hasHttpCheck) && !hasChecks) {
        add({
          id: `health-checks-not-enabled-${backend.name}`,
          severity: 'warning',
          category: 'health',
          title: `Health check options are set but no server has \`check\``,
          detail: `${sectionLabel(backend)} configures ${hasHttpCheck ? 'option httpchk' : 'option tcp-check'}, but no server line enables checking.${bareHttpCheck ? ' The bare `option httpchk` sends `OPTIONS / HTTP/1.0` by default.' : ''}`,
          why: 'This is a classic HAProxy mistake: the check method looks configured, but HAProxy never probes servers. Dead servers keep receiving traffic until connection failures occur.',
          fix: bareHttpCheck
            ? 'Configure an explicit health request first, for example `option httpchk GET /health` plus `http-check expect status 200`, then add `check`. A bare `option httpchk` sends `OPTIONS / HTTP/1.0`; a 401/404/405 response marks the server DOWN.'
            : 'Add `check` to each server (optionally with `inter`, `fall`, `rise`), for example `server app 192.0.2.10:8080 check inter 5s fall 3 rise 3`.',
          section: sectionLabel(backend),
          line: backend.servers[0].line,
          backend: backend.name,
          docs: 'health-checks-safe',
          weight: 2,
        });
      }

      if (hasChecks && bareHttpCheck) {
        add({
          id: `health-bare-httpchk-${backend.name}`,
          severity: 'warning',
          category: 'health',
          title: `Bare \`option httpchk\` can mark healthy servers DOWN`,
          detail: `${sectionLabel(backend)} has active checks, but uses a bare \`option httpchk\`. HAProxy sends \`OPTIONS / HTTP/1.0\` and treats only 2xx/3xx responses as healthy.`,
          why: 'A 401, 404 or 405 response fails the check. After `fall` consecutive failures the server is marked DOWN. On a single-server backend that is a full outage, while another app may answer `OPTIONS /` with 200 and look healthy — which is why only some services break.',
          fix: 'Configure an explicit request, for example `option httpchk GET /health` plus `http-check expect status 200`, or remove `option httpchk` and use a plain TCP check. Test the exact request with curl from the HAProxy host before enabling it.',
          section: sectionLabel(backend),
          line: httpchk?.line || backend.servers[0].line,
          backend: backend.name,
          docs: 'health-checks-safe',
          weight: 2,
        });
      }

      const unchecked = backend.servers.filter((server) => !server.flags.has('check'));
      if (hasChecks && unchecked.length > 0) {
        add({
          id: `health-mixed-checks-${backend.name}`,
          severity: 'recommendation',
          category: 'health',
          title: `Only some servers have health checks in "${backend.name}"`,
          detail: `${unchecked.length} of ${backend.servers.length} servers do not have \`check\`.`,
          why: 'A mixed backend behaves inconsistently: some failures are detected proactively while others are only found when a client request fails.',
          fix: 'Enable `check` on every server or document why a server must remain unchecked.',
          section: sectionLabel(backend),
          line: unchecked[0].line,
          backend: backend.name,
          docs: 'health-checks-safe',
          weight: 1,
        });
      }
      if (!hasChecks && unchecked.length > 0 && !(hasTcpCheck || hasHttpCheck)) {
        add({
          id: `health-no-check-${backend.name}`,
          severity: 'recommendation',
          category: 'health',
          title: `No active health checks in "${backend.name}"`,
          detail: `${unchecked.length} server${unchecked.length === 1 ? '' : 's'} in this backend do not have \`check\`.`,
          why: 'Without checks, HAProxy only discovers a dead server when it tries to connect. Health checks remove failed servers from rotation before users see errors.',
          fix: 'Add `check` (and optionally `inter 5s fall 3 rise 3`) to servers. For HTTP, configure `option httpchk` with an application health endpoint; for TCP, use `option tcp-check`.',
          section: sectionLabel(backend),
          line: backend.servers[0].line,
          backend: backend.name,
          docs: 'health-checks-safe',
          weight: 1,
        });
      }

      for (const server of backend.servers) {
        if (backend.effectiveMode === 'http' && server.port === '443' && !server.flags.has('ssl')) {
          add({
            id: `tls-backend-443-no-ssl-${backend.name}-${server.name}`,
            severity: 'recommendation',
            category: 'tls',
            title: `Server "${server.name}" uses port 443 without \`ssl\``,
            detail: 'The backend is in HTTP mode and the server address uses port 443, but the server line does not enable SSL.',
            why: 'HAProxy will speak cleartext HTTP unless it is told to originate TLS. If the upstream expects HTTPS, requests will fail or send plaintext to a TLS port.',
            fix: 'Add `ssl` (and usually `verify required ca-file ...` or a documented verification policy) to the server line, or confirm the upstream is a local TLS bridge.',
            section: sectionLabel(backend),
            line: server.line,
            docs: 'tls',
            weight: 1,
          });
        }
        if (server.flags.has('check') && backend.effectiveMode === 'http' &&
            !backend.items.some((item) => item.keyword === 'option' && ['httpchk', 'tcp-check'].includes(item.value)) &&
            backend.servers.length > 0) {
          // A bare check is valid (TCP connect check). No finding; this branch is
          // deliberately kept to document that behaviour.
        }
      }
    }

    if (backend.items.some((item) => item.keyword === 'http-reuse' && item.args[0] === 'never')) {
      add({
        id: `performance-http-reuse-${backend.name}`,
        severity: 'recommendation',
        category: 'performance',
        title: `HTTP connection reuse is disabled in "${backend.name}"`,
        detail: '`http-reuse never` forces a new connection for every request.',
        why: 'Reusing backend connections reduces handshake overhead and load on applications. `never` is occasionally required for broken servers, but should be a deliberate exception.',
        fix: 'Consider `http-reuse safe` (the usual safe default) or `http-reuse always` only when the application tolerates multiplexing. Test before changing.',
        section: sectionLabel(backend),
        line: backend.items.find((item) => item.keyword === 'http-reuse').line,
        docs: 'performance',
        weight: 1,
      });
    }

    const stickTable = backend.items.find((item) => item.keyword === 'stick-table');
    if (stickTable) {
      const expire = stickTable.args.find((arg) => arg === 'expire');
      if (!expire) {
        add({
          id: `performance-sticktable-expire-${backend.name}`,
          severity: 'recommendation',
          category: 'performance',
          title: `Stick table in "${backend.name}" has no expire`,
          detail: 'A stick-table is defined without an `expire` value.',
          why: 'Stick table entries without expiry can accumulate until the configured size is exhausted, especially with attacker-controlled keys such as cookies.',
          fix: 'Add `expire 30m` (or an appropriate duration) and size the table for your traffic.',
          section: sectionLabel(backend),
          line: stickTable.line,
          docs: 'load-balancing',
          weight: 1,
        });
      }
    }
  }

  // Version compatibility --------------------------------------------------
  for (const section of model.sections) {
    if (section.type === 'program') {
      add({
        id: `version-program-${section.name}`,
        severity: 'warning',
        category: 'version',
        title: 'The program section is deprecated',
        detail: `Section "program ${section.name}" starts an external process. It is deprecated in HAProxy 3.1 and removed in 3.3.`,
        why: 'HAProxy no longer manages external programs. A 3.3+ upgrade will reject this section.',
        fix: 'Move the process to systemd, Docker Compose, supervisord or another supervisor and remove the program section before upgrading.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'versions',
        weight: 2,
        versionImpact: '3.3',
      });
    }
    if (section.type === 'mailers') {
      add({
        id: `version-mailers-${section.name}`,
        severity: 'warning',
        category: 'version',
        title: 'Legacy C mailers are deprecated',
        detail: `Section "mailers ${section.name}" uses the legacy mailer implementation. It is deprecated in 3.1 and removed in 3.3.`,
        why: 'The legacy mailer was replaced by Lua mailers in 2.8; a 3.3+ upgrade will reject this section.',
        fix: 'Migrate alerting to Lua mailers or an external alerting pipeline before upgrading.',
        section: sectionLabel(section),
        line: section.line,
        docs: 'versions',
        weight: 2,
        versionImpact: '3.3',
      });
    }
    for (const item of section.items) {
      if (['reqadd', 'rspadd', 'reqirep', 'rspirep'].includes(item.keyword)) {
        add({
          id: `version-removed-${item.keyword}-${section.name}-${item.line}`,
          severity: 'error',
          category: 'version',
          title: `Removed directive "${item.keyword}"`,
          detail: `"${item.keyword}" was removed in HAProxy 2.1 and is not accepted by 3.x.`,
          why: 'Modern HAProxy uses `http-request`/`http-response` rules instead. Older configs sometimes survive on very old distributions and fail only when upgraded.',
          fix: 'Replace the line with an equivalent `http-request` or `http-response` rule and validate with the target binary.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 3,
          versionImpact: '3.x',
        });
      }
      if (item.keyword === 'nbproc') {
        add({
          id: `version-nbproc-${section.name}-${item.line}`,
          severity: 'warning',
          category: 'version',
          title: '`nbproc` is not supported by modern HAProxy',
          detail: '`nbproc` is gone from 3.x and multi-process mode conflicts with many modern features. Use `nbthread` / `cpu-map` for CPU scaling.',
          why: 'HAProxy is fully threaded; old multi-process guides and configs cause startup failures or silently lose the intended capacity.',
          fix: 'Remove `nbproc`, set an explicit `nbthread` if needed, and review `cpu-map` / automatic CPU binding in 3.2+.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 2,
          versionImpact: '3.x',
        });
      }
      if (item.keyword === 'tune.ssl.ocsp-update') {
        add({
          id: `version-ocsp-directive-${item.line}`,
          severity: 'warning',
          category: 'version',
          title: '`tune.ssl.ocsp-update` was renamed',
          detail: 'The boolean tuning directive is `tune.ocsp-update` in HAProxy 3.0+. The `.mindelay` and `.maxdelay` variants still use the old prefix.',
          why: 'Using the old name can fail validation after an upgrade depending on version compatibility handling.',
          fix: 'Rename `tune.ssl.ocsp-update` to `tune.ocsp-update` and validate with the target HAProxy binary.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 2,
          versionImpact: '3.0',
        });
      }
      if (item.keyword === 'master-worker') {
        add({
          id: `version-master-worker-${item.line}`,
          severity: 'recommendation',
          category: 'version',
          title: '`master-worker` is deprecated in 3.3',
          detail: 'Use the `-W` / `-Ws` command-line flags instead of the master-worker configuration directive.',
          why: 'Configuration should describe traffic, not process supervision. The directive is being retired.',
          fix: 'Remove the directive and start HAProxy with `-W` (or `-Ws` for systemd notify) from the service/container definition.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 1,
          versionImpact: '3.3',
        });
      }
      if (item.keyword === 'option' && item.value === 'transparent') {
        add({
          id: `version-option-transparent-${item.line}`,
          severity: 'recommendation',
          category: 'version',
          title: '`option transparent` is deprecated in 3.3',
          detail: 'The transparent proxy option is planned for removal in 3.5.',
          why: 'It complicates architecture and has platform-specific behaviour. Modern deployments usually use explicit source NAT or proxy protocol instead.',
          fix: 'Review the need for transparent mode and plan a migration before 3.5.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 1,
          versionImpact: '3.3',
        });
      }
      if (item.keyword === 'compression-direction') {
        add({
          id: `version-compression-direction-${item.line}`,
          severity: 'recommendation',
          category: 'version',
          title: '`compression-direction` is deprecated in 3.4',
          detail: 'This directive is deprecated in the current LTS branch.',
          why: 'Deprecated directives produce warnings and may be removed in a future LTS.',
          fix: 'Review the 3.4 release notes and use the documented replacement for your direction/compression setup.',
          section: sectionLabel(section),
          line: item.line,
          docs: 'versions',
          weight: 1,
          versionImpact: '3.4',
        });
      }
      if (item.keyword === 'server') {
        const server = item.server;
        if (server?.flags.has('enabled')) {
          add({
            id: `version-server-enabled-${section.name}-${server.name}`,
            severity: 'warning',
            category: 'version',
            title: `Server "${server.name}" uses the \`enabled\` keyword`,
            detail: 'HAProxy 3.0 rejects `enabled` on servers managed through the Runtime API. Newer servers are enabled by default.',
            why: 'Dynamic server workflows change the keyword semantics; keeping it can break automation and reloads.',
            fix: 'Remove `enabled` unless the target version and workflow explicitly require it, then validate with `haproxy -c`.',
            section: sectionLabel(section),
            line: item.line,
            docs: 'versions',
            weight: 2,
            versionImpact: '3.0',
          });
        }
      }
    }
  }

  // Collapse repeated health-check findings into one actionable summary so a
  // large config does not produce a wall of identical warnings.
  const collapse = (prefix, title, detailBuilder, fix, category = 'health') => {
    const group = findings.filter((finding) => finding.id.startsWith(prefix));
    if (group.length < 2) return;
    for (let index = findings.length - 1; index >= 0; index -= 1) {
      if (findings[index].id.startsWith(prefix)) findings.splice(index, 1);
    }
    const backends = group
      .map((finding) => finding.backend || finding.section.replace(/^backend /, ''))
      .filter(Boolean);
    findings.push({
      id: `${prefix}multiple`,
      severity: prefix.startsWith('health-no-check') ? 'recommendation' : 'warning',
      category,
      title,
      detail: detailBuilder(group.length, backends),
      why: group[0].why,
      fix,
      section: 'multiple backends',
      line: group[0].line,
      backends,
      docs: 'health-checks-safe',
      weight: 1,
    });
  };

  collapse(
    'health-checks-not-enabled-',
    'Health-check options are set but no server has `check`',
    (count, backends) => `${count} backends configure a health-check method, but none of their servers enable checks: ${backends.join(', ')}.`,
    'Add `check` to each server (optionally with `inter`, `fall`, `rise`). The check method is inert without it. For a backend with a bare `option httpchk`, first configure an explicit request such as `option httpchk GET /health` and `http-check expect status 200`; the default `OPTIONS /` can mark healthy apps DOWN.',
  );
  collapse(
    'health-no-check-',
    'Backends without active health checks',
    (count, backends) => `${count} backends have servers without \`check\`: ${backends.join(', ')}.`,
    'Add `check` (and optionally `inter 5s fall 3 rise 3`) to every server, or document why a server must remain unchecked.',
  );
  collapse(
    'health-bare-httpchk-',
    'Bare `option httpchk` can mark healthy servers DOWN',
    (count, backends) => `${count} backends use a bare \`option httpchk\` with active checks: ${backends.join(', ')}.`,
    'Configure an explicit request such as `option httpchk GET /health` plus `http-check expect status 200`, or remove `option httpchk` and use a TCP check. A bare `option httpchk` sends `OPTIONS /` and only accepts 2xx/3xx.',
  );

  findings.sort((left, right) => {
    const severity = (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9);
    if (severity !== 0) return severity;
    return (left.line || 0) - (right.line || 0);
  });

  const counts = {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    recommendation: findings.filter((finding) => finding.severity === 'recommendation').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
  const score = Math.max(
    0,
    Math.min(100, 100 - counts.error * 15 - counts.warning * 4 - counts.recommendation),
  );
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';

  const categories = {};
  for (const finding of findings) {
    if (!categories[finding.category]) categories[finding.category] = 0;
    categories[finding.category] += 1;
  }

  return {
    findings,
    counts,
    score,
    grade,
    categories,
    targetVersion,
    state: counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'ok',
  };
}

function parserTitle(code) {
  const titles = {
    'parse-empty': 'Empty configuration',
    'parse-top-level': 'Directive outside a section',
    'proxy-name-duplicate': 'Duplicate proxy name',
    'proxy-name-cross-family': 'Proxy name used across families',
    'frontend-no-bind': 'Frontend has no bind',
    'use-backend-missing': 'Missing use_backend target',
    'default-backend-missing': 'Missing default_backend target',
    'frontend-no-routing': 'No routing configured',
    'server-no-name': 'Server without a name',
    'server-name-duplicate': 'Duplicate server name',
    'server-no-address': 'Server without an address',
    'http-directive-in-tcp': 'HTTP directive in TCP mode',
    'bind-duplicate': 'Duplicate bind',
  };
  return titles[code] || 'Configuration structure issue';
}

function parserFix(code) {
  const fixes = {
    'parse-empty': 'Paste a configuration or open one of the included samples.',
    'parse-top-level': 'Move the directive into global, defaults or the correct proxy section.',
    'proxy-name-duplicate': 'Rename one of the proxies so every name is unique.',
    'proxy-name-cross-family': 'Give each frontend/backend/listen a globally unique name; HAProxy 3.3 rejects duplicates.',
    'frontend-no-bind': 'Add a bind line, or remove the unused frontend. Check whether the intended bind lives in another proxy.',
    'use-backend-missing': 'Define the backend or correct the use_backend target.',
    'default-backend-missing': 'Define the backend or correct the default_backend target.',
    'frontend-no-routing': 'Add default_backend, use_backend rules, or an explicit return action.',
    'server-no-name': 'Use `server <name> <address> ...`.',
    'server-name-duplicate': 'Rename the duplicate server in this backend.',
    'server-no-address': 'Add an address to the server line.',
    'http-directive-in-tcp': 'Switch the proxy to `mode http`, or replace the rule with a `tcp-request` rule.',
    'bind-duplicate': 'Remove or change the duplicate bind.',
  };
  return fixes[code] || 'Review the line and validate with `haproxy -c`.';
}

function timeoutWhy(name) {
  const reasons = {
    connect: 'Without a bounded connect timeout, an unreachable backend can hold clients while HAProxy waits to establish a TCP connection.',
    client: 'The client timeout bounds inactivity in both directions on the client side. Without it, abandoned connections can pin buffers indefinitely.',
    server: 'The server timeout bounds inactivity while waiting for the application. Without it, a stalled backend can exhaust connections and memory.',
  };
  return reasons[name] || 'Timeouts make failure behaviour explicit instead of relying on built-ins.';
}

/** Group findings for a compact UI. */
export function groupFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.category)) groups.set(finding.category, []);
    groups.get(finding.category).push(finding);
  }
  return [...groups.entries()].map(([category, items]) => ({
    category,
    label: CATEGORY_LABELS[category] || category,
    items,
  }));
}

export { sectionLabel, httpProxies, sslBinds };
