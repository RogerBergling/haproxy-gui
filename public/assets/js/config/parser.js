/**
 * HAProxy configuration parser.
 *
 * This is intentionally a structural parser, not a replacement for
 * `haproxy -c`. It understands section boundaries, directives, binds, ACLs,
 * routing rules and servers well enough for explanation, analysis, editing and
 * simulation. Unknown directives are preserved and never treated as errors.
 */

export const SECTION_TYPES = new Set([
  'global',
  'defaults',
  'frontend',
  'backend',
  'listen',
  'resolvers',
  'peers',
  'cache',
  'ring',
  'program',
  'http-errors',
  'mailers',
  'fcgi-app',
  'userlist',
  'log-forward',
  'traces',
  'crt-store',
  'acme',
]);

const BIND_FLAGS = new Set([
  'ssl',
  'accept-proxy',
  'defer-accept',
  'reuseport',
  'transparent',
  'v4v6',
  'v6only',
  'allow-0rtt',
  'no-tls-tickets',
  'prefer-client-ciphers',
  'strict-sni',
  'tfo',
  'generate-certificates',
  'no-sslv3',
  'no-tlsv10',
  'no-tlsv11',
  'no-tlsv12',
  'no-tlsv13',
  'quic-force-retrans',
  'expose-fd',
  'shards',
]);

const BIND_VALUES = new Set([
  'crt',
  'crt-list',
  'ca-file',
  'ca-verify-file',
  'verify',
  'alpn',
  'ssl-min-ver',
  'ssl-max-ver',
  'ciphers',
  'ciphersuites',
  'curves',
  'ecdhe',
  'client-sigalgs',
  'sigalgs',
  'name',
  'id',
  'level',
  'mss',
  'backlog',
  'maxconn',
  'nbconn',
  'nice',
  'process',
  'thread',
  'namespace',
  'tcp-ut',
  'quic-cc-algo',
  'quic-max-window',
  'quic-max-frame-size',
  'quic-initial-max-data',
  'quic-initial-max-stream-data',
  'quic-initial-max-streams-bidi',
  'quic-initial-max-streams-uni',
  'shards',
]);

const SERVER_FLAGS = new Set([
  'check',
  'backup',
  'disabled',
  'ssl',
  'verify',
  'send-proxy',
  'send-proxy-v2',
  'send-proxy-v2-ssl',
  'send-proxy-v2-ssl-cn',
  'tfo',
  'non-stick',
  'redir',
  'observe',
  'on-marked-down',
  'on-marked-up',
  'force-sslv3',
  'force-tlsv10',
  'force-tlsv11',
  'force-tlsv12',
  'force-tlsv13',
]);

const SERVER_VALUES = new Set([
  'weight',
  'maxconn',
  'maxqueue',
  'minconn',
  'id',
  'inter',
  'fastinter',
  'downinter',
  'fall',
  'rise',
  'port',
  'sni',
  'verifyhost',
  'ca-file',
  'crt',
  'source',
  'namespace',
  'agent-inter',
  'agent-port',
  'agent-addr',
  'check-send-proxy',
  'check-proto',
  'check-sni',
  'check-inter',
  'check-timeout',
  'proto',
  'alpn',
]);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Tokenize one logical configuration line (quotes removed, comments cut). */
export function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === '\\' && quote === '"' && index + 1 < line.length) {
        current += line[index + 1];
        index += 1;
      } else if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      started = true;
      continue;
    }

    if (char === '#') break;

    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }

    if (char === '\\' && index + 1 < line.length) {
      current += line[index + 1];
      index += 1;
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }

    current += char;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

function commentIndex(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      return index;
    }
  }
  return -1;
}

export function inlineComment(line) {
  const index = commentIndex(line);
  return index >= 0 ? line.slice(index + 1).trim() : '';
}

function isContinuation(line) {
  const index = commentIndex(line);
  const code = index >= 0 ? line.slice(0, index) : line;
  return /\\\s*$/.test(code);
}

function logicalLines(lines) {
  const result = [];
  let buffer = '';
  let startLine = 1;
  let endLine = 1;

  const flush = () => {
    if (buffer.trim()) result.push({ text: buffer, line: startLine, endLine });
    buffer = '';
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!buffer) startLine = lineNumber;
    endLine = lineNumber;

    const indexOfComment = commentIndex(line);
    const code = indexOfComment >= 0 ? line.slice(0, indexOfComment) : line;

    if (isContinuation(line)) {
      buffer += `${code.replace(/\\\s*$/, '')} `;
      return;
    }

    buffer += line;
    flush();
  });

  flush();
  return result;
}

