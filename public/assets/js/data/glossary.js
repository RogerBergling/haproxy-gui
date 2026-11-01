/**
 * Glossary for HAProxy administrators. Written for quick scanning and deep
 * links from the analyzer (aliases are searchable too).
 */

export const GLOSSARY_CATEGORIES = [
  'Core concepts',
  'Routing',
  'TLS & certificates',
  'Health & balancing',
  'Timeouts & failures',
  'Performance',
  'Operations',
  'Versions',
];

export const GLOSSARY = [
  {
    term: 'Frontend',
    category: 'Core concepts',
    aliases: ['fe'],
    short: 'The client-facing listener.',
    detail:
      'A frontend owns one or more bind sockets, applies mode-specific inspection and chooses a backend. In TCP mode it can only see transport/TLS handshake data such as SNI; in HTTP mode it can inspect requests and headers.',
  },
  {
    term: 'Backend',
    category: 'Core concepts',
    aliases: ['bk', 'server pool'],
    short: 'The upstream pool selected for a request.',
    detail:
      'A backend contains servers, a balancing algorithm, health-check policy and optional backend-level actions. A backend with no servers will produce 503 (HTTP) or connection failures unless it has an explicit return/reject rule.',
  },
  {
    term: 'Listen section',
    category: 'Core concepts',
    aliases: ['listen'],
    short: 'A combined frontend and backend.',
    detail:
      'listen lets one section bind a socket and define servers directly. It is common for simple TCP forwarding and stats pages. Complex routing is usually clearer with separate frontends and backends.',
  },
  {
    term: 'Global section',
    category: 'Core concepts',
    aliases: ['global'],
    short: 'Process-wide settings and defaults.',
    detail:
      'The global section holds privileges, logging, TLS defaults, process limits, the runtime socket and certificate stores. Its settings apply to the entire HAProxy process.',
  },
  {
    term: 'Defaults section',
    category: 'Core concepts',
    aliases: ['defaults'],
    short: 'Inherited settings for later proxies.',
    detail:
      'Defaults supplies mode, timeouts, logging and options to following sections. It is the natural place to make failure behaviour explicit instead of relying on built-ins.',
  },
  {
    term: 'Proxy',
    category: 'Core concepts',
    aliases: ['frontend backend listen'],
    short: 'A frontend, backend or listen object.',
    detail:
      'HAProxy documentation uses “proxy” for any traffic-handling object. Proxy names appear in logs, metrics and the Runtime API. Duplicate names across families are deprecated in 3.1 and rejected in 3.3+.',
  },
  {
    term: 'Bind',
    category: 'Core concepts',
    aliases: ['listener', 'bind line'],
    short: 'An address and port HAProxy listens on.',
    detail:
      'A bind can include TLS options (`ssl`, certificate selection, ALPN, client-certificate verification) and socket tuning. The presence or absence of `ssl` decides whether HAProxy terminates TLS or forwards encrypted bytes.',
  },
  {
    term: 'Mode HTTP / TCP',
    category: 'Core concepts',
    aliases: ['mode', 'layer 7', 'layer 4'],
    short: 'How much of the traffic HAProxy interprets.',
    detail:
      'HTTP mode parses requests, responses, headers, cookies and paths. TCP mode forwards an opaque stream. TLS passthrough must be TCP; HTTP health checks and request/response rules require HTTP mode.',
  },
  {
    term: 'SNI',
    category: 'TLS & certificates',
    aliases: ['server name indication'],
    short: 'The hostname a TLS client requests during the handshake.',
    detail:
      'SNI is sent in the ClientHello before encryption is established, so a TCP-mode frontend can route on it without decrypting traffic. SNI is not the same as the HTTP Host header and can be absent in non-browser clients.',
  },
  {
    term: 'TLS termination',
    category: 'TLS & certificates',
    aliases: ['ssl termination', 'offloading'],
    short: 'HAProxy decrypts TLS and forwards plaintext or re-encrypted traffic.',
    detail:
      'The bind uses `ssl crt ...`. HAProxy can then inspect HTTP and add headers. Termination requires certificate/private-key files, certificate selection for multiple hosts and a plan for upstream encryption if the network is not trusted.',
  },
  {
    term: 'TLS passthrough',
    category: 'TLS & certificates',
    aliases: ['ssl passthrough', 'sniffing'],
    short: 'HAProxy forwards encrypted bytes without decrypting them.',
    detail:
      'A TCP-mode bind without `ssl` leaves TLS intact. HAProxy can still inspect the ClientHello for SNI and route by it, but it cannot see Host, path or cookies. Health checks can only be transport-level or protocol-aware scripts.',
  },
  {
    term: 'TLS re-encryption',
    category: 'TLS & certificates',
    aliases: ['backend ssl', 'upstream tls'],
    short: 'HAProxy terminates client TLS and opens a new TLS connection upstream.',
    detail:
      'Use `server ... ssl` (plus verification) in the backend. This protects traffic between the proxy and application but adds handshake cost. Do not combine it with a plaintext port assumption.',
  },
  {
    term: 'mTLS',
    category: 'TLS & certificates',
    aliases: ['mutual tls', 'client certificates', 'client cert'],
    short: 'Both sides present certificates.',
    detail:
      'On a bind, `verify required ca-file ...` validates a client certificate. Forwarding `ssl_c_*` fields without verification does not authenticate anyone: an untrusted layer or a missing certificate can produce empty or spoofed values.',
  },
  {
    term: 'SNI certificate selection',
    category: 'TLS & certificates',
    aliases: ['crt-list', 'sni cert'],
    short: 'Choosing a certificate by requested hostname.',
    detail:
      'A single `crt` is used for the bind. A `crt-list` can hold multiple certificates and select the one matching SNI. A wildcard certificate covers one label (for example `*.example.com`), not apex or multi-level names.',
  },
  {
    term: 'ALPN',
    category: 'TLS & certificates',
    aliases: ['application layer protocol negotiation', 'h2'],
    short: 'TLS extension that negotiates HTTP/2 or HTTP/1.1.',
    detail:
      'HAProxy advertises supported protocols with `alpn`. Forcing `http/1.1` can be deliberate (for example to avoid HTTP/2 connection coalescing between unrelated hosts) but gives up multiplexing benefits.',
  },
  {
    term: 'HSTS',
    category: 'TLS & certificates',
    aliases: ['strict transport security'],
    short: 'A response policy that tells browsers to use HTTPS for a host.',
    detail:
      'HSTS is set by the application or HAProxy via `http-response set-header Strict-Transport-Security`. It only applies after a successful HTTPS response and commits clients for the max-age. Start conservatively and never enable it for a host that still needs HTTP.',
  },
  {
    term: 'Cipher suite',
    category: 'TLS & certificates',
    aliases: ['ciphers', 'ciphersuites'],
    short: 'The algorithms used to protect a TLS session.',
    detail:
      'TLS 1.3 suites are configured separately from TLS 1.2 and earlier. Prefer AEAD and forward-secret suites. Weak options include RC4, 3DES, export ciphers and static RSA key exchange.',
  },
  {
    term: 'TLS ticket',
    category: 'TLS & certificates',
    aliases: ['session ticket', 'resumption'],
    short: 'A resumption token that can avoid a full TLS handshake.',
    detail:
      'Session tickets improve latency but can weaken forward secrecy if keys are static or shared for too long. `no-tls-tickets` is a simple hardening baseline; rotation is the alternative when resumption is required.',
  },
  {
    term: 'OCSP stapling',
    category: 'TLS & certificates',
    aliases: ['ocsp', 'certificate revocation'],
    short: 'Serving a certificate revocation status with the TLS handshake.',
    detail:
      'HAProxy can update and staple OCSP responses for certificates. It depends on the certificate having an OCSP responder and on network access. Failing revocation checks should be monitored, not silently ignored.',
  },
  {
    term: 'ACME',
    category: 'TLS & certificates',
    aliases: ['letsencrypt', 'certificate automation'],
    short: 'Automated certificate issuance and renewal.',
    detail:
      'ACME support in HAProxy is version- and build-dependent. Use staging endpoints for initial tests, monitor renewals and retain a rollback path. Automatic renewal is not the same as automatic deployment and reload.',
  },
  {
    term: 'ACL',
    category: 'Routing',
    aliases: ['access control list', 'condition'],
    short: 'A named or inline condition used for routing and policy.',
    detail:
      'ACLs can match headers, paths, SNI, source networks, TLS state, cookies and more. Named ACLs are scoped to one proxy; repeated definitions with the same name are ORed. use_backend evaluates rules in order and stops at the first match.',
  },
  {
    term: 'use_backend',
    category: 'Routing',
    aliases: ['routing rule'],
    short: 'Conditional backend selection.',
    detail:
      'Rules are evaluated top to bottom. Put exact/specific hostnames before wildcards. A matching rule chooses the backend immediately; there is no “continue evaluating” unless you structure the conditions that way.',
  },
  {
    term: 'default_backend',
    category: 'Routing',
    aliases: ['fallback backend'],
    short: 'The backend used when no rule matches.',
    detail:
      'If it is missing, unmatched HTTP requests return 503. A deliberate default backend can return 404, 421 or reject the connection, making the fallback visible and safe.',
  },
  {
    term: 'Host header',
    category: 'Routing',
    aliases: ['hdr(host)'],
    short: 'The HTTP authority used for virtual-host routing.',
    detail:
      'Only visible after TLS termination (or on plaintext HTTP). Clients can send arbitrary Host headers, so do not treat the Host value as authentication. Pair host routing with TLS certificate coverage and a deliberate unknown-host response.',
  },
  {
    term: 'Path routing',
    category: 'Routing',
    aliases: ['path_beg', 'path_end'],
    short: 'Routing by request URI path.',
    detail:
      'HTTP-only. Prefix routing with `path_beg` is common for APIs; exact matches avoid surprising prefixes. URL decoding and normalisation can differ from the application, so security-sensitive path rules need careful testing.',
  },
  {
    term: '421 Misdirected Request',
    category: 'Routing',
    aliases: ['misdirected'],
    short: 'HTTP status indicating the request reached the wrong virtual host.',
    detail:
      'Useful when a TLS connection or frontend receives a Host that belongs to another service. Returning 421 makes the mistake explicit instead of silently serving the wrong default backend.',
  },
  {
    term: 'X-Forwarded-For',
    category: 'Routing',
    aliases: ['xff', 'client ip'],
    short: 'Header carrying the original client address through a proxy.',
    detail:
      'Any client can send this header. A secure chain requires the edge to strip untrusted values and the application to trust the header only from HAProxy. `option forwardfor` appends the client address.',
  },
  {
    term: 'X-Forwarded-Proto',
    category: 'Routing',
    aliases: ['xfp', 'forwarded proto'],
    short: 'Header telling the application which client scheme was used.',
    detail:
      'Set it from `ssl_fc` or at a trusted TLS terminator. Setting it unconditionally on a public plaintext listener lets an attacker convince the application that HTTP was HTTPS, which can break secure-cookie and redirect logic.',
  },
  {
    term: 'PROXY protocol',
    category: 'Routing',
    aliases: ['proxy protocol v2', 'accept-proxy'],
    short: 'A header that carries the original connection addresses.',
    detail:
      'Used between a trusted load balancer and HAProxy (or HAProxy and a backend). Only enable `accept-proxy` on a socket that cannot be reached by untrusted clients; otherwise clients can forge source addresses.',
  },
  {
    term: 'Health check',
    category: 'Health & balancing',
    aliases: ['check', 'probe'],
    short: 'An active probe that decides whether a server is usable.',
    detail:
      'Enabled per server with `check`. The method can be a TCP connect, an HTTP status check (`option httpchk`) or a scripted check. Configure `inter`, `fall`, `rise` and `timeout check` to control detection latency and false positives.',
  },
  {
    term: 'inter / fall / rise',
    category: 'Health & balancing',
    aliases: ['check timing'],
    short: 'Health-check interval and failure/success thresholds.',
    detail:
      '`inter 2s fall 3 rise 2` checks every two seconds, marks a server down after three failures and up after two successes. Faster detection costs more probes and can cause flapping; slower detection leaves bad servers in rotation longer.',
  },
  {
    term: 'Passive health checking',
    category: 'Health & balancing',
    aliases: ['observe', 'error limit'],
    short: 'Marking servers down based on observed failures.',
    detail:
      'HAProxy can use response/connection observations and error limits in some configurations. Unlike active checks, it learns only when traffic hits the server. Active and passive signals complement each other.',
  },
  {
    term: 'Round robin',
    category: 'Health & balancing',
    aliases: ['roundrobin', 'rr'],
    short: 'Rotate requests evenly across servers.',
    detail:
      'Simple and fair for similar, stateless requests. Dynamic weights are respected. It does not account for request cost or active connections, so a slow server may accumulate queued work.',
  },
  {
    term: 'Least connections',
    category: 'Health & balancing',
    aliases: ['leastconn'],
    short: 'Send new requests to the server with the fewest active connections.',
    detail:
      'Good for long-lived connections or variable request cost. With HTTP keep-alive and connection reuse, “connections” may not equal active requests; understand the backend protocol before relying on it.',
  },
  {
    term: 'Source hashing',
    category: 'Health & balancing',
    aliases: ['source', 'ip hash'],
    short: 'Choose a server based on the client IP.',
    detail:
      'A weak affinity mechanism: clients behind NAT share an address, and mobile clients change networks. Prefer cookie stickiness for user sessions and use source hashing only when the protocol cannot carry a cookie.',
  },
  {
    term: 'Stick table',
    category: 'Health & balancing',
    aliases: ['stick-table', 'stickiness'],
    short: 'A shared memory table for affinity, counters and rate limits.',
    detail:
      'Keys can be source addresses, cookies or other sample values. Set `size` and `expire`; otherwise user-controlled cardinality can exhaust memory. Peer replication is optional and adds network complexity.',
  },
  {
    term: 'Cookie persistence',
    category: 'Health & balancing',
    aliases: ['stickiness', 'session affinity'],
    short: 'Pinning a client to a server with a cookie.',
    detail:
      'HAProxy can insert or rewrite a cookie naming the selected server. More reliable than source IP behind NAT. Use `secure`/`indirect` where appropriate and plan what happens when the pinned server disappears.',
  },
  {
    term: 'Drain mode',
    category: 'Health & balancing',
    aliases: ['drain', 'maintenance'],
    short: 'Stop sending new requests to a server while existing ones finish.',
    detail:
      'A graceful operational action, usually through the Runtime API or stats page. Use it for deployments instead of abruptly removing a server. Monitor queueing from the remaining pool.',
  },
  {
    term: '503 Service Unavailable',
    category: 'Timeouts & failures',
    aliases: ['503', 'no server'],
    short: 'No healthy backend server could serve the request.',
    detail:
      'Common causes: all servers down, no server lines, a missing default_backend, or a stick-table/affinity decision that cannot be honoured. Check server state, check configuration and backend routing before blaming the application.',
  },
  {
    term: '502 Bad Gateway',
    category: 'Timeouts & failures',
    aliases: ['502'],
    short: 'The upstream connection failed or returned an invalid response.',
    detail:
      'Often a dead process, wrong port, TLS mismatch, rejected connection or protocol error. Check connect timeouts, server state and whether HAProxy expects HTTP while the server speaks something else.',
  },
  {
    term: '504 Gateway Timeout',
    category: 'Timeouts & failures',
    aliases: ['504'],
    short: 'The server did not respond within the configured timeout.',
    detail:
      'Distinguish TCP connect failures from application response stalls. `timeout connect` covers the connection/handshake; `timeout server` covers waiting for the response. Check queue time, server latency and health-check timeouts.',
  },
  {
    term: '408 Request Timeout',
    category: 'Timeouts & failures',
    aliases: ['408', 'slowloris'],
    short: 'The client did not send a complete request in time.',
    detail:
      '`timeout http-request` bounds header arrival. A slow or malicious client can otherwise hold a connection. Monitor 408 spikes and tune without breaking slow mobile or upload clients.',
  },
  {
    term: 'timeout connect',
    category: 'Timeouts & failures',
    aliases: ['connect timeout'],
    short: 'How long HAProxy waits to establish an upstream connection.',
    detail:
      'Includes the TCP connect and any configured upstream TLS handshake. Too long delays failover; too short can mark a healthy but slow network path as failed. Typical internal values are a few seconds.',
  },
  {
    term: 'timeout client',
    category: 'Timeouts & failures',
    aliases: ['client timeout'],
    short: 'Inactivity budget on the client side.',
    detail:
      'Bounds how long HAProxy waits for client data or while sending a response. It is not a total request deadline. Long uploads and streaming need deliberate design; tunnels use `timeout tunnel`.',
  },
  {
    term: 'timeout server',
    category: 'Timeouts & failures',
    aliases: ['server timeout'],
    short: 'Inactivity budget while waiting for the application.',
    detail:
      'Covers waiting for the server response and, depending on mode, between response data chunks. Tune to the application’s worst legitimate latency. Watch 504s and queue time when changing it.',
  },
  {
    term: 'timeout tunnel',
    category: 'Timeouts & failures',
    aliases: ['tunnel timeout', 'websocket'],
    short: 'Timeout after a connection becomes a tunnel.',
    detail:
      'Applies to WebSocket, CONNECT and TCP streams. A finite value is good hygiene; make it longer than legitimate idle periods. Without it, client/server timeouts may cut or retain tunnels unexpectedly.',
  },
  {
    term: 'maxconn',
    category: 'Performance',
    aliases: ['connection limit'],
    short: 'Maximum concurrent connections.',
    detail:
      'Can be set globally and per proxy. It converts resource exhaustion into predictable queuing/rejection. Size against file descriptors, memory per connection, thread count and application capacity.',
  },
  {
    term: 'nbthread',
    category: 'Performance',
    aliases: ['threads'],
    short: 'Number of HAProxy worker threads.',
    detail:
      'Modern HAProxy is multi-threaded. `nbproc` is obsolete. CPU pinning and thread counts should follow measurements and container CPU limits, not copied tuning guides.',
  },
  {
    term: 'Connection reuse',
    category: 'Performance',
    aliases: ['http-reuse', 'keep-alive'],
    short: 'Reusing established backend HTTP connections.',
    detail:
      'Reduces handshakes and upstream load. `safe` is a common conservative setting; `never` is a compatibility escape hatch; aggressive modes require server support and careful review.',
  },
  {
    term: 'Slowloris',
    category: 'Performance',
    aliases: ['slow http attack'],
    short: 'An attack that holds connections open by sending headers slowly.',
    detail:
      '`timeout http-request` and connection limits are the basic HAProxy mitigations. Logging and edge rate limiting help visibility. Do not confuse a large maxconn with protection.',
  },
  {
    term: 'Buffer / bufsize',
    category: 'Performance',
    aliases: ['tune.bufsize', 'memory'],
    short: 'Per-connection memory used for request/response buffering.',
    detail:
      'Increasing `tune.bufsize` allows larger headers/cookies but multiplies memory by concurrent connections and buffers. Most large-header problems should be fixed at the source.',
  },
  {
    term: 'Runtime API',
    category: 'Operations',
    aliases: ['stats socket', 'admin socket', 'socket'],
    short: 'Live control and inspection through the stats socket.',
    detail:
      'Can change server state, weights, maps, stick tables and more. Restrict with filesystem mode and a dedicated group. Treat admin-level access like production control, because it is.',
  },
  {
    term: 'Seamless reload',
    category: 'Operations',
    aliases: ['hitless reload', 'graceful reload'],
    short: 'Start a new worker before the old one stops.',
    detail:
      'HAProxy can hand sockets to a new process and drain the old one. Use `-W`/`-Ws`, a proper service manager and `hard-stop-after` for long connections. Reload is not a restart; a restart drops traffic.',
  },
  {
    term: 'haproxy -c',
    category: 'Operations',
    aliases: ['config check', 'validate config'],
    short: 'Validate a configuration without starting HAProxy.',
    detail:
      '`haproxy -c -f /path/haproxy.cfg` parses the file and reports errors/warnings. Always validate with the exact binary and version that will run in production. The Workbench analyzer is complementary, not a compiler.',
  },
  {
    term: 'Log format',
    category: 'Operations',
    aliases: ['log-format', 'httplog'],
    short: 'The fields written for each event.',
    detail:
      'HTTP logs can include timers, request/response metadata, termination state and captured values. For TLS passthrough, a custom format with captured SNI is essential. Avoid logging cookies, tokens or personal data unnecessarily.',
  },
  {
    term: 'LTS',
    category: 'Versions',
    aliases: ['long term support'],
    short: 'An even-numbered HAProxy branch maintained for five years.',
    detail:
      'Examples: 2.8, 3.0, 3.2, 3.4. Odd-numbered branches are feature releases with shorter support. New production deployments normally choose the latest LTS, after testing application compatibility.',
  },
  {
    term: 'Breaking change',
    category: 'Versions',
    aliases: ['upgrade', 'removed directive'],
    short: 'A change that can make an existing config fail or behave differently.',
    detail:
      'HAProxy avoids unnecessary breakage, but removed directives, stricter duplicate-name checks, runtime API behaviour and renamed tuning options can affect upgrades. Validate against the target branch and read the release notes before switching production.',
  },
  {
    term: 'crt-store',
    category: 'Versions',
    aliases: ['certificate store'],
    short: 'HAProxy 3.x certificate storage abstraction.',
    detail:
      'Separates certificate loading from binds and supports centralised management. Optional for most upgrades; a bind with `crt`/`crt-list` still works. Review the exact 3.x syntax before migrating.',
  },
];

export function glossarySearch(query, category = 'all') {
  const q = String(query || '').trim().toLowerCase();
  return GLOSSARY.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!q) return true;
    return (
      entry.term.toLowerCase().includes(q) ||
      entry.short.toLowerCase().includes(q) ||
      entry.detail.toLowerCase().includes(q) ||
      entry.aliases.some((alias) => alias.toLowerCase().includes(q))
    );
  });
}
