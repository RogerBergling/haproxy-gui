/**
 * In-app HAProxy encyclopedia.
 *
 * The explanations are deliberately practical: what the directive changes,
 * when it matters, and which mistakes are common. They are not a replacement
 * for the configuration manual of the exact HAProxy build in use.
 */

export const SECTION_GUIDE = {
  global: {
    title: 'global',
    summary: 'Process-wide settings: privileges, logging, TLS defaults, tuning, runtime socket and certificate stores.',
    purpose:
      'The global section exists once and applies to the whole HAProxy process. It is where you drop privileges, open the runtime API socket, set TLS defaults and size process-wide limits. Values here can make every frontend safer — or expose the runtime API to the wrong users.',
    keyPoints: [
      'Privilege handling (user, group, chroot) still matters even inside containers.',
      'TLS defaults in global are inherited by binds that do not override them.',
      'The stats socket is a powerful administrative interface, not just a monitoring endpoint.',
      'maxconn, nbthread, buffers and CPU binding affect capacity and failure behaviour.',
    ],
    commonMistakes: [
      'A world-writable or unrestricted admin stats socket.',
      'No explicit TLS minimum version or cipher policy.',
      'Changing tune.bufsize without accounting for memory and maxconn.',
      'Using daemon mode under a process supervisor that expects a foreground process.',
    ],
  },
  defaults: {
    title: 'defaults',
    summary: 'Inherited defaults for timeouts, mode, logging, connection reuse and error responses.',
    purpose:
      'The defaults section supplies settings to every proxy that follows it. It is the best place to make timeouts, mode and logging explicit. HAProxy’s built-in defaults are safe to boot but rarely describe your production failure budget.',
    keyPoints: [
      'mode http/tcp is inherited by later frontends, backends and listen sections.',
      'Timeouts set here are inherited unless a proxy overrides them.',
      'Error files in defaults give consistent 4xx/5xx pages across the config.',
      'Options in defaults are easy to overlook when debugging a single proxy.',
    ],
    commonMistakes: [
      'Relying on built-in timeouts.',
      'Setting mode http globally and then forgetting mode tcp on a passthrough frontend.',
      'Copying production defaults into a TCP-only config where HTTP options have no effect.',
    ],
  },
  frontend: {
    title: 'frontend',
    summary: 'The client-facing listener: binds, TLS termination, ACLs and the decision about which backend receives a request.',
    purpose:
      'A frontend accepts connections, optionally terminates TLS, evaluates request-level actions and routes to a backend with use_backend or default_backend. In TCP mode it sees a byte stream; in HTTP mode it can inspect headers, paths and cookies.',
    keyPoints: [
      'bind lines define the listening sockets; mode decides how much HAProxy can inspect.',
      'use_backend rules are evaluated in order; the first match wins.',
      'default_backend is the fallback when no rule matches.',
      'HTTP actions run before switching rules, so a return/deny can end the request early.',
    ],
    commonMistakes: [
      'Forgetting default_backend, leaving unmatched requests as 503.',
      'Putting a wildcard rule before a more specific host rule.',
      'Setting X-Forwarded-Proto unconditionally on a listener that can receive plaintext.',
      'Assuming HAProxy can route by Host inside a TLS passthrough frontend.',
    ],
  },
  backend: {
    title: 'backend',
    summary: 'The upstream pool: servers, load-balancing algorithm, health checks, stickiness and backend-level response rules.',
    purpose:
      'A backend describes where traffic goes and how HAProxy chooses a server. It can health-check servers, keep session affinity, reuse connections, rewrite headers and return explicit responses when no server is available.',
    keyPoints: [
      'A server needs `check` for active health checks; check options alone do nothing.',
      'Balance algorithms change affinity and failure behaviour, not just distribution.',
      'Stick tables can hold cookies, source addresses and counters; always set expire and size.',
      'Backend HTTP rules can return a deliberate response instead of a generic 503.',
    ],
    commonMistakes: [
      'Configuring `option httpchk` but never adding `check` to servers.',
      'Using leastconn for long-lived connections without understanding queueing.',
      'A stick table without expire, allowing unbounded memory growth.',
      'Sending cleartext to an upstream on port 443 without `ssl`.',
    ],
  },
  listen: {
    title: 'listen',
    summary: 'A combined frontend + backend section, useful for simple proxies and stats listeners.',
    purpose:
      'listen is shorthand for a proxy that both accepts and serves traffic. It is common for simple TCP forwarding, admin stats pages and legacy configs. For complex routing, separate frontends and backends are usually easier to reason about.',
    keyPoints: [
      'bind, servers, ACLs and backend rules all live in one section.',
      'A listen section participates in backend references like a backend.',
      'Named listen sections are subject to the same duplicate-name rules as other proxies.',
    ],
    commonMistakes: [
      'Growing a listen section into complex routing that would be clearer as frontend + backends.',
      'Assuming a listen section inherits mode from a different defaults block than it actually does.',
    ],
  },
  resolvers: {
    title: 'resolvers',
    summary: 'DNS resolver definitions used by server hostnames, `init-addr`, service discovery and dynamic updates.',
    purpose: 'A resolvers section teaches HAProxy how to resolve DNS names and how often to refresh them. Without a resolver, hostnames are typically resolved at startup and may not follow DNS changes.',
    keyPoints: ['Reference a resolver from server lines with `resolvers <name>`.', 'Tune timeouts and retries for your DNS infrastructure.', 'Runtime DNS failures can remove all servers and cause 503s.'],
    commonMistakes: ['Using hostnames without a resolver and expecting dynamic DNS behaviour.', 'No monitoring for resolver failures.'],
  },
  peers: {
    title: 'peers',
    summary: 'Stick-table replication between HAProxy nodes, typically used for session affinity or shared counters.',
    purpose: 'The peers section defines a mesh of HAProxy peers that replicate stick-table data. It is relevant for active/active or redundant load balancers that need shared session state.',
    keyPoints: ['Each peer needs a stable address and name.', 'Peers communicate over their own protocol and port.', 'Not every stick-table needs replication; replicate only what must survive a node failure.'],
    commonMistakes: ['Replicating large tables without capacity planning.', 'Firewall rules that block peer traffic.', 'Assuming peers provide configuration synchronisation — they do not.'],
  },
  cache: {
    title: 'cache',
    summary: 'HAProxy’s small object cache for HTTP responses.',
    purpose: 'The cache section configures an in-memory cache that backends can use with `http-request cache-use` and `http-response cache-store`. It is useful for small, cacheable objects, not as a general-purpose CDN.',
    keyPoints: ['Define total and per-object limits.', 'Caching is opt-in per rule.', 'Respect authorization and cookies when caching.'],
    commonMistakes: ['Caching personalised responses.', 'Treating HAProxy cache as a complete CDN replacement.'],
  },
  ring: {
    title: 'ring',
    summary: 'Shared-memory ring buffers for logs and traces, exposed through the Runtime API.',
    purpose: 'A ring buffer keeps recent log or trace events in shared memory so they can be inspected without a filesystem or external collector.',
    keyPoints: ['Useful for debugging in minimal container images.', 'Bounded by size; not a durable audit log.', 'Expose access carefully through the stats socket.'],
    commonMistakes: ['Using a ring as the only production log destination.', 'Forgetting that a reload may affect buffered data.'],
  },
  'http-errors': {
    title: 'http-errors',
    summary: 'Reusable HTTP error response definitions referenced by proxies.',
    purpose: 'This section defines named error responses that can be referenced with `errorfile` or `http-errors`, keeping error pages consistent and out of each proxy.',
    keyPoints: ['Centralises 4xx/5xx pages.', 'Can reference files or inline content depending on version.', 'Error pages should not leak stack traces or internal hostnames.'],
    commonMistakes: ['Error pages that contain server paths or debug information.', 'Assuming every error path uses the custom page.'],
  },
  mailers: {
    title: 'mailers',
    summary: 'Legacy SMTP alerting section (deprecated in HAProxy 3.1, removed in 3.3).',
    purpose: 'Mailers send alerts about server state changes. The legacy C implementation is being retired in favour of Lua mailers and external alerting.',
    keyPoints: ['Do not add new legacy mailer setups.', 'Plan migration before HAProxy 3.3.', 'External monitoring is usually more reliable than HAProxy-originated email.'],
    commonMistakes: ['Upgrading to 3.3 with a legacy mailers section and discovering it is removed.', 'Sending alert mail through a relay that cannot be reached during an incident.'],
  },
  program: {
    title: 'program',
    summary: 'Starts an external process from HAProxy (deprecated 3.1, removed 3.3).',
    purpose: 'Historically used to launch helpers such as the Data Plane API alongside HAProxy. It is being removed; process supervision belongs to systemd, a container entrypoint or another supervisor.',
    keyPoints: ['Move helper processes to real process supervision.', 'Do not rely on HAProxy to restart a failed helper.', 'A 3.3+ binary rejects this section.'],
    commonMistakes: ['Embedding lifecycle management in the proxy config.', 'Upgrading without moving the helper.'],
  },
  'fcgi-app': {
    title: 'fcgi-app',
    summary: 'FastCGI application definitions used by HAProxy’s FastCGI support.',
    purpose: 'Configures FastCGI parameters and document roots for backends that speak FastCGI. It is a specialised feature; most deployments use HTTP proxying.',
    keyPoints: ['FastCGI support depends on the build.', 'Keep document roots and PATH_INFO handling consistent with the application.'],
    commonMistakes: ['Mixing FastCGI and HTTP backend modes without understanding the expected protocol.'],
  },
  userlist: {
    title: 'userlist',
    summary: 'Static users and groups for HTTP authentication.',
    purpose: 'Defines users, password hashes and groups used by `http-request auth`. It is intended for small, static access-control lists, not a full identity provider.',
    keyPoints: ['Store password hashes, never plaintext.', 'Static users do not rotate or centralise like an IdP.', 'Combine with TLS; Basic auth over plaintext is unsafe.'],
    commonMistakes: ['Plaintext passwords in the config.', 'Using a small static list for organisation-wide authentication.'],
  },
  'log-forward': {
    title: 'log-forward',
    summary: 'Forward syslog messages received on a UDP/TCP socket to another log destination.',
    purpose: 'A log-forward section acts as a syslog relay inside HAProxy, useful in container or edge environments where local syslog is unavailable.',
    keyPoints: ['Binds a syslog listener and forwards to one or more targets.', 'Adds another network listener that must be secured.', 'Consider log volume and backpressure.'],
    commonMistakes: ['Exposing the log listener publicly.', 'Assuming forwarding provides durable storage.'],
  },
  'crt-store': {
    title: 'crt-store',
    summary: 'HAProxy 3.x certificate storage abstraction, separating certificate storage from use in a bind.',
    purpose: 'crt-store lets HAProxy load certificates, keys, OCSP material and related files into a named store that frontends can reference. It is part of the 3.0 certificate management modernisation; existing `crt`/`crt-list` binds remain valid.',
    keyPoints: ['Optional migration; not required for a basic 2.x → 3.x upgrade.', 'Useful for centralised certificate management and hot updates.', 'Check the exact syntax against the target 3.x branch.'],
    commonMistakes: ['Rewriting a stable certificate setup during an upgrade without a rollback path.'],
  },
  acme: {
    title: 'acme',
    summary: 'ACME certificate automation introduced around HAProxy 3.2 (experimental in early releases).',
    purpose: 'Configures automated certificate issuance and renewal from ACME providers such as Let’s Encrypt. Availability, provider support and syntax depend on the HAProxy build and version.',
    keyPoints: ['Confirm your build includes ACME support.', 'Staging endpoints and rate limits matter.', 'Keep a manual renewal or rollback path until the workflow is proven.'],
    commonMistakes: ['Using production ACME endpoints for initial tests.', 'Assuming automatic renewal is monitored without alerting.'],
  },
  traces: {
    title: 'traces',
    summary: 'Shared-memory trace definitions used with HAProxy’s tracing support and filters.',
    purpose: 'The traces section configures trace sources and sinks for debugging and observability, often used with OpenTelemetry or the trace filter in recent versions.',
    keyPoints: ['Tracing has CPU and memory cost; scope it carefully.', 'Trace data can contain request metadata; protect it.', 'Support and syntax change across 3.x releases.'],
    commonMistakes: ['Capturing full production traffic without a retention or privacy plan.'],
  },
};