function splitAddress(address) {
  let value = String(address || '').trim();
  // bind prefixes such as quic4@*, ssl@, tcp@ and abns@.
  value = value.replace(/^[a-z0-9]+@/i, '');

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close > 0) {
      return {
        host: value.slice(1, close) || '::',
        port: value.slice(close + 1).replace(/^:/, '') || null,
      };
    }
  }

  const lastColon = value.lastIndexOf(':');
  if (lastColon > 0) {
    const hostPart = value.slice(0, lastColon);
    const portPart = value.slice(lastColon + 1);
    if (/^\d+$/.test(portPart)) return { host: hostPart, port: portPart };
  }
  if (value.startsWith(':') && /^\d+$/.test(value.slice(1))) {
    return { host: '', port: value.slice(1) };
  }
  return { host: value, port: null };
}

function parseBindArgs(args) {
  const addresses = [];
  const options = {};
  let index = 0;

  while (index < args.length) {
    const token = args[index];
    if (BIND_VALUES.has(token)) {
      options[token] = args[index + 1] ?? true;
      index += 2;
      continue;
    }
    if (BIND_FLAGS.has(token)) {
      options[token] = true;
      index += 1;
      continue;
    }
    for (const part of token.split(',')) {
      if (part) addresses.push(part);
    }
    index += 1;
  }

  return addresses.map((raw) => {
    const { host, port } = splitAddress(raw);
    return {
      raw,
      host,
      port,
      ssl: Boolean(options.ssl),
      cert: typeof options.crt === 'string' ? options.crt : null,
      certList: typeof options['crt-list'] === 'string' ? options['crt-list'] : null,
      alpn: typeof options.alpn === 'string' ? options.alpn : null,
      options,
      isLoopback: isLoopbackHost(host),
    };
  });
}

function parseServerArgs(args, template = false) {
  if (args.length < (template ? 3 : 2)) {
    return { name: args[0] || '', address: '', host: '', port: null, options: {}, flags: new Set(), template };
  }
  const name = args[0];
  const count = template ? args[1] : null;
  const address = template ? args[2] : args[1];
  const rest = template ? args.slice(3) : args.slice(2);
  const options = {};
  const flags = new Set();
  let index = 0;
  while (index < rest.length) {
    const token = rest[index];
    if (SERVER_VALUES.has(token)) {
      options[token] = rest[index + 1] ?? true;
      index += 2;
      continue;
    }
    flags.add(token);
    index += 1;
  }
  const { host, port } = splitAddress(address);
  return { name, address, host, port, options, flags, template, count };
}

function parseAcl(args) {
  return {
    name: args[0] || '',
    criterion: args[1] || '',
    args: args.slice(2),
  };
}

function parseActionCondition(args) {
  const ifIndex = args.findIndex((token) => token === 'if' || token === 'unless');
  return {
    condition: ifIndex >= 0 ? args.slice(ifIndex + 1) : null,
    negate: ifIndex >= 0 ? args[ifIndex] === 'unless' : false,
    actionArgs: ifIndex >= 0 ? args.slice(0, ifIndex) : args,
  };
}

function parseStatus(actionArgs) {
  const index = actionArgs.indexOf('status');
  if (index >= 0 && actionArgs[index + 1] && /^\d{3}$/.test(actionArgs[index + 1])) {
    return Number(actionArgs[index + 1]);
  }
  return null;
}

function parseStringLiteral(actionArgs) {
  const index = actionArgs.indexOf('string');
  if (index >= 0) return actionArgs.slice(index + 1).join(' ');
  return '';
}

