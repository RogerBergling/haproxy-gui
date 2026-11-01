/**
 * Safe, opt-in best-practice transformations.
 *
 * Every fix is deterministic, reviewable and returns a diff for approval.
 * Environment-specific advice (logging destinations, maxconn sizing, TLS
 * certificate paths) is exposed as a checklist rather than silently changed.
 */

import {
  applyEdits,
  appendBlock,
  ensureTrailingNewline,
  indentOf,
  routeInsertionLine,
} from './edit.js';
import { parseConfig, effectiveTimeout, timeoutToMs } from './parser.js';

const STRONG_MIN = new Set(['TLSv1.2', 'TLSv1.3']);

function globalSection(model) {
  return model.global || model.sections.find((section) => section.type === 'global') || null;
}

function sslBinds(model) {
  return model.frontends.flatMap((section) =>
    section.binds.filter((bind) => bind.ssl).map((bind) => ({ section, bind })),
  );
}

function bindOptions(model) {
  const global = globalSection(model);
  const item = global?.items.find((entry) => entry.keyword === 'ssl-default-bind-options');
  return { item, args: item ? [...item.args] : [] };
}

function effectiveTlsBaseline(model) {
  if (sslBinds(model).length === 0) return true;
  const { args } = bindOptions(model);
  const minIndex = args.indexOf('ssl-min-ver');
  const min = minIndex >= 0 ? args[minIndex + 1] : null;
  const implicitMin = args.includes('no-sslv3') && args.includes('no-tlsv10') && args.includes('no-tlsv11');
  const tickets = args.includes('no-tls-tickets');
  const allBindsExplicit = sslBinds(model).every(({ bind }) => {
    const bindMin = bind.options['ssl-min-ver'];
    return bindMin && STRONG_MIN.has(bindMin) && bind.options['no-tls-tickets'];
  });
  return ((min && STRONG_MIN.has(min)) || implicitMin || allBindsExplicit) && tickets;
}