const guide = (title, syntax, summary, detail, tips = [], extra = {}) => ({
  title,
  syntax,
  summary,
  detail,
  tips,
  ...extra,
});

export const DIRECTIVE_GUIDE = {
  log: guide(
    'log',
    'log <address> <facility> [level]',
    'Sends logs to a syslog destination.',
    'HAProxy sends structured syslog messages. `/dev/log` uses a local Unix socket; `stdout` and `stderr` are useful in containers; a remote `host:port` is useful when the host has no syslog. In defaults, `log global` reuses the global targets.',
    ['In containers, `log stdout format raw local0` is often more reliable than /dev/log.', 'Use different facilities for access and operational alerts.', 'Logging failures should be monitored; HAProxy will not stop serving traffic just because syslog is gone.'],
    { seeAlso: ['timeouts-logging'] },
  ),
  chroot: guide(
    'chroot',
    'chroot <directory>',
    'Restricts HAProxy’s filesystem view after startup.',
    'HAProxy starts with the privileges needed to bind sockets, then enters a chroot and drops user/group. This limits the damage from a process compromise. Certificate and map paths must be readable inside the chroot or loaded before it.',
    ['Keep certificate paths inside the chroot or use a certificate store that loads before privilege drop.', 'Container deployments may already provide filesystem isolation; still drop privileges.', 'Test reloads after changing chroot paths.'],
    { seeAlso: ['operations'] },
  ),
  'stats socket': guide(
    'stats socket',
    'stats socket <path> [mode <octal>] [level admin|operator|user] [expose-fd listeners]',
    'Creates a Unix socket for the HAProxy Runtime API.',
    'The Runtime API can inspect and change live state: server weights, health state, stick tables, map files and more. `level admin` is powerful. Restrict filesystem permissions and consider a separate read-only socket for monitoring.',
    ['Use `mode 660` and a dedicated group.', '`expose-fd listeners` is needed for seamless reload/state transfer workflows; do not enable it casually.', 'Treat the admin socket like a root console for traffic.'],
    { seeAlso: ['operations'] },
  ),
  'stats timeout': guide(
    'stats timeout',
    'stats timeout <duration>',
    'Bounds idle time on stats/Runtime API client connections.',
    'A client that connects to the stats socket and then stalls can hold resources. A modest timeout keeps the API responsive and prevents accidental resource pinning.',
    ['30s is a common starting point.', 'Long-running CLI sessions may need a higher value or an explicit reconnect strategy.'],
    { seeAlso: ['operations'] },
  ),
  user: guide('user', 'user <username>', 'Drops process privileges to this user after startup.', 'HAProxy normally starts as root to bind low ports, then switches to an unprivileged account. Ensure config, certificates, maps and the runtime socket are readable/writable by that account.', ['Use a dedicated account with no login shell.', 'Verify certificate permissions after renewals.', 'In Kubernetes/containers, prefer running as non-root with a high port and avoid needing this switch.']),
  group: guide('group', 'group <groupname>', 'Sets the group used after dropping privileges.', 'The group controls access to the runtime socket, maps and certificate files. Align it with your operations and certificate deployment tooling.', ['Use a dedicated HAProxy group.', 'Mode 660 + group ownership is a practical runtime-socket policy.']),
  daemon: guide('daemon', 'daemon', 'Backgrounds the HAProxy process.', 'Traditional distribution packages expect daemon mode. systemd and container supervisors usually expect HAProxy to stay in the foreground so they can track the process, capture logs and restart it. Some container entrypoints override this with `-db`.', ['Under Docker, use the foreground and let the container runtime supervise.', 'Under systemd, follow the unit that ships with your package.', 'Do not mix daemon mode with a supervisor that tracks the original PID.']),
  maxconn: guide(
    'maxconn',
    'maxconn <number>',
    'Limits concurrent connections (global or per proxy).',
    'The limit sheds load predictably instead of letting the process hit file-descriptor or memory limits. Size it from ulimit -n, memory per connection, buffer sizes and application capacity. A per-frontend maxconn protects one service from exhausting the process.',
    ['Global maxconn should fit within `ulimit -n` with headroom for logs, DNS and admin sockets.', 'Frontend maxconn can isolate noisy neighbours.', 'Monitor connection counts and queuing before and after changes.'],
    { seeAlso: ['performance'] },
  ),
  nbthread: guide('nbthread', 'nbthread <number>', 'Sets the number of HAProxy worker threads.', 'Modern HAProxy is fully threaded. Leaving the default often works; explicit thread counts are useful for capacity testing or CPU pinning. Avoid old multi-process advice (`nbproc`) and prefer `nbthread` plus `cpu-map` or automatic CPU binding in 3.2+.', ['Benchmark before pinning threads.', 'Leave CPU for the kernel, monitoring and applications.', 'HAProxy 3.2+ can bind CPU automatically; review instead of copying old tuning.']),
  'cpu-map': guide('cpu-map', 'cpu-map <group> <thread> <cpu-set>', 'Pins HAProxy threads to CPUs.', 'CPU pinning can improve cache locality and reduce jitter, but it can also starve the proxy if the machine is shared. It is an advanced tuning step, not a default requirement.', ['Measure before and after.', 'Account for NUMA topology.', 'Do not pin all threads to one core or oversubscribe a container CPU limit.']),
  'ca-base': guide('ca-base', 'ca-base <directory>', 'Sets the default directory for CA files.', 'Relative CA paths are resolved against this directory. It does not by itself verify clients or validate upstream certificates; those are explicit options on bind/server lines.', ['Keep CA bundles updated.', 'Be explicit about verification on every relevant bind/server.']),
  'crt-base': guide('crt-base', 'crt-base <directory>', 'Sets the default directory for certificate files.', 'Relative `crt` paths are resolved here. A certificate’s private key is normally in the same PEM file. File permissions and renewal reloads are operational concerns.', ['Never commit private keys.', 'Make renewals atomic and reload after replacing a file.', 'A crt-base path does not select a certificate; binds still need crt/crt-list.']),
  'ssl-default-bind-ciphers': guide('ssl-default-bind-ciphers', 'ssl-default-bind-ciphers <cipher-list>', 'Default TLS 1.2 and earlier cipher list for SSL binds.', 'This applies to TLS versions below 1.3; TLS 1.3 suites use ssl-default-bind-ciphersuites. Use an organisation-approved modern list and verify with a TLS scanner.', ['Prefer AEAD suites and forward secrecy.', 'Avoid RC4, 3DES and export ciphers.', 'Test compatibility before tightening production.']),
  'ssl-default-bind-ciphersuites': guide('ssl-default-bind-ciphersuites', 'ssl-default-bind-ciphersuites <list>', 'Default TLS 1.3 cipher suites.', 'TLS 1.3 suites are separate from older cipher strings. Usually the OpenSSL defaults are acceptable; setting an explicit list documents policy and avoids distribution drift.', ['Verify TLS 1.3 is enabled before relying on this list.', 'Coordinate with your security baseline.']),
  'ssl-default-bind-options': guide(
    'ssl-default-bind-options',
    'ssl-default-bind-options [ssl-min-ver <ver>] [ssl-max-ver <ver>] [no-sslv3] [no-tlsv10] [no-tlsv11] [no-tls-tickets] [prefer-client-ciphers]',
    'Default SSL/TLS policy for all SSL binds.',
    'This is the single most useful TLS hardening line in global. It sets the protocol floor and ticket behaviour. Binds can override individual options, so inspect both when auditing.',
    ['A practical baseline is `ssl-min-ver TLSv1.2 no-tls-tickets`.', 'TLS 1.3 remains available unless explicitly disabled.', 'Do not rely on `no-sslv3` alone as a complete modern policy.'],
    { seeAlso: ['tls'] },
  ),
  'ssl-dh-param-file': guide('ssl-dh-param-file', 'ssl-dh-param-file <path>', 'Loads custom Diffie-Hellman parameters.', 'DHE cipher suites require DH parameters. Modern ECDHE suites do not, but some compliance profiles still require explicit DH parameters. Generate at least 2048-bit parameters and protect the file.', ['Prefer ECDHE and consider removing DHE if legacy compatibility is not required.', 'A 2048-bit DH parameter file can be reused across hosts.', 'Large DH parameters increase handshake CPU cost.']),
  'tune.ssl.default-dh-param': guide('tune.ssl.default-dh-param', 'tune.ssl.default-dh-param <bits>', 'Default DH parameter size when no file is supplied.', 'Legacy DHE suites can use generated DH parameters. 2048 bits is the usual modern minimum. If you supply ssl-dh-param-file, that file is the source of truth.', ['Keep at 2048 unless a documented requirement says otherwise.', 'Check both the file and the tuning value during TLS reviews.']),
  'tune.bufsize': guide('tune.bufsize', 'tune.bufsize <bytes>', 'Sets the per-connection buffer size.', 'Larger buffers allow bigger headers and cookies but multiply memory use across connections. The default is usually correct; changes should be justified by a measured requirement and memory budget.', ['Memory scales with maxconn and buffer count.', 'Oversized headers are often better fixed at the application or client.', 'Validate after changes with realistic traffic.']),
  'hard-stop-after': guide('hard-stop-after', 'hard-stop-after <duration>', 'Bounds how long an old worker may keep finishing requests during reload.', 'Seamless reloads start a new worker and let the old one drain. Without a bound, a stuck long-lived connection can keep the old worker alive. Set this for long-poll/streaming workloads with care.', ['Choose a value larger than the longest legitimate request/tunnel.', 'Monitor old-worker lifetime during reloads.', 'A forced stop can cut active streams.']),
  'master-worker': guide('master-worker', 'master-worker [no-exit-on-failure]', 'Enables master-worker mode from the config (deprecated in 3.3).', 'Master-worker mode supports seamless reloads and process management. Modern deployments enable it with `-W`/`-Ws` command-line flags; the config directive is being retired.', ['Move the flag to the service/container command.', '`-Ws` works with systemd notification.', 'Verify reload behaviour after the change.']),
  'expose-deprecated-directives': guide('expose-deprecated-directives', 'expose-deprecated-directives', 'Allows deprecated directives to be parsed.', 'This is an escape hatch for gradual migrations, not a fix. It lets old syntax load while you plan replacements, often with warnings. Do not use it to keep a permanently obsolete config.', ['Remove before the next LTS if possible.', 'Track every warning in staging.', 'Do not use it to hide removed directives — removed is not the same as deprecated.']),
  'lua-load': guide('lua-load', 'lua-load <file>', 'Loads a Lua script at startup.', 'Lua enables custom fetches, converters, services and actions. Scripts are code with access to request metadata and shared state; review them like any production code. Reload semantics and API compatibility vary by HAProxy branch.', ['Pin and review Lua dependencies.', 'Test scripts against the target HAProxy version.', 'Avoid blocking I/O in request paths.']),
  setenv: guide('setenv', 'setenv <name> <value>', 'Sets an environment variable for HAProxy itself.', 'Useful for configuration templating or Lua, but values in the config are visible to anyone who can read it. Never put secrets here.', ['Prefer file-based secrets with restricted permissions.', 'Remember that configs are often copied and archived.']),
  mode: guide('mode', 'mode http|tcp', 'Selects the proxy analysis mode.', 'HTTP mode enables header/path/cookie parsing, HTTP health checks and HTTP actions. TCP mode forwards an opaque byte stream and works for TLS passthrough, SSH, databases and other protocols. The mode is inherited from defaults unless overridden.', ['Both ends of a backend connection should use the protocol you expect.', 'A TLS passthrough edge must be TCP; it cannot inspect Host or path.', 'Health-check type must match the mode and application.']),
  'option httplog': guide('option httplog', 'option httplog', 'Enables verbose HTTP access logs.', 'Logs the request line, status, bytes, timers, frontend/backend/server names and termination state. It is the standard starting point for HTTP troubleshooting.', ['Use a log format that includes timings (`%Tr`, `%Tq`, etc.) for latency work.', 'Consider log volume and PII.', 'TCP proxies need `option tcplog` or a custom log-format.']),
  'option tcplog': guide('option tcplog', 'option tcplog', 'Enables TCP connection logs.', 'Logs connection-level information rather than HTTP requests. Use it for passthrough and non-HTTP protocols.', ['Add SNI capture and a log-format for TLS passthrough debugging.', 'Do not expect HTTP status codes in TCP mode.']),
  'option dontlognull': guide('option dontlognull', 'option dontlognull', 'Suppresses logs for connections that close without data.', 'Useful to reduce noise from health probes and port scans. It also hides some failed connection patterns, so keep metrics for connection-level failures.', ['Do not let noise reduction remove all visibility into scanning or misconfiguration.']),
  'option dontlog-normal': guide('option dontlog-normal', 'option dontlog-normal', 'Suppresses logs for successful requests.', 'Reduces volume on high-traffic sites, but errors alone may not be enough during debugging. Metrics and traces should cover the healthy path if normal logs are disabled.', ['Be careful when investigating latency on successful requests.']),
  'option forwardfor': guide(
    'option forwardfor',
    'option forwardfor [except <network>] [header <name>] [if-none]',
    'Adds an X-Forwarded-For header with the client address.',
    'Backends see the proxy’s address without this. The header is only trustworthy if the backend accepts it only from HAProxy and HAProxy strips any client-supplied value. A custom header name can avoid collisions with an upstream proxy.',
    ['Use `except` for trusted internal networks when appropriate.', 'Sanitise inbound X-Forwarded-For at the edge.', 'Pair with application-side trusted-proxy configuration.'],
    { seeAlso: ['routing'] },
  ),
  'option http-keep-alive': guide('option http-keep-alive', 'option http-keep-alive', 'Allows HTTP keep-alive between client and HAProxy.', 'Keep-alive reduces TCP/TLS handshakes but holds connections. Pair it with an explicit `timeout http-keep-alive` so idle sockets do not live until the general client timeout.', ['Tune keep-alive timeout to traffic patterns.', 'Consider connection limits and memory.']),
  'option http-server-close': guide('option http-server-close', 'option http-server-close', 'Closes the server-side connection after each response while keeping the client connection alive.', 'Useful for applications that do not handle persistent backend connections well. It costs upstream handshakes and is less efficient than connection reuse.', ['Prefer fixing server keep-alive support where possible.', 'Watch for port exhaustion under high request rates.']),
  'option redispatch': guide('option redispatch', 'option redispatch [<retries>]', 'Retries a request on another server after a connection failure.', 'This can improve resilience but has semantics that depend on whether the request was idempotent and how far it reached the server. It is not a transparent retry guarantee for POST requests.', ['Understand your application’s idempotency.', 'Combine with retries and health checks deliberately.']),
  'option tcp-check': guide('option tcp-check', 'option tcp-check', 'Enables scripted TCP health checks.', 'A simple TCP connect check is usually enough. Scripted checks can send and expect bytes for protocols that require a handshake. Crucially, the option only configures the check; each server also needs `check`.', ['For TLS upstreams, consider `check-ssl` or an appropriate check.']),
  'option httpchk': guide('option httpchk', 'option httpchk [METHOD] [URI] [VERSION]', 'Configures an HTTP health check.', 'A plain connect check only proves the TCP port is open. An HTTP check can verify the application responds correctly. Choose a lightweight, dependency-free endpoint and a status code that reflects readiness. A bare `option httpchk` sends `OPTIONS / HTTP/1.0` and only accepts 2xx/3xx responses, so it can mark a healthy app DOWN.', ['Use a dedicated health endpoint, not the home page.', 'Specify the method and URI explicitly, for example `option httpchk GET /health`.', 'Add `http-check expect status 200` when the default 2xx/3xx rule is not precise enough.', 'Avoid checks that require authentication unless configured.', 'Remember to add `check` to each server.']),
  'timeout connect': guide('timeout connect', 'timeout connect <duration>', 'Maximum time to establish a connection to a server.', 'This covers TCP connect and any configured TLS handshake to the upstream. A long connect timeout makes an unreachable server look like a slow application.', ['Start with 3–5s for typical internal services.', 'Tune for cross-region or satellite links.', 'Measure connection failure modes, not just happy path.']),
  'timeout client': guide('timeout client', 'timeout client <duration>', 'Bounds inactivity on the client side.', 'In HTTP mode it applies while waiting for client data and during response transmission. It is not a total request deadline. Long uploads or idle WebSockets may need specific handling.', ['Pair with timeout http-request for headers.', 'Use timeout tunnel for upgraded tunnels.', 'Monitor 408s and client aborts.']),
  'timeout server': guide('timeout server', 'timeout server <duration>', 'Bounds inactivity while waiting for the server side.', 'A stuck application can otherwise pin client connections and buffers. For streaming endpoints, the timeout applies between data chunks depending on the mode.', ['Set according to the application’s worst-case think time.', 'Distinguish connect, response-header and body stalls.', 'Watch 504s after changes.']),
  'timeout tunnel': guide('timeout tunnel', 'timeout tunnel <duration>', 'Timeout used after a connection enters tunnel mode.', 'Applies to WebSocket, CONNECT and TCP tunnels. Without it, long-lived idle tunnels can be governed by client/server timeouts in surprising ways.', ['Set a finite value for security and resource hygiene.', 'Account for legitimate idle periods.', 'Do not use 24h without a monitoring reason.']),
  'timeout http-request': guide('timeout http-request', 'timeout http-request <duration>', 'Bounds the time to receive complete HTTP request headers.', 'A key slowloris defence. It should be long enough for slow mobile clients and short enough to release abandoned connections. It applies to headers, not the full body.', ['10s is a common starting point.', 'Uploads are governed by other timeouts.', 'Monitor 408 responses.']),
  'timeout http-keep-alive': guide('timeout http-keep-alive', 'timeout http-keep-alive <duration>', 'Bounds idle time between HTTP requests on a kept-alive connection.', 'A shorter value frees connections; a longer value saves handshakes. Tune with browser/API behaviour and connection limits in mind.', ['Do not leave it at the general client timeout by accident.']),
  'timeout client-fin': guide('timeout client-fin', 'timeout client-fin <duration>', 'How long to wait for the client to close after HAProxy has finished sending.', 'Useful when clients are slow to close half-closed connections. It prevents lingering sockets while preserving a graceful shutdown.', ['A few seconds is usually enough.', 'Long values can accumulate connections.']),
  'timeout server-fin': guide('timeout server-fin', 'timeout server-fin <duration>', 'How long to wait for the server to close after HAProxy has finished.', 'Analogous to client-fin on the upstream side. It helps when an application acknowledges but does not close promptly.', ['Tune only after observing connection accumulation.']),
  'timeout check': guide('timeout check', 'timeout check <duration>', 'Maximum duration of a health check.', 'If an application is slow but alive, a check timeout that is too short marks it down and can cascade failures.', ['Set per backend if check latency differs.', 'Combine with inter/fall/rise to control detection speed.']),
  'http-reuse': guide(
    'http-reuse',
    'http-reuse never|safe|aggressive|always',
    'Controls reuse of backend HTTP connections.',
    'Reuse reduces handshakes and load on applications. `safe` reuses connections only when no multiplexing risk is present; `always` is risky with some servers. `never` is a deliberate compatibility escape hatch.',
    ['`safe` is a common default for mixed estates.', 'Validate with your application framework.', 'Monitor upstream connection counts and latency.'],
    { seeAlso: ['performance'] },
  ),
  errorfile: guide('errorfile', 'errorfile <status> <file>', 'Overrides the response body for a given HTTP error status.', 'Custom error pages prevent HAProxy’s default page from confusing users and can remove implementation details. Files must be readable by the HAProxy user and available after reload.', ['Do not leak internal hostnames or stack traces.', 'Check that the file exists inside any chroot.', 'Use http-errors in newer configs for reusable definitions.']),
  'default-server': guide('default-server', 'default-server [options]', 'Sets default options for all server lines in a backend.', 'Useful for consistent check intervals, maxconn, TLS verification and slow-start. Explicit defaults make a large backend easier to audit.', ['Set check timing once instead of copying it everywhere.', 'Be careful with `enabled`/`disabled` defaults.']),
  retries: guide('retries', 'retries <number>', 'Number of connection retries per request.', 'Retries apply to connection failures and some response conditions, not arbitrary application errors. Too many retries can amplify load during an outage.', ['Keep low; use health checks to remove bad servers.', 'Combine with redispatch carefully.']),
  bind: guide(
    'bind',
    'bind <address>[:port] [ssl] [crt <file>] [alpn <list>] [verify <mode>] [options]',
    'Defines a listening socket and its transport/TLS options.',
    'A frontend or listen can have multiple binds. Without `ssl`, HAProxy forwards encrypted bytes if the protocol is TLS; with `ssl`, it terminates TLS and can inspect HTTP. The bind is the boundary between opaque transport and layer-7 policy.',
    ['Use a crt-list when one bind serves many certificates by SNI.', '`verify required ca-file ...` enables client-certificate authentication.', 'Do not put a certificate path on a passthrough bind; it will terminate and change the architecture.', 'Bind options override global TLS defaults.'],
    { seeAlso: ['tls'] },
  ),
  use_backend: guide(
    'use_backend',
    'use_backend <backend> [if|unless <condition>]',
    'Routes a request to a backend when its condition matches.',
    'Rules are evaluated in order; the first match wins. Conditions can be named ACLs or inline `{ ... }` expressions. Unmatched traffic falls through to default_backend.',
    ['Put specific rules before wildcards.', 'Test conditions with realistic Host/SNI/path values.', 'Use `unless` when the negative form is clearer.', 'Remember that SNI is available in passthrough, Host only after TLS termination.'],
    { seeAlso: ['routing'] },
  ),
  default_backend: guide('default_backend', 'default_backend <backend>', 'The backend used when no use_backend rule matches.', 'This is the fallback for a frontend. Without it, unmatched requests receive 503 (HTTP) or fail (TCP). An explicit reject/404 backend makes the fallback intentional.', ['Use an explicit 404/421 backend for unknown hosts.', 'For TLS passthrough, a default backend that rejects avoids accidentally forwarding unknown SNI.', 'Do not point at a backend with no servers unless it has a deliberate response.']),
  acl: guide(
    'acl',
    'acl <name> <criterion> [flags] [values]',
    'Defines a named condition for routing and request rules.',
    'ACLs are evaluated when used. Multiple lines with the same name are ORed. A criterion can inspect headers, paths, SNI, source addresses, TLS state or many other sample fetches. Inline conditions avoid naming a one-off check.',
    ['Prefer `-m end .example.com` for suffix matches; it avoids matching `notexample.com`.', 'Use `-i` for case-insensitive hostnames.', 'Named ACLs are scoped to the proxy section.', 'Complex ACLs deserve comments and tests.'],
    { seeAlso: ['routing'] },
  ),
  'http-request': guide('http-request', 'http-request <action> [arguments] [if|unless <condition>]', 'Runs an HTTP request action before backend switching.', 'Common actions include deny, return, redirect, set-header, del-header, auth, set-uri and cache-use. Actions execute in order and can terminate the request early.', ['Use return/deny for explicit fallbacks.', 'Sanitise inbound forwarding headers before setting your own.', 'Remember that request actions only exist in HTTP mode.']),
  'http-request return': guide('http-request return', 'http-request return [status <code>] [content-type <type>] [string <body>] [if|unless <condition>]', 'Returns a response without selecting a backend.', 'Excellent for explicit unknown-host pages, maintenance responses and rejecting misdirected requests. It can be conditional, so it can coexist with normal routing.', ['Use 421 for a host that should never arrive at this listener.', 'Use 404 for unknown services on a shared frontend.', 'Never return internal debug details.']),
  'http-request deny': guide('http-request deny', 'http-request deny [status <code>] [if|unless <condition>]', 'Rejects a request with an HTTP error.', 'A policy decision. For security-sensitive access control, combine with authentication and trusted source networks; an ACL alone is not a substitute for a WAF or application authorization.', ['403 is the ordinary denial; 429 can represent rate limiting.', 'Log the reason without exposing it to the client.']),
  'http-request redirect': guide('http-request redirect', 'http-request redirect location <url>|prefix <url>|scheme <scheme> [code <code>] [if|unless <condition>]', 'Sends an HTTP redirect.', 'A common HTTP→HTTPS policy. Redirect after checking that the request is actually plaintext; avoid redirect loops behind another TLS terminator. HSTS is a separate response header and has longer-lived effects.', ['Use 301 for permanent host canonicalisation; 302/307 when semantics matter.', 'Check X-Forwarded-Proto trust at the edge.', 'Do not redirect ACME challenge paths away from validation.']),
  'http-request set-header': guide('http-request set-header', 'http-request set-header <name> <value> [if|unless <condition>]', 'Sets or replaces a request header.', 'Useful for trusted forwarding metadata such as X-Forwarded-Proto. A header set from SSL state should be conditional (`if { ssl_fc }`) unless the listener is guaranteed TLS-only and private.', ['Strip untrusted inbound identity/forwarding headers first.', 'Use `%{+Q}` or converters when embedding user-controlled values.', 'Certificate fields are not identity unless the certificate was verified.']),
  'http-request del-header': guide('http-request del-header', 'http-request del-header <name> [if|unless <condition>]', 'Removes a request header.', 'Use it to prevent header injection from clients, especially X-Forwarded-For, X-Forwarded-Proto and identity headers that a trusted upstream will set.', ['Delete before setting your own value.', 'Consider all header case variants; HTTP header names are case-insensitive.']),
  'http-response': guide('http-response', 'http-response <action> [arguments] [if|unless <condition>]', 'Runs an HTTP response action.', 'Useful for security headers, hiding server banners and response rewriting. Large response buffering can affect streaming; test carefully.', ['Add HSTS only when the site is HTTPS-only and you understand the commitment.', 'Avoid rewriting bodies of compressed streams unless required.']),
  'http-after-response': guide('http-after-response', 'http-after-response <action> [arguments] [if|unless <condition>]', 'Runs actions after the response headers are processed.', 'Used for late header manipulation where ordering matters. Semantics differ from http-response; check the version-specific manual.', ['Prefer http-response unless you specifically need after-response ordering.']),
  'http-check': guide('http-check', 'http-check <check-rule>', 'Defines scripted HTTP health-check expectations.', 'Used with option httpchk when a simple status check is insufficient. It can send requests, expect status codes or match content.', ['Keep checks cheap and deterministic.', 'Do not check dependencies that would mark the whole pool down during a shared outage.']),
  'tcp-request content': guide('tcp-request content', 'tcp-request content <action> [if|unless <condition>]', 'Inspects or acts on TCP payload before a backend is chosen.', 'Used for SNI inspection/acceptance, connection rejection and capture. In a passthrough edge it is the only way to make routing decisions.', ['Use inspect-delay to wait for the TLS ClientHello.', 'Capture SNI for logs.', 'Accept only when a TLS ClientHello is present if the port is TLS-only.']),
  'tcp-request inspect-delay': guide('tcp-request inspect-delay', 'tcp-request inspect-delay <duration>', 'How long to wait for enough data to evaluate TCP request rules.', 'TLS ClientHello usually arrives immediately, but a short delay avoids hanging on slow or malicious clients. Events can trigger evaluation earlier.', ['1s is typical for SNI routing.', 'Too long increases latency; too short may miss slow ClientHellos.']),
  'tcp-request connection': guide('tcp-request connection', 'tcp-request connection <action> [if|unless <condition>]', 'Runs actions as soon as a connection is accepted.', 'Useful for connection limits or rejecting traffic before payload inspection. It cannot inspect SNI because no payload has arrived yet.', ['Do not use connection-stage rules for Host/SNI conditions.']),
  'monitor-uri': guide('monitor-uri', 'monitor-uri <uri>', 'Enables a simple HTTP monitoring endpoint.', 'A request to this URI is answered by HAProxy itself. It is useful for liveness checks but can mask backend readiness if used as the only health signal.', ['Do not expose it publicly without thought.', 'Use `monitor fail` to tie it to backend health.']),
  'monitor fail': guide('monitor fail', 'monitor fail [if|unless <condition>]', 'Makes the monitor endpoint fail when a condition is true.', 'Commonly used with `nbsrv(backend) lt 1` to signal that no servers are available. This drives HAProxy’s monitor response, not application readiness.', ['Keep the condition simple and meaningful.', 'Monitor both proxy health and application health externally.']),
  capture: guide('capture', 'capture cookie <name> len <n> | capture request header <name> len <n>', 'Captures a value for logging.', 'Captured values appear in logs and can help debug stickiness or header routing. They may contain personal data; treat logs accordingly.', ['Capture only what you need.', 'Use SNI capture for passthrough edges.', 'Review log retention and access.']),
  balance: guide(
    'balance',
    'balance roundrobin|leastconn|source|uri|hdr(...)|random|first|...',
    'Selects the load-balancing algorithm.',
    'Roundrobin spreads requests evenly; leastconn favours servers with fewer active connections; source provides a weak form of affinity based on client IP; hash-based algorithms derive keys from URI/header. The best choice depends on statefulness and request cost.',
    ['Use leastconn for long-lived or variable-cost requests.', 'Use cookie stickiness rather than source hashing for user sessions behind NAT.', 'Test distribution and failover, not just average throughput.'],
    { seeAlso: ['load-balancing'] },
  ),
  server: guide(
    'server',
    'server <name> <address>[:port] [check] [weight <n>] [maxconn <n>] [backup] [ssl] [verify ...] [options]',
    'Defines an upstream server in a backend.',
    'The server name appears in logs, stats and the Runtime API. `check` enables active health checks. `ssl` makes HAProxy originate TLS to the server. `backup` servers are used only when no primary server is available. Weight and maxconn influence distribution and protection.',
    ['Every server should have an owner and a health-check strategy.', 'Use `verify required` with a CA bundle for upstream TLS.', 'Set `maxconn` to protect a fragile application.', 'Give servers stable names; renaming breaks Runtime API automation.'],
    { seeAlso: ['load-balancing'] },
  ),
  'server-template': guide('server-template', 'server-template <prefix> <count> <address> [options]', 'Creates a numbered set of servers from a template.', 'Useful for dynamic environments where many server addresses share a pattern. The exact resolution and naming semantics matter for operations and DNS.', ['Document the naming scheme.', 'Ensure DNS/resolver behaviour is understood.', 'Runtime API names are derived from the template.']),
  'stick-table': guide(
    'stick-table',
    'stick-table type <type> [len <n>] [size <size>] [expire <duration>] [store <data>]',
    'Creates a shared table for session affinity, tracking or rate limits.',
    'A stick table stores keys such as source IPs or cookies. `expire` prevents stale entries from occupying memory forever; `size` bounds memory. `store` controls which counters/values are retained.',
    ['Always set expire for user-controlled keys.', 'Size tables for peak cardinality, not average traffic.', 'Replication needs peers and adds network overhead.'],
    { seeAlso: ['load-balancing'] },
  ),
  stick: guide('stick', 'stick on <criterion> table <name> | stick store-request|store-response <criterion> table <name>', 'Enables session affinity using a stick table.', 'Maps a cookie or other key to a server and reuses that mapping. Useful for applications with local session state. Make sure the table expires and the cookie is handled securely.', ['Prefer signed/encrypted application cookies or TLS.', 'Consider cookie stickiness before source-IP affinity behind NAT.', 'Monitor table usage and eviction.']),
  cookie: guide('cookie', 'cookie <name> [insert|rewrite|prefix] [indirect] [secure] ...', 'Enables cookie-based persistence in a backend.', 'HAProxy can insert or rewrite a cookie that identifies the selected server. `indirect` removes the cookie from client requests, and `secure` restricts it to HTTPS. This is usually more reliable than source-IP affinity.', ['Use secure/HttpOnly attributes where supported.', 'Plan for cookie expiry and server renumbering.', 'Do not put sensitive data in the cookie.']),
  fullconn: guide('fullconn', 'fullconn <number>', 'Number of connections at which server maxconn limits are fully applied.', 'A nuanced capacity-tuning setting: below fullconn, server maxconn limits are scaled, which matters for large pools. Most configs should leave it alone.', ['Use only after reading the version-specific manual.', 'Measure queueing and slow-start effects.']),
  'http-response set-header': guide('http-response set-header', 'http-response set-header <name> <value>', 'Sets a response header.', 'Commonly used for security headers such as HSTS, X-Content-Type-Options or a cache policy. HSTS only makes sense on HTTPS and commits clients to the policy for the max-age.', ['Start with a short HSTS max-age and expand carefully.', 'Coordinate with application headers to avoid duplicates.']),
  'log-format': guide('log-format', 'log-format <format>', 'Customises access-log content.', 'Can include SNI, timers, termination state, captured values and request metadata. Custom formats are essential for TLS passthrough and latency analysis.', ['Log timings and backend/server names when debugging.', 'Avoid logging secrets or full cookies.', 'Use different formats for frontend and backend if needed.']),
  filter: guide('filter', 'filter <name> [options]', 'Attaches a filter such as compression, trace or OpenTelemetry to a proxy.', 'Filters run data through extra processing. They have CPU and privacy implications, especially tracing and body compression.', ['Test performance impact.', 'Review what trace data leaves the process.']),
};