function parseItem(keyword, args, raw, line, endLine, comment) {
  const item = {
    keyword,
    args,
    raw,
    line,
    endLine,
    comment,
    condition: null,
    negate: false,
  };

  switch (keyword) {
    case 'bind':
      item.binds = parseBindArgs(args);
      break;
    case 'mode':
      item.value = args[0] || '';
      break;
    case 'server':
    case 'server-template':
      item.server = parseServerArgs(args, keyword === 'server-template');
      break;
    case 'acl':
      item.acl = parseAcl(args);
      break;
    case 'use_backend': {
      item.backend = args[0] || '';
      const parsed = parseActionCondition(args.slice(1));
      item.condition = parsed.condition;
      item.negate = parsed.negate;
      break;
    }
    case 'default_backend':
      item.backend = args[0] || '';
      break;
    case 'balance':
      item.algorithm = args[0] || '';
      break;
    case 'http-request':
    case 'http-response':
    case 'http-after-response':
    case 'tcp-request':
    case 'tcp-response':
    case 'http-check': {
      const parsed = parseActionCondition(args);
      item.action = args[0] || '';
      item.actionArgs = parsed.actionArgs;
      item.condition = parsed.condition;
      item.negate = parsed.negate;
      item.status = parseStatus(parsed.actionArgs);
      item.body = parseStringLiteral(parsed.actionArgs);
      break;
    }
    case 'option':
    case 'no option':
      item.value = args[0] || '';
      break;
    case 'timeout':
      item.timeoutName = args[0] || '';
      item.timeoutValue = args[1] || '';
      break;
    case 'capture':
      item.captureType = args[0] || '';
      break;
    case 'stick-table':
    case 'stick':
      item.value = args[0] || '';
      break;
    default:
      break;
  }
  return item;
}

function parseSection(headerTokens, line) {
  const type = headerTokens[0];
  const name = type === 'global' ? '' : headerTokens[1] || '';
  return {
    type,
    name,
    line,
    startLine: line,
    endLine: line,
    header: headerTokens.join(' '),
    items: [],
    binds: [],
    servers: [],
    acls: [],
    rules: [],
    actions: [],
    mode: null,
    effectiveMode: 'tcp',
    balance: null,
    defaultBackend: null,
    comments: [],
  };
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

export function isLoopbackHost(host) {
  if (!host) return false;
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '127.0.0.1' ||
    value.startsWith('127.')
  );
}

function isWildcardHost(host) {
  return !host || host === '*' || host === '0.0.0.0' || host === '::';
}

function normalizeBindHost(host) {
  if (isWildcardHost(host)) return '*';
  return String(host).toLowerCase();
}

function normalizeBindKey(bind) {
  return `${normalizeBindHost(bind.host)}:${bind.port || '*'}`;
}

export function formatBind(bind) {
  if (bind.port) return `${bind.host || '*'}:${bind.port}`;
  return bind.raw;
}