function rawWithoutComment(item) {
  return item.raw.replace(/\s+#.*$/, '').trimEnd();
}

export function applyTlsBaseline(text, model) {
  const global = globalSection(model);
  const { item, args } = bindOptions(model);
  const nextArgs = [...args];

  const minIndex = nextArgs.indexOf('ssl-min-ver');
  if (minIndex >= 0) {
    if (!STRONG_MIN.has(nextArgs[minIndex + 1])) nextArgs.splice(minIndex, 2, 'ssl-min-ver', 'TLSv1.2');
  } else {
    nextArgs.push('ssl-min-ver', 'TLSv1.2');
  }
  if (!nextArgs.includes('no-tls-tickets')) nextArgs.push('no-tls-tickets');

  const line = `${item ? indentOf(item.raw) : '\t'}ssl-default-bind-options ${nextArgs.join(' ')}`;

  if (item) {
    if (item.args.join(' ') === nextArgs.join(' ')) return { text, summary: 'TLS baseline already present.' };
    return {
      text: ensureTrailingNewline(applyEdits(text, [{ type: 'replace', line: item.line, text: line }])),
      summary: 'Updated global ssl-default-bind-options to TLS 1.2 minimum and disabled TLS tickets.',
    };
  }

  if (!global) {
    return {
      text: ensureTrailingNewline(`global\n${line}\n\n${text.replace(/^\s+/, '')}`),
      summary: 'Added a global section with a TLS baseline.',
    };
  }

  const updated = applyEdits(text, [{ type: 'insert', line: global.endLine + 1, lines: [line] }]);
  return {
    text: ensureTrailingNewline(updated),
    summary: 'Added a TLS 1.2 minimum and disabled TLS tickets in global.',
  };
}

export function applyTimeouts(text, model) {
  const defaults = model.defaults[0];
  if (!defaults) return { text, summary: 'No defaults section to update.' };
  const needed = [];
  const proxyTimeout = (name) => effectiveTimeout(model, defaults, name);
  if (!proxyTimeout('connect')) needed.push(['connect', '5s']);
  if (!proxyTimeout('client')) needed.push(['client', '30s']);
  if (!proxyTimeout('server')) needed.push(['server', '30s']);
  const hasHttp = model.sections.some(
    (section) => ['frontend', 'backend', 'listen'].includes(section.type) && section.effectiveMode === 'http',
  );
  if (hasHttp && !proxyTimeout('http-request')) needed.push(['http-request', '10s']);
  if (hasHttp && !proxyTimeout('http-keep-alive')) needed.push(['http-keep-alive', '30s']);
  if (needed.length === 0) return { text, summary: 'Core timeouts already present.' };

  const insertion = needed.map(([name, value]) => `\ttimeout ${name} ${value}`);
  const updated = applyEdits(text, [{ type: 'insert', line: defaults.endLine + 1, lines: insertion }]);
  return {
    text: ensureTrailingNewline(updated),
    summary: `Added ${needed.map(([name, value]) => `timeout ${name} ${value}`).join(', ')} to defaults.`,
  };
}

export function applyServerChecks(text, model) {
  const edits = [];
  let added = 0;
  for (const backend of model.backends) {
    for (const item of backend.items) {
      if (item.keyword !== 'server' || !item.server) continue;
      if (item.server.flags.has('check')) continue;
      const raw = rawWithoutComment(item);
      const suffix = item.comment ? ` # ${item.comment}` : '';
      edits.push({
        type: 'replace',
        line: item.line,
        text: `${raw} check inter 2s fall 3 rise 2${suffix}`,
      });
      added += 1;
    }
  }
  if (edits.length === 0) return { text, summary: 'All servers already have health checks.' };
  return {
    text: ensureTrailingNewline(applyEdits(text, edits)),
    summary: `Enabled TCP health checks on ${added} server${added === 1 ? '' : 's'} (inter 2s, fall 3, rise 2).`,
  };
}

function frontendsMissingForwardfor(model) {
  const defaults = model.defaults[0];
  const inheritedForward = defaults?.items.some((item) =>
    item.keyword === 'option' && item.value === 'forwardfor',
  );
  if (inheritedForward) return [];
  return model.frontends.filter((frontend) => {
    if (frontend.effectiveMode !== 'http' || frontend.binds.length === 0) return false;
    const hasForward = frontend.items.some((item) =>
      item.keyword === 'option' && item.value === 'forwardfor',
    );
    const manual = frontend.items.some((item) =>
      item.raw.includes('X-Forwarded-For') || item.raw.includes('X-Client-IP'),
    );
    return !hasForward && !manual;
  });
}

export function applyForwardfor(text, model) {
  const frontends = frontendsMissingForwardfor(model);
  if (frontends.length === 0) return { text, summary: 'Client-IP forwarding already configured.' };
  const edits = frontends.map((frontend) => ({
    type: 'insert',
    line: routeInsertionLine(frontend),
    lines: ['\toption forwardfor'],
  }));
  return {
    text: ensureTrailingNewline(applyEdits(text, edits)),
    summary: `Added option forwardfor to ${frontends.length} HTTP frontend${frontends.length === 1 ? '' : 's'}.`,
  };
}

export function applyStatsTimeout(text, model) {
  const global = globalSection(model);
  const socket = global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'socket');
  if (!socket) return { text, summary: 'No runtime socket to update.' };
  if (global.items.some((item) => item.keyword === 'stats' && item.args[0] === 'timeout')) {
    return { text, summary: 'Stats timeout already present.' };
  }
  const line = `${indentOf(socket.raw)}stats timeout 30s`;
  return {
    text: ensureTrailingNewline(applyEdits(text, [{ type: 'insert', line: socket.line + 1, lines: [line] }])),
    summary: 'Added stats timeout 30s to the Runtime API socket configuration.',
  };
}

export function applyStatsSocketMode(text, model) {
  const global = globalSection(model);
  const socket = global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'socket');
  if (!socket) return { text, summary: 'No runtime socket to update.' };
  const args = [...socket.args];
  const modeIndex = args.indexOf('mode');
  if (modeIndex >= 0) {
    if (args[modeIndex + 1] === '660') return { text, summary: 'Runtime socket already uses mode 660.' };
    args[modeIndex + 1] = '660';
  } else {
    const levelIndex = args.indexOf('level');
    args.splice(levelIndex >= 0 ? levelIndex : args.length, 0, 'mode', '660');
  }
  const line = `${indentOf(socket.raw)}stats ${args.join(' ')}`;
  return {
    text: ensureTrailingNewline(applyEdits(text, [{ type: 'replace', line: socket.line, text: line }])),
    summary: 'Set the Runtime API socket to mode 660 so only the owner/group can use it.',
  };
}

