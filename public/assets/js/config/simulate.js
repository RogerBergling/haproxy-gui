/**
 * Browser-side request simulator.
 *
 * It follows HAProxy's main routing order for the subset of the language that
 * can be evaluated without a live process: entry frontend, request-level
 * verdicts, use_backend/default_backend, backend verdicts, server selection and
 * loopback TLS hand-offs (TLS passthrough into an internal terminating
 * frontend).
 *
 * Unsupported ACLs are reported and conservatively treated as not matching.
 * This is an educational simulation, not a packet-level HAProxy emulator.
 */

import {
  findBackend,
  findFrontendByServerTarget,
  isLoopbackHost,
  parseConfig,
  tokenize,
} from './parser.js';

const MAX_HOPS = 6;

function splitConditionTokens(tokens) {
  if (!tokens || tokens.length === 0) return [[]];
  const groups = [[]];
  let index = 0;
  let negateNext = false;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token === '||' || token === 'or') {
      groups.push([]);
      index += 1;
      continue;
    }
    if (token === 'and') {
      index += 1;
      continue;
    }

    if (token === '!') {
      negateNext = true;
      index += 1;
      continue;
    }

    if (token === '{') {
      const inner = [];
      let depth = 1;
      index += 1;
      while (index < tokens.length && depth > 0) {
        if (tokens[index] === '{') depth += 1;
        if (tokens[index] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        inner.push(tokens[index]);
        index += 1;
      }
      index += 1;
      groups[groups.length - 1].push({ type: 'inline', tokens: inner, negate: negateNext });
      negateNext = false;
      continue;
    }

    const negate = negateNext || token.startsWith('!');
    groups[groups.length - 1].push({
      type: 'named',
      name: token.replace(/^!/, ''),
      negate,
    });
    negateNext = false;
    index += 1;
  }

  return groups.filter((group, groupIndex) => group.length > 0 || groupIndex === 0);
}

function extractMatcher(args) {
  let insensitive = false;
  let method = null;
  const values = [];
  let unsupported = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-i') {
      insensitive = true;
      continue;
    }
    if (token === '-m') {
      method = args[index + 1] || null;
      index += 1;
      continue;
    }
    if (token === '-f') {
      unsupported = 'file-based ACL (-f) is not simulated';
      index += 1;
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      // Unknown flags such as -n are best treated as no-match rather than
      // silently changing semantics.
      unsupported = `unsupported ACL flag ${token}`;
      continue;
    }
    values.push(token);
  }

  return { insensitive, method, values, unsupported };
}

function cleanHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

function hostWithoutPort(host) {
  let value = cleanHost(host);
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close > 0) value = value.slice(0, close + 1);
  } else if ((value.match(/:/g) || []).length === 1) {
    value = value.replace(/:\d+$/, '');
  }
  return value;
}

function matchValue(actual, value, method, insensitive) {
  if (actual === undefined || actual === null) return false;
  let left = String(actual);
  let right = String(value);
  if (insensitive) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  switch (method) {
    case 'beg':
      return left.startsWith(right);
    case 'end':
      return left.endsWith(right);
    case 'sub':
      return left.includes(right);
    case 'str':
      return left === right;
    case 'reg':
      try {
        return new RegExp(right, insensitive ? 'i' : '').test(String(actual));
      } catch {
        return false;
      }
    case 'ip':
      return ipMatches(actual, right);
    case 'int':
    case 'str':
    default:
      return left === right;
  }
}

function ipv4ToNumber(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const numeric = Number(part);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) return null;
    result = (result << 8) | numeric;
  }
  return result >>> 0;
}

function ipMatches(actual, pattern) {
  const [address, prefixText] = String(pattern).split('/');
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  const left = ipv4ToNumber(actual);
  const right = ipv4ToNumber(address);
  if (left === null || right === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return String(actual) === String(address);
  }
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (left & mask) === (right & mask);
}