/**
 * Parse HAProxy configuration text into a structural model.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseConfig(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const sections = [];
  const issues = [];
  let current = null;
  let sawContent = false;

  if (!source.trim()) {
    return {
      text: source,
      lines,
      sections,
      frontends: [],
      backends: [],
      listens: [],
      defaults: [],
      global: null,
      issues: [
        {
          severity: 'error',
          code: 'parse-empty',
          message: 'The configuration is empty.',
          line: 1,
        },
      ],
      stats: {
        sections: 0,
        frontends: 0,
        backends: 0,
        listens: 0,
        servers: 0,
        binds: 0,
        acls: 0,
        rules: 0,
        lines: lines.length,
      },
    };
  }

  for (const logical of logicalLines(lines)) {
    const trimmed = logical.text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const tokens = tokenize(logical.text);
    if (tokens.length === 0) continue;

    if (SECTION_TYPES.has(tokens[0])) {
      sawContent = true;
      if (current) {
        current.endLine = logical.line - 1;
        sections.push(current);
      }
      current = parseSection(tokens, logical.line);
      current.headerComment = inlineComment(logical.text);
      continue;
    }

    if (!sawContent || !current) {
      issues.push({
        severity: 'warning',
        code: 'parse-top-level',
        message: `Directive "${tokens[0]}" appears before the first section header. HAProxy expects it inside a section such as global or defaults.`,
        line: logical.line,
      });
      continue;
    }

    const item = parseItem(
      tokens[0],
      tokens.slice(1),
      trimmed,
      logical.line,
      logical.endLine,
      inlineComment(logical.text),
    );
    current.items.push(item);

    if (item.binds) {
      for (const bind of item.binds) {
        current.binds.push({ ...bind, line: logical.line });
      }
    }
    if (item.server) current.servers.push({ ...item.server, line: logical.line });
    if (item.acl) current.acls.push({ ...item.acl, line: logical.line });
    if (item.keyword === 'use_backend') {
      current.rules.push({
        type: 'use_backend',
        backend: item.backend,
        condition: item.condition,
        negate: item.negate,
        line: logical.line,
        item,
      });
    }
    if (item.keyword === 'http-request' || item.keyword === 'tcp-request' || item.keyword === 'http-after-response') {
      current.actions.push(item);
    }
    if (item.keyword === 'mode') current.mode = item.value;
    if (item.keyword === 'balance') current.balance = item.algorithm;
    if (item.keyword === 'default_backend') current.defaultBackend = item.backend;
  }

  if (current) {
    current.endLine = lines.length;
    sections.push(current);
  }

  const global = sections.find((section) => section.type === 'global') || null;
  const defaults = sections.filter((section) => section.type === 'defaults');
  // listen sections are both frontends and backends. Model them in both lists
  // so routing, simulation, topology and safety checks see them.
  const frontendOnly = sections.filter((section) => section.type === 'frontend');
  const frontends = sections.filter((section) => section.type === 'frontend' || section.type === 'listen');
  const backends = sections.filter((section) => section.type === 'backend' || section.type === 'listen');
  const listens = sections.filter((section) => section.type === 'listen');

  const defaultMode = defaults.find((section) => section.mode)?.mode || 'tcp';
  for (const section of sections) {
    if (['frontend', 'backend', 'listen'].includes(section.type)) {
      section.effectiveMode = section.mode || defaultMode;
    } else if (section.type === 'defaults') {
      section.effectiveMode = section.mode || 'tcp';
    }
  }

  // Resolve references, duplicate names and duplicate binds.
  const proxyNames = new Map();
  for (const section of sections) {
    if (!['frontend', 'backend', 'listen'].includes(section.type) || !section.name) continue;
    const key = section.name;
    if (!proxyNames.has(key)) proxyNames.set(key, []);
    proxyNames.get(key).push(section);
  }

  for (const [name, group] of proxyNames) {
    if (group.length > 1) {
      const sameType = group.some((section) => section.type !== group[0].type);
      issues.push({
        severity: sameType ? 'warning' : 'error',
        code: sameType ? 'proxy-name-cross-family' : 'proxy-name-duplicate',
        message: sameType
          ? `The proxy name "${name}" is used by more than one proxy family. HAProxy 3.1 warns about this and HAProxy 3.3 rejects duplicates.`
          : `The proxy name "${name}" is defined more than once.`,
        line: group[1].line,
        section: name,
      });
    }
  }

  for (const section of sections) {
    if (!['frontend', 'backend', 'listen'].includes(section.type)) continue;

    if (section.type !== 'backend' && section.binds.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'frontend-no-bind',
        message: `${section.type} "${section.name || '(unnamed)'}" has no bind line and cannot receive traffic directly.`,
        line: section.line,
        section: section.name,
      });
    }

    if (section.type === 'frontend' || section.type === 'listen') {
      const backendNames = new Set(
        sections.filter((entry) => ['backend', 'listen'].includes(entry.type)).map((entry) => entry.name),
      );
      for (const rule of section.rules) {
        if (rule.backend && !backendNames.has(rule.backend)) {
          issues.push({
            severity: 'error',
            code: 'use-backend-missing',
            message: `use_backend references "${rule.backend}", but no backend with that name exists.`,
            line: rule.line,
            section: section.name,
          });
        }
      }
      if (section.defaultBackend && !backendNames.has(section.defaultBackend)) {
        issues.push({
          severity: 'error',
          code: 'default-backend-missing',
          message: `default_backend references "${section.defaultBackend}", but no backend with that name exists.`,
          line: section.line,
          section: section.name,
        });
      }
      const selfServingListen = section.type === 'listen' && section.servers.length > 0;
      if (!section.defaultBackend && section.rules.length === 0 && !selfServingListen &&
          !section.actions.some((action) => action.action === 'return')) {
        issues.push({
          severity: 'warning',
          code: 'frontend-no-routing',
          message: `${section.type} "${section.name || '(unnamed)'}" has neither a default_backend nor use_backend rule. Unmatched requests will fail.`,
          line: section.line,
          section: section.name,
        });
      }
    }

    if (section.type === 'backend' || section.type === 'listen') {
      const names = new Set();
      for (const server of section.servers) {
        if (!server.name) {
          issues.push({
            severity: 'error',
            code: 'server-no-name',
            message: `A server line in "${section.name}" has no name.`,
            line: server.line,
            section: section.name,
          });
        } else if (names.has(server.name)) {
          issues.push({
            severity: 'error',
            code: 'server-name-duplicate',
            message: `Server name "${server.name}" is duplicated in backend "${section.name}".`,
            line: server.line,
            section: section.name,
          });
        }
        names.add(server.name);
        if (!server.address) {
          issues.push({
            severity: 'error',
            code: 'server-no-address',
            message: `Server "${server.name}" in "${section.name}" has no address.`,
            line: server.line,
            section: section.name,
          });
        }
      }
    }

    if (section.effectiveMode === 'tcp') {
      for (const item of section.items) {
        if (['http-request', 'http-response', 'http-after-response'].includes(item.keyword)) {
          issues.push({
            severity: 'error',
            code: 'http-directive-in-tcp',
            message: `"${item.keyword}" is not valid in TCP mode (${section.name || section.type}).`,
            line: item.line,
            section: section.name,
          });
        }
      }
    }
  }

  const bindSeen = new Map();
  for (const section of sections) {
    if (!['frontend', 'listen'].includes(section.type)) continue;
    for (const bind of section.binds) {
      const key = normalizeBindKey(bind);
      if (bindSeen.has(key)) {
        issues.push({
          severity: 'error',
          code: 'bind-duplicate',
          message: `Bind ${formatBind(bind)} is already used by "${bindSeen.get(key)}". HAProxy cannot bind the same address and port twice.`,
          line: bind.line,
          section: section.name,
        });
      } else {
        bindSeen.set(key, section.name);
      }
    }
  }

  const serverCount = sections.reduce((sum, section) => sum + section.servers.length, 0);
  const bindCount = sections.reduce((sum, section) => sum + section.binds.length, 0);
  const aclCount = sections.reduce((sum, section) => sum + section.acls.length, 0);
  const ruleCount = sections.reduce((sum, section) => sum + section.rules.length, 0);

  return {
    text: source,
    lines,
    sections,
    global,
    defaults,
    frontends,
    backends,
    listens,
    issues,
    stats: {
      sections: sections.length,
      frontends: frontendOnly.length,
      backends: sections.filter((section) => section.type === 'backend').length,
      listens: listens.length,
      servers: serverCount,
      binds: bindCount,
      acls: aclCount,
      rules: ruleCount,
      lines: lines.length,
    },
  };
}

/** Return all proxy sections by name, including listen sections. */
export function findProxy(model, name) {
  return model.sections.find(
    (section) => ['frontend', 'backend', 'listen'].includes(section.type) && section.name === name,
  ) || null;
}