export const BEST_PRACTICE_FIXES = [
  {
    id: 'tls-baseline',
    title: 'Set a modern TLS baseline',
    summary: 'Require TLS 1.2+, disable TLS session tickets and remove weaker legacy minimums.',
    detail:
      'TLS 1.0/1.1 are deprecated. Session tickets with static keys weaken forward secrecy. This fix updates the global bind defaults only; per-bind options can still override them, so review the diff.',
    risk: 'Low. Old clients that cannot negotiate TLS 1.2 will be rejected. Test before applying to public endpoints.',
    impact: 'TLS',
    applies: (model) => sslBinds(model).length > 0 && !effectiveTlsBaseline(model),
    apply: applyTlsBaseline,
  },
  {
    id: 'timeouts',
    title: 'Add explicit core timeouts',
    summary: 'Add missing connect, client, server, HTTP request-header and keep-alive timeouts to defaults.',
    detail:
      'This fix only fills gaps. It never overwrites an existing timeout. Values are deliberately conservative starting points: connect 5s, client/server 30s, http-request 10s, http-keep-alive 30s.',
    risk: 'Low–medium. A 30s server timeout may be too short for long-running generation or streaming endpoints. Review the values before applying.',
    impact: 'Reliability',
    applies: (model) => {
      const defaults = model.defaults[0];
      if (!defaults) return false;
      return ['connect', 'client', 'server'].some((name) => !effectiveTimeout(model, defaults, name))
        || (model.sections.some((section) => ['frontend', 'backend', 'listen'].includes(section.type) && section.effectiveMode === 'http')
          && (!effectiveTimeout(model, defaults, 'http-request') || !effectiveTimeout(model, defaults, 'http-keep-alive')));
    },
    apply: applyTimeouts,
  },
  {
    id: 'server-checks',
    title: 'Enable health checks on every server',
    summary: 'Add `check inter 2s fall 3 rise 2` to server lines that lack active checks.',
    detail:
      'This is a TCP connect check. If an existing backend has `option httpchk` or `option tcp-check`, the added `check` activates that configured method. Health checks remove dead servers from rotation before users see errors.',
    risk: 'Medium. Services that reject short-lived connections may be marked down. For HTTP applications, prefer an application health endpoint with `option httpchk GET /health`.',
    impact: 'Availability',
    applies: (model) => model.backends.some((backend) =>
      backend.items.some((item) => item.keyword === 'server' && item.server && !item.server.flags.has('check')),
    ),
    apply: applyServerChecks,
  },
  {
    id: 'forwardfor',
    title: 'Forward the client IP',
    summary: 'Add `option forwardfor` to HTTP frontends that do not already forward a client address.',
    detail:
      'Applications behind HAProxy otherwise see the proxy address as the client. This fix adds the standard X-Forwarded-For header only where no manual forwarding was detected.',
    risk: 'Low–medium. The backend must trust X-Forwarded-For only from HAProxy; otherwise clients can spoof it. Do not enable this on a frontend that already receives untrusted X-Forwarded-For headers from another proxy.',
    impact: 'Observability',
    applies: (model) => frontendsMissingForwardfor(model).length > 0,
    apply: applyForwardfor,
  },
  {
    id: 'stats-timeout',
    title: 'Bound the Runtime API socket timeout',
    summary: 'Add `stats timeout 30s` beside a configured stats socket.',
    detail:
      'A runtime client that connects and stalls can hold resources. A bounded timeout keeps the Runtime API responsive without changing traffic routing.',
    risk: 'Low. Long-running interactive Runtime API sessions may need a higher timeout or reconnects.',
    impact: 'Operations',
    applies: (model) => {
      const global = globalSection(model);
      return Boolean(global?.items.some((item) => item.keyword === 'stats' && item.args[0] === 'socket')) &&
        !global.items.some((item) => item.keyword === 'stats' && item.args[0] === 'timeout');
    },
    apply: applyStatsTimeout,
  },
  {
    id: 'stats-socket-permissions',
    title: 'Restrict the Runtime API socket',
    summary: 'Set the admin stats socket to mode 660.',
    detail:
      'The admin socket can change server state and weights. Ensure only the HAProxy owner/group can access it.',
    risk: 'Low–medium. A monitoring process that previously relied on broader socket permissions may need to join the HAProxy group.',
    impact: 'Security',
    applies: (model) => {
      const global = globalSection(model);
      const socket = global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'socket');
      if (!socket) return false;
      const modeIndex = socket.args.indexOf('mode');
      const mode = modeIndex >= 0 ? socket.args[modeIndex + 1] : null;
      if (!mode) return socket.args.includes('level') && socket.args[socket.args.indexOf('level') + 1] === 'admin';
      return /^[0-7]{3,4}$/.test(mode) && (Number.parseInt(mode, 8) & 0o007) !== 0;
    },
    apply: applyStatsSocketMode,
  },
];