function criterionValue(criterion, request, context) {
  if (criterion === 'hdr(host)' || criterion === 'req.hdr(host)' || criterion === 'host') {
    return hostWithoutPort(request.host);
  }
  const header = criterion.match(/^hdr\(([^)]+)\)$/);
  if (header) {
    const name = header[1].toLowerCase();
    if (name === 'host') return hostWithoutPort(request.host);
    const headers = request.headers || {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return value;
    }
    return undefined;
  }
  if (criterion === 'req_ssl_sni' || criterion === 'ssl_fc_sni' || criterion === 'req.ssl_sni') {
    return request.sni;
  }
  if (criterion === 'path' || criterion === 'url') return request.path;
  if (criterion === 'path_beg') return request.path;
  if (criterion === 'path_end') return request.path;
  if (criterion === 'method') return request.method;
  if (criterion === 'src') return request.source;
  if (criterion === 'dst_port') return String(context.port || request.port);
  if (criterion === 'ssl_fc') return context.tlsTerminated ? 'true' : 'false';
  if (criterion === 'ssl_fc_has_crt') return request.clientCert ? 'true' : 'false';
  return undefined;
}

function evaluateInline(tokens, request, context, section) {
  if (tokens.length === 0) return { matched: false, detail: 'empty inline condition' };
  const criterion = tokens[0];
  let args = tokens.slice(1);

  if (criterion === 'ssl_fc') {
    const matched = context.tlsTerminated;
    return {
      matched,
      detail: `ssl_fc is ${matched} (TLS ${matched ? 'terminated here' : 'not terminated at this layer'})`,
      unsupported: false,
    };
  }

  if (criterion === 'ssl_fc_has_crt') {
    const matched = Boolean(request.clientCert);
    return {
      matched,
      detail: `ssl_fc_has_crt is ${matched}`,
      unsupported: false,
    };
  }

  let method = extractMatcher(args).method;
  if (criterion === 'path_beg') method = 'beg';
  if (criterion === 'path_end') method = 'end';
  if (criterion === 'url_beg') method = 'beg';
  if (criterion === 'url_end') method = 'end';
  const matcher = extractMatcher(args);
  const value = criterionValue(criterion, request, context);

  if (value === undefined) {
    return {
      matched: false,
      detail: `unsupported criterion "${criterion}" (treated as no match)`,
      unsupported: true,
    };
  }

  if (matcher.unsupported) {
    return {
      matched: false,
      detail: `${criterion}: ${matcher.unsupported} (treated as no match)`,
      unsupported: true,
    };
  }

  if (matcher.values.length === 0) {
    return {
      matched: false,
      detail: `${criterion} has no match value`,
      unsupported: false,
    };
  }

  const matches = matcher.values.map((candidate) => {
    const trimmed = String(candidate).trim();
    if (method === 'ip' || (criterion === 'src' && trimmed.includes('/'))) {
      return ipMatches(value, trimmed);
    }
    return matchValue(value, trimmed, method, matcher.insensitive);
  });

  const matched = matches.some(Boolean);
  const valuesText = matcher.values.join(', ');
  return {
    matched,
    detail: `${criterion} ${matcher.method ? `-m ${matcher.method} ` : ''}${matcher.insensitive ? '-i ' : ''}${valuesText}: ${matched ? 'match' : 'no match'} (value: ${value || '∅'})`,
    unsupported: false,
  };
}

function evaluateNamed(name, request, context, section) {
  if (!section) {
    return { matched: false, detail: `named ACL "${name}" has no section scope`, unsupported: true };
  }
  const definitions = section.acls.filter((acl) => acl.name === name);
  if (definitions.length === 0) {
    return {
      matched: false,
      detail: `named ACL "${name}" is not defined in this proxy`,
      unsupported: false,
      missing: true,
    };
  }

  const results = definitions.map((acl) => {
    const tokens = [acl.criterion, ...acl.args];
    const result = evaluateInline(tokens, request, context, section);
    return { ...result, text: `${acl.criterion} ${acl.args.join(' ')}`.trim() };
  });
  const matched = results.some((result) => result.matched);
  return {
    matched,
    detail: `${name}: ${results.map((result) => `${result.text} → ${result.matched ? 'match' : 'no match'}`).join(' OR ')}`,
    unsupported: results.some((result) => result.unsupported),
  };
}

export function evaluateCondition(tokens, negate, request, context, section) {
  if (!tokens || tokens.length === 0) return { matched: true, detail: 'unconditional', unsupported: false };
  const groups = splitConditionTokens(tokens);
  const groupResults = [];

  for (const group of groups) {
    const termResults = [];
    for (const term of group) {
      let result;
      if (term.type === 'inline') {
        result = evaluateInline(term.tokens, request, context, section);
      } else {
        result = evaluateNamed(term.name, request, context, section);
      }
      termResults.push({ ...result, negated: term.negate });
    }
    const groupMatched = termResults.every((result) =>
      result.negated ? !result.matched : result.matched,
    );
    groupResults.push({ matched: groupMatched, terms: termResults });
  }

  const matched = groupResults.some((result) => result.matched);
  const final = negate ? !matched : matched;
  return {
    matched: final,
    detail: groupResults
      .map((group) => group.terms.map((term) => `${term.negated ? '!' : ''}${term.detail}`).join(' AND '))
      .join(' OR '),
    unsupported: groupResults.some((group) => group.terms.some((term) => term.unsupported)),
  };
}