export function findBackend(model, name) {
  return model.sections.find(
    (section) => ['backend', 'listen'].includes(section.type) && section.name === name,
  ) || null;
}

export function findFrontend(model, name) {
  return model.sections.find(
    (section) => ['frontend', 'listen'].includes(section.type) && section.name === name,
  ) || null;
}

/** Find a bind whose listen address points at the given loopback server. */
export function findFrontendByServerTarget(model, server) {
  if (!server || !isLoopbackHost(server.host) || !server.port) return null;
  return model.frontends.find((frontend) =>
    frontend.binds.some((bind) => bind.port === server.port && isLoopbackHost(bind.host)),
  ) || null;
}

export function findItems(section, keyword) {
  return section ? section.items.filter((item) => item.keyword === keyword) : [];
}

export function firstItem(section, keyword) {
  return section ? section.items.find((item) => item.keyword === keyword) || null : null;
}

export function hasDirective(section, keyword, predicate = null) {
  if (!section) return false;
  return section.items.some((item) => item.keyword === keyword && (!predicate || predicate(item)));
}

export function hasOption(section, option) {
  return hasDirective(section, 'option', (item) => item.value === option) ||
    hasDirective(section, 'no option', (item) => item.value === option);
}

export function getOption(section, option) {
  return firstItem(section, 'option') && section.items.some(
    (item) => item.keyword === 'option' && item.value === option,
  );
}

export function directiveNames(section) {
  return dedupe((section?.items || []).map((item) => item.keyword));
}

export function getTimeout(section, name) {
  if (!section) return null;
  return section.items.find((item) => item.keyword === 'timeout' && item.timeoutName === name) || null;
}

/** Effective timeout: proxy value, then the first defaults section. */
export function effectiveTimeout(model, section, name) {
  return getTimeout(section, name) ||
    getTimeout(model.defaults[0], name) ||
    null;
}

export function timeoutToMs(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return numeric * factors[unit];
}

export function isIpv4(value) {
  if (!IPV4.test(value || '')) return false;
  return value.split('.').every((part) => Number(part) <= 255);
}

export { normalizeBindKey, isWildcardHost };