/** Map analyzer finding ids to the safe best-practice fixes that can remediate them. */
const FINDING_FIX_MAP = [
  { pattern: /^health-(checks-not-enabled|no-check|mixed-checks)/, ids: ['server-checks'] },
  {
    pattern: /^timeouts-(default-(connect|client|server)|frontend-client|backend-(server|connect)|http-request|http-keepalive)/,
    ids: ['timeouts'],
  },
  { pattern: /^tls-(old-min-version|min-version-missing|tickets-enabled)/, ids: ['tls-baseline'] },
  { pattern: /^routing-no-forwardfor/, ids: ['forwardfor'] },
  { pattern: /^operations-stats-timeout/, ids: ['stats-timeout'] },
  { pattern: /^security-stats-socket-(mode|world)/, ids: ['stats-socket-permissions'] },
];

export function fixIdsForFinding(finding) {
  if (!finding?.id) return [];
  return FINDING_FIX_MAP
    .filter((entry) => entry.pattern.test(finding.id))
    .flatMap((entry) => entry.ids);
}

export function canFixFinding(model, finding) {
  return fixIdsForFinding(finding).some((id) => {
    const fix = BEST_PRACTICE_FIXES.find((entry) => entry.id === id);
    return fix ? fix.applies(model) : false;
  });
}

export function applyFindingFix(text, finding) {
  return applyBestPracticeFixes(text, fixIdsForFinding(finding));
}

export function applyBestPracticeFixes(text, ids) {
  let current = text;
  const applied = [];
  let model = parseConfig(current);
  for (const id of ids) {
    const fix = BEST_PRACTICE_FIXES.find((entry) => entry.id === id);
    if (!fix || !fix.applies(model)) continue;
    const result = fix.apply(current, model);
    if (!result || result.text === current) continue;
    current = result.text;
    applied.push({ id, title: fix.title, summary: result.summary });
    model = parseConfig(current);
  }
  return { text: current, applied };
}