export const ADVANCED_GUIDE = {
  'option httplog': [
    'Log fields include frontend/backend/server names, status, bytes, and timers. Use `%TR` for total request time, `%Tw` for queue wait, `%Tc` for connect time and `%Tr` for response time.',
  ],
  bind: [
    'For TLS passthrough, the bind must not use `ssl`; otherwise HAProxy terminates the connection.',
    'When using multiple certificates, `crt-list` selects by SNI and can include per-certificate options.',
  ],
  server: [
    '`check` is what turns a server into a health-checked target. `option httpchk` or `option tcp-check` only configures how the check behaves.',
  ],
};

export function explainItem(item) {
  if (!item) return null;
  let key = item.keyword;
  if (item.keyword === 'option' || item.keyword === 'no option') key = `option ${item.value}`;
  else if (item.keyword === 'timeout') key = `timeout ${item.timeoutName}`;
  else if (['http-request', 'http-response', 'http-after-response', 'tcp-request', 'tcp-response', 'http-check'].includes(item.keyword)) {
    key = `${item.keyword} ${item.action}`;
  } else if (item.keyword === 'stats') {
    key = `stats ${item.args[0] || ''}`.trim();
  } else if (item.keyword === 'http-response' || item.keyword === 'http-after-response') {
    key = `${item.keyword} ${item.action}`;
  }

  const found = DIRECTIVE_GUIDE[key] || DIRECTIVE_GUIDE[item.keyword];
  if (!found) {
    return {
      title: item.keyword,
      syntax: item.raw,
      summary: 'No built-in explanation for this directive yet. It is preserved exactly as written.',
      detail:
        'HAProxy has a large and version-specific directive set. Confirm the exact semantics in the configuration manual for the HAProxy version you run. The analyzer deliberately does not flag unknown directives.',
      tips: ['Use the official configuration manual for the deployed branch.', 'Validate every deployment with `haproxy -c -f <file>`.'],
      seeAlso: [],
      key,
    };
  }
  return {
    ...found,
    key,
    advanced: ADVANCED_GUIDE[item.keyword] || [],
  };
}