export function formatCondition(tokens, negate = false) {
  if (!tokens || tokens.length === 0) return 'unconditional';
  let text = '';
  for (const token of tokens) {
    if (token === '{' || token === '}') text += ` ${token} `;
    else if (token === '||' || token === 'or') text += ' OR ';
    else text += `${text && !text.endsWith(' ') ? ' ' : ''}${token}`;
  }
  return `${negate ? 'unless ' : 'if '}${text.replace(/\s+/g, ' ').trim()}`;
}

function normalizeRequest(input = {}) {
  const scheme = ['http', 'https', 'tcp'].includes(input.scheme) ? input.scheme : 'https';
  let host = cleanHost(input.host || '');
  let port = input.port ? String(input.port) : null;
  if (!port && host.includes(':')) {
    const match = host.match(/^(.*?):(\d+)$/);
    if (match && !match[1].endsWith(']')) {
      host = match[1];
      port = match[2];
    }
  }
  port = port || (scheme === 'http' ? '80' : '443');
  const sni = cleanHost(input.sni || host);
  return {
    scheme,
    host,
    port,
    sni,
    path: input.path || (scheme === 'tcp' ? '' : '/'),
    method: (input.method || 'GET').toUpperCase(),
    source: input.source || '203.0.113.10',
    clientCert: Boolean(input.clientCert),
    headers: input.headers || {},
    requestIndex: Number.isInteger(input.requestIndex) ? input.requestIndex : 0,
    downServers: new Set(input.downServers || []),
  };
}

function step(kind, title, detail, extra = {}) {
  return { kind, title, detail, level: extra.level || 'info', ...extra };
}

function bindMatchesPort(frontend, port) {
  return frontend.binds.some((bind) => String(bind.port || '') === String(port));
}

function candidateFrontends(model, request) {
  return model.frontends
    .filter((frontend) => frontend.binds.some((bind) => String(bind.port || '') === String(request.port)))
    .filter((frontend) => {
      const binds = frontend.binds.filter((bind) => String(bind.port || '') === String(request.port));
      return binds.some((bind) => !isLoopbackHost(bind.host));
    });
}

function chooseEntryFrontend(model, request, steps, warnings) {
  let candidates = candidateFrontends(model, request).filter((frontend) => !frontend.binds.every((bind) => isLoopbackHost(bind.host)));
  if (request.scheme === 'tcp') {
    candidates = candidates.filter((frontend) => frontend.effectiveMode === 'tcp');
  } else if (request.scheme === 'http') {
    candidates = candidates.filter((frontend) => frontend.effectiveMode === 'http');
  } else {
    candidates = candidates.filter((frontend) =>
      frontend.effectiveMode === 'tcp' ||
      frontend.binds.some((bind) => String(bind.port || '') === String(request.port) && bind.ssl),
    );
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    warnings.push(
      `Multiple frontends listen on port ${request.port}: ${candidates.map((frontend) => frontend.name).join(', ')}. The simulation picked ${candidates[0].name}.`,
    );
  }

  const frontend = candidates[0];
  const matchingBind = frontend.binds.find((bind) => String(bind.port || '') === String(request.port));
  return { frontend, bind: matchingBind };
}

function matchingInternalFrontend(model, server) {
  if (!server || !isLoopbackHost(server.host) || !server.port) return null;
  return findFrontendByServerTarget(model, server);
}