export function buildBestPracticeChecklist(model, analysis) {
  const ssl = sslBinds(model);
  const defaults = model.defaults[0];
  const finding = (idPrefix) => analysis.findings.some((entry) => entry.id.startsWith(idPrefix));
  const http = model.frontends.filter((frontend) => frontend.effectiveMode === 'http' && frontend.binds.length > 0);
  const servers = model.backends.flatMap((backend) => backend.servers.map((server) => ({ backend, server })));
  const allChecked = servers.length === 0 || servers.every(({ server }) => server.flags.has('check'));
  const statsSocket = model.global?.items.find((item) => item.keyword === 'stats' && item.args[0] === 'socket');
  const hasLog = Boolean(model.global?.items.some((item) => item.keyword === 'log')) ||
    Boolean(defaults?.items.some((item) => item.keyword === 'log'));
  const hasMaxconn = model.sections.some((section) => section.items.some((item) => item.keyword === 'maxconn'));
  const tlsMin = () => {
    const { args } = bindOptions(model);
    const minIndex = args.indexOf('ssl-min-ver');
    const min = minIndex >= 0 ? args[minIndex + 1] : null;
    return min || (args.includes('no-tlsv10') && args.includes('no-tlsv11') ? 'TLSv1.2 (implied)' : null);
  };
  const min = tlsMin();
  const plainHttp = http.filter((frontend) => frontend.binds.some((bind) => !bind.ssl && (bind.port === '80' || bind.port === null)));
  const httpRedirect = plainHttp.some((frontend) =>
    frontend.items.some((item) => item.keyword === 'http-request' && item.action === 'redirect'),
  );
  const duplicates = analysis.findings.some((entry) => entry.title.toLowerCase().includes('duplicate'));
  const versionIssues = analysis.findings.filter((entry) => entry.category === 'version');
  const httpReuseNever = Boolean(defaults?.items.some((item) =>
    item.keyword === 'http-reuse' && item.args[0] === 'never',
  )) || model.backends.some((backend) =>
    backend.items.some((item) => item.keyword === 'http-reuse' && item.args[0] === 'never'),
  );
  const unverifiedCertHeaders = finding('security-client-cert-unverified');
  const check = (id, title, status, detail, action = null) => ({ id, title, status, detail, action });

  return [
    check(
      'structure',
      'Configuration structure is valid for analysis',
      analysis.counts.error === 0 ? 'pass' : 'fail',
      analysis.counts.error === 0
        ? 'No structural errors were found by the built-in analyzer. Always run `haproxy -c` with the real target binary before deploying.'
        : `${analysis.counts.error} structural error${analysis.counts.error === 1 ? '' : 's'} would likely prevent startup.`,
      analysis.counts.error > 0 ? { type: 'analyze', label: 'Review errors' } : null,
    ),
    check(
      'timeouts',
      'Explicit connection and request timeouts',
      !defaults || ['connect', 'client', 'server'].some((name) => !effectiveTimeout(model, defaults, name))
        ? 'fail'
        : !effectiveTimeout(model, defaults, 'http-request') && http.length > 0
          ? 'warn'
          : 'pass',
      !defaults
        ? 'No defaults section exists; timeouts fall back to built-ins.'
        : ['connect', 'client', 'server'].some((name) => !effectiveTimeout(model, defaults, name))
          ? 'One or more core timeouts are missing from defaults.'
          : !effectiveTimeout(model, defaults, 'http-request') && http.length > 0
            ? 'Core timeouts exist, but HTTP request-header timeout is missing.'
            : 'Connect, client and server timeouts are explicit.',
      { type: 'fix', id: 'timeouts', label: 'Add missing timeouts' },
    ),
    check(
      'tls',
      'TLS 1.2+ with safe defaults',
      ssl.length === 0 ? 'n/a' : min && STRONG_MIN.has(String(min).split(' ')[0]) ? 'pass' : 'fail',
      ssl.length === 0
        ? 'No TLS-terminating binds were found. This is only acceptable if TLS ends at a trusted layer in front of HAProxy.'
        : min && STRONG_MIN.has(String(min).split(' ')[0])
          ? `Minimum ${min} is configured${effectiveTlsBaseline(model) ? ', TLS tickets are disabled.' : '; review ticket settings.'}`
          : 'No effective TLS 1.2 minimum was found.',
      ssl.length && !(min && STRONG_MIN.has(String(min).split(' ')[0]) && effectiveTlsBaseline(model))
        ? { type: 'fix', id: 'tls-baseline', label: 'Apply TLS baseline' }
        : null,
    ),
    check(
      'cipher-list',
      'Explicit modern TLS 1.2 cipher list',
      ssl.length === 0 ? 'n/a' : finding('tls-weak-ciphers') ? 'fail' : finding('tls-ciphers-not-set') ? 'warn' : 'pass',
      ssl.length === 0
        ? 'No SSL bind to review.'
        : finding('tls-weak-ciphers')
          ? 'Legacy cipher tokens were detected.'
          : finding('tls-ciphers-not-set')
            ? 'The cipher list depends on the OpenSSL build rather than an explicit policy.'
            : 'An explicit cipher list without known weak tokens is present.',
    ),
    check(
      'health',
      'All servers have active health checks',
      servers.length === 0 ? 'n/a' : allChecked ? 'pass' : 'fail',
      servers.length === 0
        ? 'No servers are defined.'
        : allChecked
          ? 'Every server has a check. Review timing and the check method (TCP vs HTTP health endpoint).'
          : `${servers.filter(({ server }) => !server.flags.has('check')).length} server(s) have no check.`,
      servers.length && !allChecked ? { type: 'fix', id: 'server-checks', label: 'Enable checks' } : null,
    ),
    check(
      'logging',
      'Logging and runtime observability',
      !hasLog ? 'fail' : !statsSocket ? 'warn' : 'pass',
      !hasLog
        ? 'No log target was found. Troubleshooting will be much harder.'
        : !statsSocket
          ? 'Logging is configured, but no runtime socket exists for live inspection and graceful state changes.'
          : 'A log target and runtime socket are configured.',
    ),
    check(
      'maxconn',
      'Connection limits are explicit',
      hasMaxconn ? 'pass' : 'warn',
      hasMaxconn
        ? 'A maxconn limit is present. Verify it against file-descriptor and memory limits.'
        : 'No maxconn was found; a spike can exhaust descriptors or memory.',
    ),
    check(
      'stats-socket',
      'Runtime socket is protected',
      !statsSocket ? 'n/a' : finding('security-stats-socket') ? 'fail' : 'pass',
      !statsSocket
        ? 'No runtime socket; this check does not apply.'
        : finding('security-stats-socket')
          ? 'The admin socket permissions need attention.'
          : 'The stats socket is restricted or explicitly configured.',
    ),
    check(
      'forwardfor',
      'Client IP is forwarded to HTTP backends',
      http.length === 0 ? 'n/a' : finding('routing-no-forwardfor') ? 'warn' : 'pass',
      http.length === 0
        ? 'No HTTP frontends were found.'
        : finding('routing-no-forwardfor')
          ? 'One or more HTTP frontends do not forward the client address.'
          : 'Client address forwarding appears to be configured.',
      finding('routing-no-forwardfor') ? { type: 'fix', id: 'forwardfor', label: 'Add forwardfor' } : null,
    ),
    check(
      'http-redirect',
      'Public plaintext HTTP is redirected',
      plainHttp.length === 0 ? 'n/a' : httpRedirect ? 'pass' : 'warn',
      plainHttp.length === 0
        ? 'No plaintext HTTP listener was detected.'
        : httpRedirect
          ? 'An HTTPS redirect is configured.'
          : 'A plaintext HTTP listener has no detected HTTPS redirect. Confirm this is intentional.',
    ),
    check(
      'client-cert',
      'Client certificate identity is verified',
      unverifiedCertHeaders ? 'fail' : 'n/a',
      unverifiedCertHeaders
        ? 'Certificate fields are forwarded without `verify required`. Do not trust them as identity.'
        : 'No unverified client-certificate identity forwarding was detected.',
    ),
    check(
      'version',
      'No known 3.x blockers',
      versionIssues.some((entry) => entry.severity === 'error') ? 'fail' : versionIssues.length ? 'warn' : 'pass',
      versionIssues.length
        ? `${versionIssues.length} version-related finding(s) need review before upgrading.`
        : 'No known removed or deprecated syntax was detected for the 3.x target.',
      versionIssues.length ? { type: 'versions', label: 'Upgrade guide' } : null,
    ),
    check(
      'duplicates',
      'No duplicate proxy or server names',
      duplicates ? 'warn' : 'pass',
      duplicates
        ? 'Duplicate names are rejected by HAProxy 3.3+ and can route traffic to the wrong object today.'
        : 'No duplicate proxy or server names were detected.',
    ),
    check(
      'balance',
      'Explicit balance algorithm on multi-server backends',
      finding('version-implicit-balance-default') ? 'warn' : 'pass',
      finding('version-implicit-balance-default')
        ? 'One or more multi-server backends rely on the implicit default. HAProxy 3.3 changed it from roundrobin to random.'
        : 'Multi-server backends either set an explicit balance algorithm or have only one server.',
    ),
    check(
      'reuse',
      'Backend connection reuse is not disabled',
      httpReuseNever ? 'warn' : 'pass',
      httpReuseNever
        ? '`http-reuse never` forces a new upstream connection per request. Confirm it is required.'
        : 'No global `http-reuse never` policy was detected on HTTP backends.',
    ),
  ];
}