export function explainBindOption(option) {
  const options = {
    ssl: 'Enables TLS termination on this bind. Without `ssl`, HAProxy treats the socket as an opaque TCP stream.',
    crt: 'The PEM file containing a certificate and private key. Use one certificate per bind, or a crt-list for SNI selection.',
    'crt-list': 'A file listing multiple certificates and optional per-certificate options, selected by SNI.',
    alpn: 'Protocols advertised through ALPN, for example `h2,http/1.1` or `http/1.1`. Affects HTTP/2 negotiation.',
    verify: 'Client-certificate verification policy. `required` demands a valid client certificate; `optional` requests one.',
    'ca-file': 'CA bundle used to verify client certificates or upstream certificates.',
    'ssl-min-ver': 'Minimum TLS protocol version for this bind. Overrides the global default.',
    'ssl-max-ver': 'Maximum TLS protocol version for this bind.',
    'no-tls-tickets': 'Disables TLS session tickets. A cheap hardening default, at a small resumption cost.',
    'allow-0rtt': 'Allows TLS 1.3 early data on this bind. Understand replay risk before enabling.',
    'accept-proxy': 'Accepts the PROXY protocol header from the peer. Only enable behind a trusted proxy.',
    'prefer-client-ciphers': 'Let the client’s cipher preference drive selection. Usually fine for compatibility, but server preference can be part of a policy.',
  };
  return options[option] || null;
}

export function explainServerOption(option) {
  const options = {
    check: 'Enables active health checks for this server. Without it, check-related options do nothing.',
    ssl: 'HAProxy originates TLS to this server. Combine with verification options for a secure upstream connection.',
    verify: 'Verification policy for the upstream certificate, for example `verify required`.',
    backup: 'Uses this server only when no non-backup server is available.',
    weight: 'Relative share of traffic for weighted balancing. Higher weight receives proportionally more.',
    maxconn: 'Maximum concurrent connections HAProxy will send to this server; excess requests queue or go elsewhere.',
    disabled: 'Marks the server administratively down at startup.',
    'check-ssl': 'Use TLS for health checks to a TLS upstream.',
    inter: 'Interval between health checks.',
    fall: 'Number of consecutive failed checks before marking a server down.',
    rise: 'Number of consecutive successful checks before marking a server up.',
  };
  return options[option] || null;
}

export const DIRECTIVE_ENTRY_COUNT = Object.keys(DIRECTIVE_GUIDE).length;
export const SECTION_ENTRY_COUNT = Object.keys(SECTION_GUIDE).length;