function chooseServer(backend, request, steps) {
  const allServers = backend.servers || [];
  const key = (server) => `${backend.name}/${server.name}`;
  const down = (server) =>
    request.downServers.has(key(server)) ||
    request.downServers.has(server.name) ||
    request.downServers.has(`${server.name}@${backend.name}`) ||
    server.flags.has('disabled');

  const available = allServers.filter((server) => !down(server));
  const primary = available.filter((server) => !server.flags.has('backup'));
  const backups = available.filter((server) => server.flags.has('backup'));
  const eligible = primary.length > 0 ? primary : backups;
  const unavailable = allServers.filter((server) => down(server));

  if (allServers.length === 0) {
    steps.push(step('server', 'No servers in backend', `${backend.name} has no server lines, so no upstream can be selected.`, { level: 'fail', line: backend.line }));
    return { server: null, eligible, unavailable };
  }

  if (eligible.length === 0) {
    steps.push(
      step(
        'server',
        'No healthy server available',
        `${backend.name} has ${allServers.length} server${allServers.length === 1 ? '' : 's'}, but all are marked down in this simulation.`,
        { level: 'fail', line: backend.line },
      ),
    );
    return { server: null, eligible, unavailable };
  }

  // HAProxy 3.3 changed the default balancing algorithm from roundrobin to
  // random. The Workbench targets 3.x guidance, so the implicit default is
  // random unless the config sets an explicit algorithm.
  const algorithm = backend.balance || 'random';
  let index = 0;
  if (algorithm === 'roundrobin' || algorithm === 'static-rr') {
    index = Math.abs(request.requestIndex) % eligible.length;
  } else if (algorithm === 'source' || algorithm === 'uri' || algorithm === 'hdr') {
    let hash = 0;
    for (const char of request.source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    index = hash % eligible.length;
  } else if (algorithm === 'random' || algorithm === 'random(2)') {
    let hash = request.requestIndex + request.source.length;
    for (const char of request.host) hash = (hash * 17 + char.charCodeAt(0)) >>> 0;
    index = hash % eligible.length;
  } else if (algorithm === 'leastconn') {
    steps.push(
      step('server', 'Least connections', 'Least-connection chooses the server with the fewest active connections. With no live connection counters, the simulation picks the first available server.', {
        level: 'info',
      }),
    );
  }

  const server = eligible[index] || eligible[0];
  steps.push(
    step(
      'server',
      `Server selected: ${server.name}`,
      `${backend.name} uses ${algorithm}. ${eligible.map((entry) => entry.name).join(', ')} ${eligible.length === 1 ? 'is' : 'are'} eligible.${unavailable.length ? ` Down in simulation: ${unavailable.map((entry) => entry.name).join(', ')}.` : ''}`,
      { level: 'ok', line: server.line, server: server.name, backend: backend.name },
    ),
  );
  return { server, eligible, unavailable };
}

function terminalAction(action, request, context, section, steps) {
  if (action.keyword === 'http-request' && ['return', 'deny', 'redirect'].includes(action.action)) {
    if (!request.conditionResult) {
      const result = evaluateCondition(action.condition, action.negate, request, context, section);
      request.conditionResult = result;
      steps.push(
        step(
          'condition',
          `${action.keyword} ${action.action}`,
          `${formatCondition(action.condition, action.negate)} → ${result.matched ? 'match' : 'no match'}: ${result.detail}`,
          { level: result.matched ? 'ok' : 'info', line: action.line },
        ),
      );
      if (!result.matched) return null;
    }
    if (action.action === 'redirect') {
      return { code: action.status || 302, outcome: 'response', detail: `${action.keyword} ${action.action}` };
    }
    if (action.action === 'deny') {
      return { code: action.status || 403, outcome: 'response', detail: `${action.keyword} deny` };
    }
    return {
      code: action.status || 200,
      outcome: 'response',
      detail: action.body ? `${action.keyword} return ${action.status || 200}: ${action.body}` : `${action.keyword} return ${action.status || 200}`,
    };
  }
  return null;
}

function evaluateTcpVerdicts(section, request, context, steps) {
  for (const action of section.actions) {
    if (action.keyword !== 'tcp-request') continue;
    if (!['content', 'connection', 'session'].includes(action.action)) continue;
    if (!action.actionArgs.includes('reject') && !action.actionArgs.includes('silent-drop')) continue;
    const result = evaluateCondition(action.condition, action.negate, request, context, section);
    steps.push(
      step(
        'condition',
        `tcp-request ${action.action} ${action.actionArgs.join(' ')}`,
        `${formatCondition(action.condition, action.negate)} → ${result.matched ? 'match' : 'no match'}: ${result.detail}`,
        { level: result.matched ? 'fail' : 'info', line: action.line },
      ),
    );
    if (result.matched) return { rejected: true, unsupported: result.unsupported };
  }
  return { rejected: false };
}

function evaluateRequestRules(section, request, context, steps) {
  for (const action of section.actions) {
    if (action.keyword !== 'http-request') continue;
    if (!['return', 'deny', 'redirect'].includes(action.action)) continue;
    const result = evaluateCondition(action.condition, action.negate, request, context, section);
    steps.push(
      step(
        'condition',
        `http-request ${action.action}`,
        `${formatCondition(action.condition, action.negate)} → ${result.matched ? 'match' : 'no match'}: ${result.detail}`,
        { level: result.matched ? 'ok' : 'info', line: action.line },
      ),
    );
    if (result.matched) {
      if (action.action === 'redirect') {
        return { code: action.status || 302, outcome: 'response', detail: 'http-request redirect' };
      }
      if (action.action === 'deny') {
        return { code: action.status || 403, outcome: 'response', detail: 'http-request deny' };
      }
      return {
        code: action.status || 200,
        outcome: 'response',
        detail: action.body || `http-request return ${action.status || 200}`,
      };
    }
  }
  return null;
}

function backendResult(model, backend, request, context, steps, warnings, visited) {
  steps.push(
    step(
      'backend',
      `Backend ${backend.name}`,
      `${backend.effectiveMode.toUpperCase()} mode, balance ${backend.balance || 'roundrobin'}, ${backend.servers.length} configured server${backend.servers.length === 1 ? '' : 's'}.`,
      { level: 'ok', backend: backend.name, line: backend.line },
    ),
  );

  const tcpVerdict = evaluateTcpVerdicts(backend, request, context, steps);
  if (tcpVerdict.rejected) {
    return {
      code: context.httpVisible ? 503 : 'reset',
      outcome: 'reset',
      frontend: context.frontend,
      backend: backend.name,
      server: null,
      summary: `Connection rejected by ${backend.name}.`,
    };
  }

  const requestAction = evaluateRequestRules(backend, request, context, steps);
  if (requestAction) {
    return {
      ...requestAction,
      frontend: context.frontend,
      backend: backend.name,
      server: null,
      summary: `HAProxy returned ${requestAction.code} from ${backend.name}.`,
    };
  }

  const selection = chooseServer(backend, request, steps);
  if (!selection.server) {
    return {
      code: context.httpVisible ? 503 : 'failed',
      outcome: context.httpVisible ? 'response' : 'failed',
      frontend: context.frontend,
      backend: backend.name,
      server: null,
      summary: `No server available in ${backend.name}${context.httpVisible ? ' → 503' : ' → connection failure'}.`,
    };
  }

  const internal = matchingInternalFrontend(model, selection.server);
  if (internal && backend.effectiveMode === 'tcp') {
    if (visited.has(internal.name)) {
      warnings.push(`Loop detected: ${backend.name} hands back to ${internal.name}, which was already visited.`);
      return {
        code: context.httpVisible ? 502 : 'failed',
        outcome: 'failed',
        frontend: context.frontend,
        backend: backend.name,
        server: selection.server.name,
        summary: `TLS hand-off loop detected at ${internal.name}.`,
      };
    }
    steps.push(
      step(
        'handoff',
        `Loopback TLS hand-off → ${internal.name}`,
        `${backend.name} server ${selection.server.name} (${selection.server.address}) points at ${internal.name}, which listens on this host:port. The encrypted stream is handed off to that frontend for termination.`,
        { level: 'ok', line: selection.server.line, frontend: internal.name, backend: backend.name, server: selection.server.name },
      ),
    );
    return routeFrontend(model, internal, request, {
      ...context,
      tlsTerminated: request.scheme === 'https',
      httpVisible: internal.effectiveMode === 'http' || context.httpVisible,
      httpMode: internal.effectiveMode === 'http',
      frontend: internal.name,
      port: selection.server.port || context.port,
      internal: true,
      hop: context.hop + 1,
    }, steps, warnings, visited);
  }

  const summary = context.httpVisible
    ? `Request routed through ${context.frontend} → ${backend.name} → ${selection.server.name} (${selection.server.address}).`
    : `TCP stream routed through ${context.frontend} → ${backend.name} → ${selection.server.name} (${selection.server.address}).`;

  if (context.httpVisible) {
    return {
      code: 200,
      outcome: 'response',
      frontend: context.frontend,
      backend: backend.name,
      server: selection.server,
      summary,
    };
  }
  return {
    code: 'tunnel',
    outcome: 'tunnel',
    frontend: context.frontend,
    backend: backend.name,
    server: selection.server,
    summary,
  };
}

function routeFrontend(model, frontend, request, context, steps, warnings, visited) {
  if (context.hop > MAX_HOPS) {
    return {
      code: 508,
      outcome: 'failed',
      frontend: frontend.name,
      backend: null,
      server: null,
      summary: 'Too many internal hops; possible routing loop.',
    };
  }
  visited.add(frontend.name);

  const bind = frontend.binds.find((entry) =>
    (entry.port && context.port ? String(entry.port) === String(context.port) : true) &&
    (entry.ssl === context.tlsTerminated || !context.internal),
  ) || frontend.binds[0] || null;

  const tlsState = context.internal
    ? context.tlsTerminated ? 'TLS terminated at this internal frontend' : 'plaintext loopback hop'
    : context.tlsTerminated ? 'TLS terminated by HAProxy' : frontend.effectiveMode === 'tcp' ? 'TLS left encrypted (passthrough)' : 'cleartext';

  steps.push(
    step(
      'entry',
      `Frontend ${frontend.name}`,
      `${bind ? `bind ${bind.raw}; ` : ''}${frontend.effectiveMode.toUpperCase()} mode; ${tlsState}.${context.internal ? ' Internal hop.' : ''}`,
      { level: 'ok', line: frontend.line, frontend: frontend.name },
    ),
  );

  if (frontend.effectiveMode === 'http' && context.tlsTerminated && !bind?.ssl && !context.internal) {
    warnings.push('The selected frontend is in HTTP mode but the matching bind does not have `ssl`; the simulated request would not be accepted as HTTPS on this socket.');
  }

  const localContext = {
    ...context,
    frontend: frontend.name,
    httpMode: frontend.effectiveMode === 'http',
    httpVisible: frontend.effectiveMode === 'http' || context.httpVisible,
    tlsTerminated: bind?.ssl ? true : context.tlsTerminated,
  };

  if (localContext.httpMode) {
    const requestResult = evaluateRequestRules(frontend, request, localContext, steps);
    if (requestResult) {
      return {
        ...requestResult,
        frontend: frontend.name,
        backend: null,
        server: null,
        summary: `${frontend.name} returned ${requestResult.code} before a backend was selected.`,
      };
    }
  }

  const tcpVerdict = evaluateTcpVerdicts(frontend, request, localContext, steps);
  if (tcpVerdict.rejected) {
    return {
      code: 'reset',
      outcome: 'reset',
      frontend: frontend.name,
      backend: null,
      server: null,
      summary: `${frontend.name} rejected the connection.`,
    };
  }

  let backendName = null;
  let matchedRule = null;
  for (const rule of frontend.rules) {
    const condition = evaluateCondition(rule.condition, rule.negate, request, localContext, frontend);
    steps.push(
      step(
        'rule',
        `use_backend ${rule.backend}`,
        `${formatCondition(rule.condition, rule.negate)} → ${condition.matched ? 'match' : 'no match'}: ${condition.detail}`,
        { level: condition.matched ? 'ok' : 'info', line: rule.line, backend: rule.backend },
      ),
    );
    if (condition.unsupported) {
      warnings.push(
        `ACL in use_backend ${rule.backend} contains an unsupported expression; it was treated as no match. Review the highlighted line manually.`,
      );
    }
    if (condition.matched) {
      backendName = rule.backend;
      matchedRule = rule;
      break;
    }
  }

  if (!backendName) backendName = frontend.defaultBackend;
  // A listen section is also its own backend. When it has servers and no
  // explicit routing fallback, unmatched traffic uses that pool directly.
  if (!backendName && frontend.type === 'listen' && frontend.servers.length > 0) {
    backendName = frontend.name;
  }
  if (!backendName) {
    return {
      code: localContext.httpVisible ? 503 : 'failed',
      outcome: localContext.httpVisible ? 'response' : 'failed',
      frontend: frontend.name,
      backend: null,
      server: null,
      summary: `${frontend.name} matched no backend and has no default_backend${localContext.httpVisible ? ' → 503' : ' → connection failure'}.`,
    };
  }

  const backend = findBackend(model, backendName);
  if (!backend) {
    return {
      code: 500,
      outcome: 'failed',
      frontend: frontend.name,
      backend: backendName,
      server: null,
      summary: `Backend "${backendName}" does not exist.`,
    };
  }

  steps.push(
    step(
      'route',
      `Selected backend ${backend.name}`,
      matchedRule
        ? 'Selected by the first matching use_backend rule.'
        : frontend.type === 'listen' && frontend.name === backend.name
          ? 'No use_backend rule matched; using the listen section’s own server pool.'
          : 'No use_backend rule matched; using default_backend.',
      { level: 'ok', backend: backend.name, line: matchedRule?.line || frontend.line },
    ),
  );

  return backendResult(model, backend, request, localContext, steps, warnings, visited);
}

/**
 * Simulate one request through a parsed configuration.
 *
 * @param {object} model
 * @param {object} input
 * @returns {object}
 */
export function simulateRequest(model, input = {}) {
  const request = normalizeRequest(input);
  const steps = [];
  const warnings = [];
  const context = {
    frontend: null,
    backend: null,
    tlsTerminated: false,
    httpVisible: false,
    httpMode: false,
    port: request.port,
    internal: false,
    hop: 0,
  };

  if (!request.host && request.scheme !== 'tcp') {
    warnings.push('No Host header was supplied. Host-based routing will not match.');
  }
  if (!request.sni && request.scheme === 'https') {
    warnings.push('No SNI was supplied. SNI-based routing will not match.');
  }

  const entry = chooseEntryFrontend(model, request, steps, warnings);
  if (!entry) {
    steps.push(
      step(
        'result',
        'No listener',
        `No non-loopback frontend is bound to port ${request.port} in ${request.scheme.toUpperCase()} mode. HAProxy would refuse the connection.`,
        { level: 'fail' },
      ),
    );
    return {
      ok: false,
      code: 'refused',
      outcome: 'refused',
      httpStatus: null,
      frontend: null,
      backend: null,
      server: null,
      request,
      steps,
      warnings,
      summary: `Connection refused: no listener on port ${request.port}.`,
    };
  }

  const isSslBind = entry.bind?.ssl;
  context.tlsTerminated = Boolean(isSslBind);
  context.httpVisible = entry.frontend.effectiveMode === 'http';
  context.internal = false;
  context.port = request.port;

  const result = routeFrontend(
    model,
    entry.frontend,
    request,
    context,
    steps,
    warnings,
    new Set(),
  );

  const normalized = {
    ...result,
    ok: (result.outcome === 'response' && Number(result.code) < 500) || result.outcome === 'tunnel',
    httpStatus: typeof result.code === 'number' ? result.code : null,
    request,
    steps,
    warnings: [...new Set(warnings)],
  };

  steps.push(
    step(
      'result',
      result.summary,
      result.outcome === 'tunnel'
        ? 'The TCP session is established and HAProxy stops interpreting the stream.'
        : result.outcome === 'reset'
          ? 'The connection is closed without an HTTP response.'
          : `Simulated HTTP status: ${result.code}.`,
      {
        level: result.outcome === 'failed' || result.outcome === 'reset' || Number(result.code) >= 500 ? 'fail' : 'ok',
        backend: result.backend,
        server: typeof result.server === 'string' ? result.server : result.server?.name,
      },
    ),
  );

  return normalized;
}

export function simulateConfig(text, request, options = {}) {
  const model = options.model || parseConfig(text);
  return simulateRequest(model, request);
}

/** Quick structural detection used by the wizard and topology views. */
export function detectArchitecture(model) {
  const entryFrontends = model.frontends.filter((frontend) =>
    frontend.binds.some((bind) => !isLoopbackHost(bind.host)),
  );
  const internalFrontends = model.frontends.filter((frontend) =>
    frontend.binds.length > 0 && frontend.binds.every((bind) => isLoopbackHost(bind.host)),
  );
  const tlsPassthrough = entryFrontends.filter((frontend) =>
    frontend.effectiveMode === 'tcp' &&
    (frontend.binds.some((bind) => !bind.ssl) || frontend.rules.some((rule) => rule.condition?.some((token) => token.includes('ssl_sni')))),
  );
  const tlsTermination = entryFrontends.filter((frontend) =>
    frontend.effectiveMode === 'http' && frontend.binds.some((bind) => bind.ssl),
  );
  const plainHttp = entryFrontends.filter((frontend) =>
    frontend.effectiveMode === 'http' && frontend.binds.some((bind) => !bind.ssl),
  );
  return { entryFrontends, internalFrontends, tlsPassthrough, tlsTermination, plainHttp };
}

export { normalizeRequest, chooseServer, routeFrontend, evaluateInline };
