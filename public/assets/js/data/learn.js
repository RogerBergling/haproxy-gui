/**
 * Long-form learning articles. Blocks are rendered by pages/learn.js.
 * Inline markup supported in text: `code`, **bold**, [label](#/route).
 */

export const ARTICLES = [
  {
    slug: 'config-anatomy',
    title: 'How an HAProxy config actually works',
    eyebrow: 'Foundations',
    description: 'A request-centred mental model for global, defaults, frontend, backend and listen sections.',
    level: 'Beginner',
    minutes: 9,
    tags: ['sections', 'request lifecycle', 'mode', 'validation'],
    sections: [
      {
        id: 'mental-model',
        title: 'Start with a request, not with the file',
        blocks: [
          {
            t: 'p',
            text: 'The fastest way to understand a HAProxy configuration is to follow one connection through it. A client connects to a **bind** on a **frontend**. HAProxy decides whether it can inspect the traffic, evaluates routing rules, chooses a **backend**, selects a **server**, and then proxies bytes or HTTP messages until one side closes.',
          },
          {
            t: 'code',
            label: 'The path through a typical config',
            code: `client
  │ TCP + TLS ClientHello (SNI)
  ▼
frontend ft_edge          bind *:443, mode tcp
  │ inspect SNI, choose backend
  ▼
backend bk_example_tls    mode tcp
  │ forward encrypted bytes to loopback
  ▼
frontend ft_example_tls   bind 127.0.0.1:8443, ssl, mode http
  │ terminate TLS, read Host, choose backend
  ▼
backend bk_learning       mode http
  │ health check + balance
  ▼
server 192.0.2.40:8003`,
          },
          {
            t: 'p',
            text: 'This example has **two layers**: a TCP passthrough edge and an internal TLS-terminating frontend. That architecture appears throughout real configs when one public port must serve several unrelated TLS services while still allowing HTTP routing for selected hostnames.',
          },
          {
            t: 'note',
            tone: 'info',
            title: 'A config is a graph',
            text: 'Frontends point to backends through use_backend and default_backend. Backends point to servers and optionally back to internal frontends through loopback bridges. The Topology view draws exactly this graph.',
          },
        ],
      },
      {
        id: 'sections',
        title: 'The five sections you will meet first',
        blocks: [
          {
            t: 'table',
            head: ['Section', 'Role', 'Think of it as'],
            rows: [
              ['global', 'Process-wide settings: privileges, TLS defaults, logs, runtime socket, tuning', 'The machine room'],
              ['defaults', 'Inherited mode, timeouts, options and error pages', 'The policy template'],
              ['frontend', 'Client listener and routing decisions', 'The reception desk'],
              ['backend', 'Server pool, checks, balancing, stickiness', 'The work queue'],
              ['listen', 'Frontend + backend in one section', 'A short-hand office'],
            ],
          },
          {
            t: 'p',
            text: '`global` appears once. `defaults` applies to proxies that follow it. `frontend`, `backend`, `listen` and other named sections can appear many times. The first token on a line determines the section; indentation is cosmetic, not semantic.',
          },
          {
            t: 'p',
            text: 'The mode is inherited from defaults. If defaults says `mode http` and a frontend needs TLS passthrough, that frontend must explicitly say `mode tcp`. A frontend in TCP mode cannot evaluate Host headers or HTTP paths, and `http-request` rules inside it are a configuration error.',
          },
        ],
      },
      {
        id: 'routing',
        title: 'Routing is ordered, not declarative',
        blocks: [
          {
            t: 'p',
            text: 'A frontend evaluates `http-request` actions first, then `use_backend` rules in file order. The first matching rule wins. If nothing matches, `default_backend` is used. If that is absent too, an HTTP request returns 503 and a TCP connection fails.',
          },
          {
            t: 'code',
            label: 'Specific before wildcard',
            code: `# Good: exact hostname wins before the wildcard
use_backend bk_learning if { hdr(host) -i learning.example.com }
use_backend bk_wildcard if { hdr(host) -m end .example.com }
default_backend bk_unknown`,
          },
          {
            t: 'p',
            text: 'The suffix matcher `-m end .example.com` is safer than a naive `-i example.com` because it will not match `notexample.com`. For SNI, use `req_ssl_sni`; for HTTP, use `hdr(host)`. They are different values and exist at different layers.',
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Host and SNI can disagree',
            text: 'TLS passthrough can only route by SNI. A client can request one SNI and then send a different Host header after termination. That is why a shared TLS termination frontend may return 421 for hostnames that should never arrive there.',
          },
        ],
      },
      {
        id: 'lifecycle',
        title: 'What “defaults” does and does not do',
        blocks: [
          {
            t: 'p',
            text: 'Defaults supplies values at parse time. A proxy can override them with its own directive. This matters for timeouts and options: a backend may inherit a timeout from defaults, or define a different one. The Workbench Structure view shows the effective mode and highlights inherited values.',
          },
          {
            t: 'ul',
            items: [
              '`timeout connect`, `timeout client` and `timeout server` are inherited unless overridden.',
              '`option forwardfor` is usually set in defaults or per frontend.',
              '`log global` reuses the global log targets; it does not inherit an arbitrary per-frontend log line.',
              'Error files in defaults apply broadly; per-proxy overrides are possible.',
            ],
          },
        ],
      },
      {
        id: 'validate',
        title: 'Validate with HAProxy, simulate with the Workbench',
        blocks: [
          {
            t: 'p',
            text: 'The Workbench parser and analyzer are deliberately conservative: they catch structural and operational problems, but they are not the HAProxy compiler. Before deploying, always run the exact target binary:',
          },
          {
            t: 'code',
            label: 'Validate the real thing',
            code: `haproxy -vv
haproxy -c -f /etc/haproxy/haproxy.cfg
systemctl reload haproxy      # graceful; prefer reload over restart`,
          },
          {
            t: 'p',
            text: 'Then use **Simulate** for routing expectations: which frontend receives a request, which ACL matches, which backend and server are selected, and what happens when a server is marked down. The simulator follows the common language subset and labels unsupported expressions instead of pretending to know them.',
          },
        ],
      },
    ],
  },
  {
    slug: 'tls',
    title: 'TLS in HAProxy: terminate, pass through or re-encrypt',
    eyebrow: 'Certificates & encryption',
    description: 'SNI, certificate selection, client certificates, cipher policy and the three TLS architectures.',
    level: 'Intermediate',
    minutes: 12,
    tags: ['TLS', 'SNI', 'mTLS', 'crt-list', 'OCSP'],
    sections: [
      {
        id: 'three-models',
        title: 'Three architectures, three different capabilities',
        blocks: [
          {
            t: 'table',
            head: ['Model', 'Bind', 'HAProxy sees', 'Typical use'],
            rows: [
              ['Passthrough', 'TCP, no ssl', 'TLS ClientHello / SNI, opaque bytes', 'SSH over TLS, non-HTTP protocols, edge routing by SNI'],
              ['Termination', 'ssl crt ...', 'Full HTTP request and response', 'Web apps, header routing, WAF-ish policy, HSTS'],
              ['Re-encryption', 'ssl crate + server ssl', 'HTTP, plus a new TLS session upstream', 'Untrusted internal network, compliance'],
            ],
          },
          {
            t: 'p',
            text: 'The bind’s `ssl` option is the switch. If it is absent, HAProxy does not decrypt. If it is present, HAProxy needs a certificate and key, and the frontend can use HTTP mode. Adding `ssl` to what was meant to be a passthrough listener silently changes the architecture.',
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Do not half-configure TLS',
            text: 'An `ssl` bind without `crt` or `crt-list` has no certificate source. A global crt-base only sets a directory; it does not select a certificate. The analyzer flags this as an error.',
          },
        ],
      },
      {
        id: 'sni',
        title: 'SNI and certificate selection',
        blocks: [
          {
            t: 'p',
            text: 'SNI is sent by the client before encryption begins. In passthrough mode, HAProxy can read it and route without terminating. In termination mode, HAProxy uses it to choose from a `crt-list` when one bind serves many hostnames.',
          },
          {
            t: 'code',
            label: 'A crt-list for multiple names',
            code: `# /etc/haproxy/certs/sites.crtlist
/etc/haproxy/certs/example.com.pem example.com
/etc/haproxy/certs/wildcard.example.com.pem *.example.com
/etc/haproxy/certs/api.example.net.pem api.example.net

frontend ft_https
    bind *:443 ssl crt-list /etc/haproxy/certs/sites.crtlist alpn h2,http/1.1
    mode http`,
          },
          {
            t: 'p',
            text: 'A wildcard certificate covers exactly one label: `*.example.com` matches `learning.example.com` but not `example.com` or `a.b.example.com`. Always include the apex certificate separately if you serve it. Certificate selection happens on SNI, before the HTTP Host header is available.',
          },
        ],
      },
      {
        id: 'hardening',
        title: 'A defensible TLS baseline',
        blocks: [
          {
            t: 'code',
            label: 'Global defaults',
            code: `global
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets
    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305
    ssl-default-bind-ciphersuites TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256`,
          },
          {
            t: 'ul',
            items: [
              'Set an explicit minimum protocol; do not depend on the distribution’s OpenSSL defaults.',
              'Prefer AEAD suites and forward secrecy; avoid RC4, 3DES, export and static RSA exchange.',
              '`no-tls-tickets` is a simple default; if resumption is required, rotate ticket keys deliberately.',
              'A bind can override global options. Inspect both when auditing.',
              'TLS 1.3 suites are separate from the TLS 1.2 cipher list.',
            ],
          },
          {
            t: 'p',
            text: 'Test with a real client and a scanner. `openssl s_client -connect host:443 -servername host` verifies negotiation and certificate selection; a TLS scanner verifies the broader policy. Do not enable HSTS until the site is HTTPS-only and you accept the browser commitment.',
          },
        ],
      },
      {
        id: 'mtls',
        title: 'Client certificates are not automatically identity',
        blocks: [
          {
            t: 'p',
            text: 'A client certificate only authenticates the client if the TLS listener verifies it against a trusted CA. Forwarding `ssl_c_s_dn`, `ssl_c_i_dn` or `ssl_c_der` as headers does not prove anything by itself. If the bind does not require verification, those values can be absent or come from a different trust layer.',
          },
          {
            t: 'code',
            label: 'Verify clients on the bind',
            code: `bind *:443 ssl crt /etc/haproxy/certs/example.pem \\
     verify required ca-file /etc/haproxy/ca/clients.pem

# Only after verification, forward identity fields.
http-request del-header X-Client-DN
http-request set-header X-Client-DN %{+Q}[ssl_c_s_dn] if { ssl_fc_has_crt }`,
          },
          {
            t: 'note',
            tone: 'danger',
            title: 'Header trust boundary',
            text: 'If clients can reach HAProxy directly, they can send any header they like. Delete untrusted identity headers before setting your own, and make the backend trust them only from HAProxy.',
          },
        ],
      },
      {
        id: 'x-forwarded-proto',
        title: 'Forwarding the scheme safely',
        blocks: [
          {
            t: 'p',
            text: 'Applications need to know whether the original client used HTTPS. At a TLS-terminating frontend, set `X-Forwarded-Proto` from TLS state, not as an unconditional constant on a listener that also accepts plaintext:',
          },
          {
            t: 'code',
            label: 'Conditional is safer',
            code: `http-request set-header X-Forwarded-Proto https if { ssl_fc }
http-request set-header X-Forwarded-Proto http unless { ssl_fc }`,
          },
          {
            t: 'p',
            text: 'In the layered example, an internal loopback frontend may safely set the header unconditionally because the only path to it is the encrypted bridge. The analyzer takes bind addresses into account but still asks you to confirm that trust assumption.',
          },
        ],
      },
      {
        id: 'debug',
        title: 'TLS troubleshooting commands',
        blocks: [
          {
            t: 'code',
            label: 'Inspect negotiation',
            code: `# Which certificate and protocol are served?
openssl s_client -connect example.com:443 -servername example.com -showcerts

# Check ALPN (h2 vs http/1.1)
openssl s_client -connect example.com:443 -servername example.com -alpn h2

# Check expiry
openssl x509 -in /etc/haproxy/certs/example.pem -noout -subject -dates -ext subjectAltName`,
          },
          {
            t: 'ul',
            items: [
              'Certificate mismatch usually means SNI selection is missing or the wildcard does not cover the name.',
              'A handshake failure in passthrough can be an upstream certificate problem; HAProxy is not terminating.',
              'A 421 after TLS termination often means the Host does not match the certificate/service expectation.',
              'A missing client certificate appears as a TLS handshake failure when verification is required.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'routing',
    title: 'Routing, ACLs and trustworthy headers',
    eyebrow: 'Traffic policy',
    description: 'How use_backend order, inline ACLs, Host/SNI/path matching and header trust really behave.',
    level: 'Intermediate',
    minutes: 10,
    tags: ['ACL', 'use_backend', 'Host', 'SNI', 'headers'],
    sections: [
      {
        id: 'order',
        title: 'First match wins',
        blocks: [
          {
            t: 'p',
            text: '`use_backend` is an ordered list of guarded decisions. HAProxy tests conditions in file order and stops at the first true one. This has two consequences: specific rules should come before broad ones, and a broad `default_backend` is not a catch-all ACL—it is the fallback after every rule failed.',
          },
          {
            t: 'code',
            label: 'Specific before wildcard',
            code: `use_backend bk_admin if { hdr(host) -i admin.example.com }
use_backend bk_app   if { hdr(host) -m end .example.com }
use_backend bk_other if { hdr(host) -m end .example.net }
default_backend bk_unknown`,
          },
          {
            t: 'p',
            text: 'An unknown host should be explicit. A default backend that returns 404 or 421 is easier to monitor than silence, and it avoids accidentally forwarding all unmatched traffic to one application.',
          },
        ],
      },
      {
        id: 'acl-anatomy',
        title: 'ACL anatomy',
        blocks: [
          {
            t: 'p',
            text: 'An ACL combines a sample fetch, matching flags and values. Inline conditions use braces; named ACLs are defined separately and referenced by name. Multiple definitions with the same ACL name are ORed.',
          },
          {
            t: 'table',
            head: ['Construct', 'Meaning', 'Example'],
            rows: [
              ['hdr(host) -i', 'Exact host, case-insensitive', '{ hdr(host) -i learning.example.com }'],
              ['hdr(host) -m end', 'Host suffix', '{ hdr(host) -m end .example.com }'],
              ['req_ssl_sni -i', 'SNI before termination', '{ req_ssl_sni -i ssh.example.net }'],
              ['path_beg', 'Path prefix (HTTP only)', '{ path_beg /api }'],
              ['src', 'Client address / CIDR', '{ src 192.0.2.0/24 }'],
              ['method', 'HTTP method', '{ method POST }'],
              ['ssl_fc', 'TLS terminated', '{ ssl_fc }'],
            ],
          },
          {
            t: 'note',
            tone: 'info',
            title: 'ACL scope',
            text: 'Named ACLs live in the proxy where they are defined. A frontend cannot use a backend’s ACL without redefining it. The analyzer reports references to undefined named ACLs.',
          },
        ],
      },
      {
        id: 'conditions',
        title: 'Conditions combine with AND, OR and NOT',
        blocks: [
          {
            t: 'p',
            text: 'Whitespace between terms means AND. `||` (or `or`) separates alternatives. A leading `!` negates a term or a named ACL. Grouping braces are per inline expression. Keep complex conditions short enough to test; a simulator and a staging environment are more valuable than clever syntax.',
          },
          {
            t: 'code',
            label: 'Compound conditions',
            code: `acl is_api path_beg /api
use_backend bk_api if is_api { hdr(host) -i api.example.com }
use_backend bk_internal if { src 192.0.2.0/24 } { path_beg /admin }
use_backend bk_other unless { hdr(host) -m end .example.com }`,
          },
          {
            t: 'p',
            text: 'In the Workbench simulator, supported ACLs produce a pass/fail trace. Unsupported expressions are reported as unsupported and treated as not matching. That conservative choice prevents a misleading “route matched” result.',
          },
        ],
      },
      {
        id: 'headers',
        title: 'Host, SNI, X-Forwarded-* and trust',
        blocks: [
          {
            t: 'ul',
            items: [
              '**Host** is an HTTP header. It exists only after HTTP parsing (and therefore after TLS termination or on plaintext HTTP).',
              '**SNI** is a TLS handshake value. It exists before decryption and is the only host-like signal in passthrough.',
              '**X-Forwarded-For** is not authentication. Strip inbound values at the edge and append the real client address.',
              '**X-Forwarded-Proto** set unconditionally on a public plaintext listener is a security bug; gate it on `ssl_fc` or a trusted terminator.',
              '**X-Client-IP** is a custom name; it is only trustworthy if HAProxy controls it end-to-end.',
            ],
          },
          {
            t: 'code',
            label: 'Sanitise, then set',
            code: `http-request del-header X-Forwarded-For
http-request del-header X-Forwarded-Proto
http-request set-header X-Forwarded-Proto https if { ssl_fc }
option forwardfor`,
          },
          {
            t: 'p',
            text: 'Backends must also be configured to trust only the proxy. A header is a convention, not a cryptographic proof. When identity matters, terminate TLS and verify client certificates, or use a signed token from the identity layer.',
          },
        ],
      },
      {
        id: 'fallbacks',
        title: 'Designing fallbacks that fail visibly',
        blocks: [
          {
            t: 'p',
            text: 'Every shared frontend needs a deliberate unknown path. Three useful patterns:',
          },
          {
            t: 'ul',
            items: [
              '`http-request return status 404 string "Unknown host"` — explicit, cheap, easy to monitor.',
              '`http-request return status 421` for a host that should never reach this TLS terminator.',
              'A TCP default backend with `tcp-request content reject` for unknown SNI on a passthrough edge.',
            ],
          },
          {
            t: 'p',
            text: 'Avoid forwarding unknown traffic to the first application in the list. That turns a routing mistake into a confusing application-level 404 and can expose the wrong service.',
          },
        ],
      },
    ],
  },
  {
    slug: 'load-balancing',
    title: 'Health checks, balancing and session affinity',
    eyebrow: 'Availability',
    description: 'What check really enables, how fall/rise affect failover, and when stickiness helps or hurts.',
    level: 'Intermediate',
    minutes: 11,
    tags: ['health checks', 'balance', 'stick table', 'cookies'],
    sections: [
      {
        id: 'checks',
        title: 'Check options do nothing until `check` is enabled',
        blocks: [
          {
            t: 'p',
            text: 'This is the single most common health-check mistake. `option httpchk` or `option tcp-check` configures how a check behaves, but each server needs `check`. Without it, HAProxy sends traffic until a request fails.',
          },
          {
            t: 'code',
            label: 'Correct and incorrect',
            code: `backend bk_app
    mode http
    option httpchk GET /health
    # Wrong: no server has check
    server app1 192.0.2.10:8080

    # Right: checks are active
    server app1 192.0.2.10:8080 check inter 5s fall 3 rise 3

backend bk_db
    mode tcp
    option tcp-check
    server db1 192.0.2.20:5432 check inter 5s fall 3 rise 2`,
          },
          {
            t: 'p',
            text: 'A TCP connect check proves the port accepts connections. An HTTP check can prove the application returns a healthy status. Neither proves that a dependency such as a database is ready, so choose a health endpoint whose semantics match your routing goal.',
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Bare option httpchk sends OPTIONS /',
            text: '`option httpchk` without a method and URI sends `OPTIONS / HTTP/1.0` and only accepts 2xx/3xx responses. Many applications return 401, 404 or 405 for that request, so adding `check` can mark a healthy single-server app DOWN. Use an explicit request such as `option httpchk GET /health` plus `http-check expect status 200`, or use a plain TCP check instead. See [Health checks that do not break apps](#/learn/health-checks-safe).',
          },
        ],
      },
      {
        id: 'timing',
        title: 'inter, fall, rise and timeout check',
        blocks: [
          {
            t: 'table',
            head: ['Setting', 'Meaning', 'Trade-off'],
            rows: [
              ['inter', 'Time between checks', 'Shorter detects faster but adds probe load'],
              ['fall', 'Consecutive failures before DOWN', 'Higher avoids flapping, delays removal'],
              ['rise', 'Consecutive successes before UP', 'Higher avoids premature return to service'],
              ['timeout check', 'Maximum check duration', 'Too short marks slow-but-healthy servers down'],
              ['fastinter/downinter', 'Faster probing while transitioning/down', 'More probes during incidents'],
            ],
          },
          {
            t: 'p',
            text: 'Detection time is not simply `inter × fall`: checks can be delayed by connection setup and timeouts. Size the budget from your availability target and monitor the actual behaviour. A 2s/3-failure policy can still take several seconds to remove a dead server.',
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Backup servers and maxconn',
            text: 'Backups are used only when no primary is available. Server maxconn protects applications but can create queueing and 503s. Understand both before assuming the pool is elastic.',
          },
        ],
      },
      {
        id: 'algorithms',
        title: 'Choosing an algorithm',
        blocks: [
          {
            t: 'table',
            head: ['Algorithm', 'Good for', 'Watch out for'],
            rows: [
              ['roundrobin', 'Similar, stateless requests', 'Slow servers accumulate work'],
              ['leastconn', 'Long-lived or variable-cost connections', 'Keep-alive reuse can obscure request load'],
              ['source', 'Protocols without cookies that need weak affinity', 'NAT collapses many users onto one server'],
              ['uri/hdr hash', 'Cache locality or shard affinity', 'Hot keys and rebalancing on pool changes'],
              ['random', 'Large pools with simple needs', 'Less predictable distribution'],
            ],
          },
          {
            t: 'p',
            text: 'If the application stores sessions locally, cookie persistence is usually better than source hashing. If the application is stateless, affinity is unnecessary complexity. If it is stateful and cannot move sessions, fix that before adding more proxy affinity.',
          },
        ],
      },
      {
        id: 'stickiness',
        title: 'Stick tables and cookie persistence',
        blocks: [
          {
            t: 'p',
            text: 'A stick table maps a key (source address, cookie, header) to a server and optionally stores counters. Always set `size` and `expire`: the keys may be influenced by clients, and an unbounded table is a memory risk. Replication to peers adds resilience but also network and failover complexity.',
          },
          {
            t: 'code',
            label: 'Bounded cookie stickiness',
            code: `backend nodes
    mode http
    balance leastconn
    stick-table type string len 64 size 5M expire 30m
    stick store-response res.cook(SID) table nodes
    stick on req.cook(SID) table nodes
    server node-1 192.0.2.30:2801 check
    server node-2 192.0.2.31:2801 check backup`,
          },
          {
            t: 'p',
            text: 'When a pinned server fails, decide whether to break affinity (route elsewhere) or return an error. HAProxy can redispatch, but the application must tolerate it. Cookie persistence is not an availability strategy by itself.',
          },
        ],
      },
      {
        id: 'operations',
        title: 'Draining and changing pools safely',
        blocks: [
          {
            t: 'ol',
            items: [
              'Put the server into drain/maintenance through the Runtime API or stats page so new requests stop arriving.',
              'Wait for in-flight requests and queue time to settle; watch logs and metrics.',
              'Deploy or remove the server.',
              'Bring it back, verify health checks, then remove maintenance/drain state gradually.',
              'Validate the rebalanced pool; leastconn and hash algorithms can shift load unevenly.',
            ],
          },
          {
            t: 'p',
            text: 'The Workbench simulation lets you mark servers down and see the selected failover target, 503 or default response. It does not model real health-check timers or queueing; use it to verify routing intent, then test the timers in staging.',
          },
        ],
      },
    ],
  },
  {
    slug: 'health-checks-safe',
    title: 'Health checks that do not break apps',
    eyebrow: 'Availability',
    description: 'Why a check can mark a healthy server DOWN, how bare option httpchk behaves, and a safe rollout checklist.',
    level: 'Intermediate',
    minutes: 12,
    tags: ['health checks', 'option httpchk', 'fall', 'rise', 'timeout check', 'single server'],
    sections: [
      {
        id: 'what-check-does',
        title: 'What `check` actually probes',
        blocks: [
          {
            t: 'p',
            text: '`option httpchk` and `option tcp-check` only describe a probe. The server line must contain `check` for HAProxy to run it. Without `check`, those options are inert and HAProxy only discovers failures when a client request fails.',
          },
          {
            t: 'code',
            label: 'Inert options versus active checks',
            code: `# Inert: option httpchk is present, but HAProxy never probes
backend bk_app
    mode http
    option httpchk
    server app1 192.0.2.10:8000

# Active TCP connect check
backend bk_tcp
    mode tcp
    server db1 192.0.2.20:5432 check inter 5s fall 3 rise 2

# Active HTTP check with an explicit request
backend bk_http
    mode http
    option httpchk GET /health
    http-check expect status 200
    server app1 192.0.2.10:8000 check inter 5s fall 3 rise 3`,
          },
          {
            t: 'p',
            text: 'A plain `check` in HTTP mode is still a TCP connect check. It proves that the port accepts connections, not that the application can serve requests. An HTTP check is more meaningful, but only if the endpoint is cheap and honest.',
          },
        ],
      },
      {
        id: 'bare-httpchk',
        title: 'The bare `option httpchk` trap',
        blocks: [
          {
            t: 'p',
            text: 'A bare `option httpchk` does not send `GET /health`. It sends `OPTIONS / HTTP/1.0` by default. HAProxy treats only 2xx and 3xx responses as healthy. A 401, 403, 404 or 405 fails the check.',
          },
          {
            t: 'table',
            head: ['Application response to OPTIONS /', 'HAProxy result'],
            rows: [
              ['200 or 302', 'Healthy'],
              ['401 or 403', 'Failed — authentication is required'],
              ['404', 'Failed — no route for OPTIONS /'],
              ['405', 'Failed — method not allowed'],
              ['500 or timeout', 'Failed'],
            ],
          },
          {
            t: 'p',
            text: 'This is why the same change can break some services and not others. A framework that answers `OPTIONS /` with 200 or 302 stays UP; an app that returns 404/405 or requires authentication goes DOWN. A single-server backend then has nowhere else to send traffic, so users get 503.',
          },
          {
            t: 'note',
            tone: 'danger',
            title: 'A false positive can be a full outage',
            text: '`inter 2s fall 3` removes a server after roughly six seconds of failures. If that server is the only one in the backend, the application is unavailable. Multi-server backends hide the same false positive by shifting traffic — until the remaining servers are overloaded.',
          },
          {
            t: 'code',
            label: 'Bad, safe HTTP, and safe TCP',
            code: `# Dangerous: sends OPTIONS / and accepts only 2xx/3xx
backend bk_sendpass
    mode http
    option httpchk
    server sendpass 192.0.2.40:8000 check inter 2s fall 3 rise 2

# Safe HTTP check: explicit request and expected status
backend bk_sendpass
    mode http
    option httpchk GET /health
    http-check expect status 200
    server sendpass 192.0.2.40:8000 check inter 5s fall 3 rise 3

# Safe TCP check: proves only that the port accepts connections
backend bk_sendpass
    mode http
    server sendpass 192.0.2.40:8000 check inter 5s fall 3 rise 3`,
          },
          {
            t: 'p',
            text: 'If the application routes by virtual host, add the Host header explicitly: `http-check send hdr Host app.example.com`. For a TLS upstream, add `check-ssl` (and `check-sni` when the application requires SNI) to the server line.',
          },
        ],
      },
      {
        id: 'timing',
        title: 'inter, fall, rise and timeout check',
        blocks: [
          {
            t: 'table',
            head: ['Setting', 'Meaning', 'Trade-off'],
            rows: [
              ['inter', 'Time between checks', 'Shorter detects faster but adds probe load'],
              ['fall', 'Consecutive failures before DOWN', 'Higher avoids flapping, delays removal'],
              ['rise', 'Consecutive successes before UP', 'Higher avoids premature return to service'],
              ['timeout check', 'Maximum check duration', 'Too short marks slow-but-healthy servers down'],
              ['fastinter/downinter', 'Faster probing while transitioning/down', 'More probes during incidents'],
            ],
          },
          {
            t: 'p',
            text: '`timeout check` defaults to the value of `inter` when it is not set. With `inter 2s`, every check must complete within two seconds. A GC pause, database lock or cold cache can exceed that and fail a healthy server. Set `timeout check` explicitly from the endpoint’s measured latency, not from a guess.',
          },
          {
            t: 'p',
            text: 'Detection time is not exactly `inter × fall`: checks can be delayed by connection setup, timeouts and scheduling. Measure it in staging rather than assuming the arithmetic.',
          },
        ],
      },
      {
        id: 'probe-side-effects',
        title: 'Probes are real traffic',
        blocks: [
          {
            t: 'ul',
            items: [
              'Apps that log every connection can fill disks or trigger alerts.',
              'Per-IP rate limits, fail2ban or a WAF can ban the HAProxy address.',
              'Single-threaded apps or small accept backlogs can be affected by frequent probes under load.',
              'TLS handshakes, authentication and database work make a probe expensive.',
              'Health endpoints that create sessions, write data or depend on a shared database can cause side effects or cascade failures.',
              'Some protocols log connect-and-close probes as errors; use a protocol-aware check or accept the noise.',
            ],
          },
        ],
      },
      {
        id: 'blast-radius',
        title: 'Blast radius: one server or many',
        blocks: [
          {
            t: 'p',
            text: 'On a multi-server backend, a false positive removes one server and the rest absorb the traffic. On a single-server backend, the same event is a full outage. Removing one server can also overload the remaining pool, causing their checks to fail too.',
          },
          {
            t: 'p',
            text: 'Before enabling a check, ask: how many servers are behind this backend, how much spare capacity remains, and does the application keep session state locally?',
          },
        ],
      },
      {
        id: 'safe-rollout',
        title: 'A safe rollout checklist',
        blocks: [
          {
            t: 'checklist',
            items: [
              'Choose an endpoint that returns the expected status without authentication, writes or expensive work.',
              'Test the exact request from the HAProxy host with curl, including Host and TLS/SNI if relevant.',
              'Configure an explicit request: `option httpchk GET /health` and `http-check expect status 200`.',
              'Set an explicit `timeout check` above the endpoint’s normal response time.',
              'Start conservatively: `inter 5s fall 3 rise 3` is usually safer than 2s/3/2 for application checks.',
              'If the app warms up slowly, add `slowstart` so it does not receive full traffic immediately after UP.',
              'Run `haproxy -c -f` with the target binary and test in staging.',
              'Watch `check_status`, `check_duration` and `lastchg` in the stats page during the first deployment.',
            ],
          },
        ],
      },
      {
        id: 'patterns',
        title: 'Three safe patterns',
        blocks: [
          {
            t: 'code',
            label: 'HTTP, TCP and TLS upstream checks',
            code: `# HTTP application check
backend bk_app_http
    mode http
    option httpchk GET /health
    http-check expect status 200
    server app1 192.0.2.10:8000 check inter 5s fall 3 rise 3

# TCP connect check
backend bk_app_tcp
    mode tcp
    server app1 192.0.2.10:8000 check inter 5s fall 3 rise 3

# HTTPS upstream check
backend bk_app_https
    mode http
    option httpchk GET /health
    http-check expect status 200
    server app1 192.0.2.10:443 ssl check check-ssl check-sni app.example.com inter 5s fall 3 rise 3`,
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'TCP checks are shallow',
            text: 'A TCP connect check stays green when the application is deadlocked, out of database connections or returning 500s, as long as the kernel still accepts connections. Use it when a port check is the right level of confidence, not as a substitute for application readiness.',
          },
        ],
      },
      {
        id: 'when-not',
        title: 'When not to use an active check',
        blocks: [
          {
            t: 'p',
            text: 'If an application cannot tolerate probes, or a single server cannot afford a false positive, a longer interval and higher fall count may be safer. A plain TCP check is less precise but less intrusive. Passive observation and application metrics can complement active checks; they are not a substitute for understanding the failure mode.',
          },
          {
            t: 'p',
            text: 'Do not use a health check to test a dependency that is shared by every server unless you want a shared outage to remove the whole pool. Readiness checks should answer “should this server receive traffic now?”, not “is every dependency perfect?”.',
          },
        ],
      },
    ],
  },
  {
    slug: 'timeouts-logging',
    title: 'Timeouts and logs: making failures legible',
    eyebrow: 'Reliability',
    description: 'Each timeout’s scope, recommended starting values, and the log fields that answer “what happened?”.',
    level: 'Intermediate',
    minutes: 10,
    tags: ['timeouts', 'logs', '503', '504', 'slowloris'],
    sections: [
      {
        id: 'timeouts',
        title: 'A timeout is a policy, not boilerplate',
        blocks: [
          {
            t: 'p',
            text: 'Timeouts decide when HAProxy gives up waiting. They protect memory and connections, determine how quickly failures surface, and shape retry/failover behaviour. Copying numbers from a blog without knowing the protocol is how 30-second jobs start returning 504.',
          },
          {
            t: 'table',
            head: ['Timeout', 'Starts/applies', 'Typical starting point'],
            rows: [
              ['connect', 'Connect to a server (including upstream TLS handshake)', '3–5s internal'],
              ['client', 'Inactivity on the client side', '30–60s HTTP; protocol-specific for TCP'],
              ['server', 'Inactivity waiting for the server', '30–60s; longer for known slow work'],
              ['http-request', 'Completing request headers', '10s'],
              ['http-keep-alive', 'Idle between keep-alive requests', '30s'],
              ['tunnel', 'WebSocket/CONNECT/TCP after tunnel mode', 'Protocol-specific; finite'],
              ['check', 'A single health-check attempt', '1–2s, less than inter'],
            ],
          },
          {
            t: 'note',
            tone: 'info',
            title: 'No unit means milliseconds',
            text: 'HAProxy interprets a bare number as milliseconds. `timeout connect 5000` is five seconds. Writing `30` for a 30-second timeout gives you 30 ms. Always include a unit.',
          },
        ],
      },
      {
        id: 'map',
        title: 'Map symptoms to the right timer',
        blocks: [
          {
            t: 'table',
            head: ['Symptom', 'Likely timer or cause'],
            rows: [
              ['503 quickly', 'No healthy servers, no server lines, no default backend, routing mistake'],
              ['502', 'Upstream connection failure, protocol mismatch, TLS rejection, bad health state'],
              ['504 after waiting', 'Server not responding; timeout server, application stall, queueing'],
              ['408', 'Client too slow to send headers; timeout http-request or network'],
              ['Connection dropped mid-stream', 'client/server/tunnel timeout, hard-stop-after, process restart'],
              ['Frequent failover', 'Check timing too aggressive, timeout check too short, application flapping'],
            ],
          },
          {
            t: 'p',
            text: 'A quick 503 is routing/health. A slow 504 is application latency or a too-short server timeout. A 502 is usually connect/protocol. Getting the class right avoids changing the wrong timeout.',
          },
        ],
      },
      {
        id: 'logging',
        title: 'Logs that answer the next question',
        blocks: [
          {
            t: 'p',
            text: '`option httplog` is a good start, but timers and backend/server names make it actionable. In TCP passthrough, use `option tcplog` plus SNI capture and a custom log-format because no HTTP status exists.',
          },
          {
            t: 'code',
            label: 'A practical HTTP log format',
            code: `defaults
    option httplog
    log-format "%ci:%cp [%tr] %ft %b/%s %TR/%Tw/%Tc/%Tr/%Ta %ST %B %tsc %{+Q}r"

frontend ft_edge
    mode tcp
    tcp-request inspect-delay 1s
    tcp-request content capture req.ssl_sni len 100
    log-format "src=%ci dst=%fi:%fp sni=%[capture.req.hdr(0)]"`,
          },
          {
            t: 'ul',
            items: [
              '`%TR` total request time, `%Tw` queue wait, `%Tc` connect, `%Tr` server response, `%Ta` active time.',
              '`%ST` status, `%B` bytes, `%tsc` termination state and cookie status.',
              'Do not log full cookies, authorization headers or personal data by default.',
              'A log pipeline that drops messages silently is worse than no plan; monitor it.',
            ],
          },
        ],
      },
      {
        id: 'dontlognull',
        title: 'Noise reduction without going blind',
        blocks: [
          {
            t: 'p',
            text: '`option dontlognull` suppresses connections that close without sending data. `option dontlog-normal` suppresses successful requests. Both reduce volume, and both remove context. If you enable them, pair them with metrics that still capture traffic, error rates, latency and health-check state.',
          },
          {
            t: 'p',
            text: 'Health-check probes can produce their own noise. Use a dedicated endpoint and log aggregation rather than suppressing all errors to hide probes.',
          },
        ],
      },
    ],
  },
  {
    slug: 'security',
    title: 'A security review checklist for HAProxy',
    eyebrow: 'Hardening',
    description: 'Trust boundaries, TLS policy, admin access, header injection and the things scanners do not see.',
    level: 'Advanced',
    minutes: 12,
    tags: ['security', 'mTLS', 'headers', 'runtime API'],
    sections: [
      {
        id: 'trust',
        title: 'Draw the trust boundaries first',
        blocks: [
          {
            t: 'p',
            text: 'HAProxy sits between untrusted clients and applications. Every header, source address and certificate field has a trust boundary. A secure config makes those boundaries explicit rather than assuming the network is friendly.',
          },
          {
            t: 'ul',
            items: [
              'Internet → HAProxy: everything is attacker-controlled until verified: Host, SNI, headers, cookies, TLS client certs.',
              'HAProxy → application: headers are only trustworthy if HAProxy controls them end-to-end and the app trusts only HAProxy.',
              'Operator → runtime socket: this is production control; a world-writable admin socket is a critical issue.',
              'HAProxy → upstream TLS: verification must be configured explicitly; `ssl` alone encrypts but may not authenticate the server.',
            ],
          },
        ],
      },
      {
        id: 'tls',
        title: 'TLS and certificate hygiene',
        blocks: [
          {
            t: 'ul',
            items: [
              'Require TLS 1.2+; disable TLS tickets unless you rotate keys deliberately.',
              'Use AEAD/forward-secret cipher suites and verify the effective policy with a scanner.',
              'A bind with `ssl` needs `crt`/`crt-list`; a global base directory is not a certificate.',
              'Do not treat forwarded certificate fields as identity unless `verify required` is enabled.',
              'Set HSTS only on HTTPS-only hosts and start with a conservative max-age.',
              'Protect private keys; avoid embedding key material in a config or repo.',
            ],
          },
          {
            t: 'p',
            text: 'The analyzer flags missing certificate sources, weak TLS options and unverified client-certificate headers. A TLS scanner is still required to see what an actual client negotiates.',
          },
        ],
      },
      {
        id: 'headers',
        title: 'Header injection and forwarding trust',
        blocks: [
          {
            t: 'p',
            text: 'Headers beginning with X- are conventions, not security. Attackers can send X-Forwarded-For, X-Forwarded-Proto, X-Client-IP and even certificate-like headers. HAProxy must delete untrusted values before setting its own, and the application must trust them only from HAProxy.',
          },
          {
            t: 'code',
            label: 'Sanitise at the boundary',
            code: `http-request del-header X-Forwarded-For
http-request del-header X-Forwarded-Proto
http-request del-header X-Client-IP
http-request del-header X-Client-DN

http-request set-header X-Forwarded-Proto https if { ssl_fc }
option forwardfor`,
          },
          {
            t: 'note',
            tone: 'danger',
            title: 'Unconditional scheme rewriting',
            text: 'Setting X-Forwarded-Proto: https on a frontend that can receive plaintext lets an attacker make the application believe the connection was secure. Gate it on SSL or scope the frontend to a loopback bind behind a trusted terminator.',
          },
        ],
      },
      {
        id: 'admin',
        title: 'The runtime socket is a root console',
        blocks: [
          {
            t: 'p',
            text: '`stats socket ... level admin` can change server state and weights, inspect stick tables and run powerful commands. Protect it with filesystem permissions and a dedicated group. Do not expose it over TCP without strong authentication and network controls.',
          },
          {
            t: 'code',
            label: 'A restricted socket',
            code: `global
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s`,
          },
          {
            t: 'p',
            text: '`expose-fd listeners` is needed for some seamless reload workflows but expands what the socket can do. Enable it deliberately. If monitoring only needs read access, consider a separate operator-level socket.',
          },
        ],
      },
      {
        id: 'checklist',
        title: 'Review checklist',
        blocks: [
          {
            t: 'checklist',
            items: [
              'TLS 1.2+ with an explicit cipher policy and no weak suites.',
              'Certificates selected by SNI; wildcard coverage verified for every hostname.',
              'Client certificates verified before forwarding identity fields.',
              'X-Forwarded-* / identity headers sanitised at the edge.',
              'X-Forwarded-Proto conditional on SSL or a trusted internal path.',
              'Admin socket mode 660 (or stricter) and a dedicated group.',
              'No plaintext passwords or private keys in the config.',
              'Unknown hosts and SNI rejected explicitly; default backend not accidentally serving the wrong app.',
              'Runtime API access monitored and limited.',
              'Version has no known critical security fixes outstanding.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'performance',
    title: 'Capacity and performance without folklore',
    eyebrow: 'Tuning',
    description: 'maxconn, threads, buffers, connection reuse and a measurement-first tuning loop.',
    level: 'Advanced',
    minutes: 9,
    tags: ['maxconn', 'threads', 'http-reuse', 'buffers'],
    sections: [
      {
        id: 'limits',
        title: 'Limits first, tuning second',
        blocks: [
          {
            t: 'p',
            text: 'A proxy that runs out of file descriptors or memory fails unpredictably. Set `maxconn` in global and consider per-frontend/backend limits so one service cannot consume the process. Size from file-descriptor limits, memory per connection, thread count and application capacity.',
          },
          {
            t: 'code',
            label: 'A capacity outline',
            code: `global
    maxconn 50000
    nbthread 4

defaults
    maxconn 50000
    timeout client 30s
    timeout server 30s

frontend ft_public
    maxconn 40000
    bind *:443 ssl crt-list /etc/haproxy/certs/sites.crtlist`,
          },
          {
            t: 'p',
            text: 'These numbers are illustrative. The right values come from load tests that include TLS handshakes, large headers, slow clients and failure scenarios, not from a generic table.',
          },
        ],
      },
      {
        id: 'reuse',
        title: 'Connection reuse and keep-alive',
        blocks: [
          {
            t: 'p',
            text: 'Reusing backend connections saves handshakes and application accept load. `http-reuse safe` is a reasonable default for mixed estates; `never` is a compatibility escape hatch and can hurt latency under load. Connection reuse interacts with server maxconn and leastconn: a reused connection still occupies an upstream slot.',
          },
          {
            t: 'ul',
            items: [
              'Keep-alive on the client side reduces TLS handshakes but holds memory.',
              'Keep-alive on the server side must be supported by the application.',
              '`option http-server-close` trades reuse for compatibility.',
              'Measure upstream connection counts, queue time and handshake latency.',
            ],
          },
        ],
      },
      {
        id: 'buffers',
        title: 'Buffers, headers and memory',
        blocks: [
          {
            t: 'p',
            text: '`tune.bufsize` sets the per-connection buffer size. Increasing it for large cookies or headers multiplies memory across concurrent connections and buffers. Fix oversized headers at the source when possible, and validate memory under realistic concurrency.',
          },
          {
            t: 'p',
            text: 'Threads are not free performance: more threads can contend on shared state, and container CPU limits can make oversubscription worse. Newer HAProxy branches improve thread-group scalability and CPU binding; use those features only after measuring.',
          },
        ],
      },
      {
        id: 'method',
        title: 'A tuning loop that does not guess',
        blocks: [
          {
            t: 'ol',
            items: [
              'Define the metric: p95 latency, requests per second, error rate, queue time, CPU, memory.',
              'Capture a baseline with production-like TLS, headers and backend behaviour.',
              'Change one variable: maxconn, threads, reuse, buffer, timeout or balance.',
              'Re-run the same test and compare distributions, not averages.',
              'Test failure injection: one server down, slow backend, TLS handshake storm, connection exhaustion.',
              'Keep the change only if it improves the metric without hiding failure behaviour.',
            ],
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Simulation is not a load test',
            text: 'The Workbench simulator validates routing and failure choices, not throughput, TLS cost or queueing. Use a load generator and a staging HAProxy for capacity decisions.',
          },
        ],
      },
    ],
  },
  {
    slug: 'operations',
    title: 'Running HAProxy day to day',
    eyebrow: 'Operations',
    description: 'Validation, graceful reloads, the runtime API, certificate rotation and change management.',
    level: 'Intermediate',
    minutes: 10,
    tags: ['reload', 'runtime API', 'certificates', 'monitoring'],
    sections: [
      {
        id: 'validate',
        title: 'The non-negotiable validation step',
        blocks: [
          {
            t: 'p',
            text: 'HAProxy is strict and version-specific. Always validate with the exact binary and branch that production runs. A config that passes on your laptop’s 3.4 may fail on a server’s 2.8, and vice versa.',
          },
          {
            t: 'code',
            label: 'Before every reload',
            code: `haproxy -vv
haproxy -c -f /etc/haproxy/haproxy.cfg
# Inspect warnings too; -c exits 0 on some warnings.
# Then reload gracefully:
systemctl reload haproxy
# or, in a container, send the signal your entrypoint expects.`,
          },
          {
            t: 'p',
            text: 'Keep the previous validated config for rollback. The Workbench history is useful for review, but production rollback should use your configuration management and a known-good file.',
          },
        ],
      },
      {
        id: 'reload',
        title: 'Reload is not restart',
        blocks: [
          {
            t: 'p',
            text: 'A graceful reload starts a new worker, passes listening sockets and lets the old worker drain. A restart drops active connections. Use `-W`/`-Ws` or the distribution’s unit to enable master-worker behaviour. `hard-stop-after` bounds how long old workers may remain.',
          },
          {
            t: 'ul',
            items: [
              'Monitor old-worker lifetime; long-lived streams can delay a reload.',
              'Certificate and map file changes may need an explicit reload.',
              'A reload with an invalid config should leave the old worker serving; verify that your unit and orchestration behave that way.',
              'In containers, respect the entrypoint’s signal handling and readiness probe.',
            ],
          },
        ],
      },
      {
        id: 'runtime',
        title: 'The runtime API and safe live changes',
        blocks: [
          {
            t: 'p',
            text: 'The stats socket can drain servers, change weights and inspect state without a reload. Great for incident handling, dangerous if exposed. Use a helper script with validation and audit logging rather than ad-hoc commands in production.',
          },
          {
            t: 'code',
            label: 'Common operator actions',
            code: `echo "show info" | socat stdio /run/haproxy/admin.sock
echo "show servers state" | socat stdio /run/haproxy/admin.sock
echo "set server nodes/node-1 state drain" | socat stdio /run/haproxy/admin.sock
echo "set server nodes/node-1 state ready" | socat stdio /run/haproxy/admin.sock`,
          },
          {
            t: 'note',
            tone: 'warn',
            title: 'Runtime changes are ephemeral',
            text: 'State changed through the runtime API is not the config file. A reload can reset it. Record emergency changes and apply them to the managed config if they should persist.',
          },
        ],
      },
      {
        id: 'certificates',
        title: 'Certificate rotation',
        blocks: [
          {
            t: 'ol',
            items: [
              'Issue the new certificate with the same SANs and a valid chain.',
              'Deploy it atomically so readers never see a partial file.',
              'Validate the file and private key match.',
              'Reload HAProxy or update the certificate store/runtime if supported.',
              'Verify with openssl using the correct SNI.',
              'Keep the previous certificate until the new one has survived a rollback window.',
            ],
          },
          {
            t: 'code',
            label: 'Verify before reload',
            code: `openssl x509 -in cert.pem -noout -subject -dates -ext subjectAltName
openssl x509 -in cert.pem -noout -pubkey | sha256sum
openssl pkey -in cert.pem -pubout | sha256sum`,
          },
        ],
      },
      {
        id: 'observability',
        title: 'Health, metrics and alerting',
        blocks: [
          {
            t: 'ul',
            items: [
              'Use a liveness/readiness endpoint that reflects the proxy’s ability to serve, not just process existence.',
              'Export stats (Prometheus, stats page, Runtime API) and alert on server state, 5xx rate, queue time and reload failures.',
              'Log validation/reload outcomes separately from traffic logs.',
              'Watch certificate expiry and health-check flap rates.',
              'A monitor-uri that only checks HAProxy’s process can report healthy while every backend is down.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'versions',
    title: 'HAProxy versions and the 2.x → 3.x upgrade',
    eyebrow: 'Version guide',
    description: 'LTS branches, what changed, and a practical checklist for moving from HAProxy 2 to 3.',
    level: 'Intermediate',
    minutes: 8,
    tags: ['upgrade', '3.0', '3.2', '3.4', 'LTS'],
    sections: [
      {
        id: 'branches',
        title: 'LTS versus feature branches',
        blocks: [
          {
            t: 'p',
            text: 'Even-numbered branches are LTS releases maintained for five years: 2.6, 2.8, 3.0, 3.2 and 3.4. Odd-numbered branches add features with shorter support. New production deployments normally choose the latest LTS; existing estates should at least be on a supported LTS with current patch releases.',
          },
          {
            t: 'table',
            head: ['Branch', 'Type', 'Support'],
            rows: [
              ['3.4 (2026)', 'LTS', 'Current LTS, supported to 2031'],
              ['3.3 (2025)', 'Stable', 'Short-lived; removals landed here'],
              ['3.2 (2025)', 'LTS', 'Supported to 2030'],
              ['3.0 (2024)', 'LTS', 'Supported to 2029'],
              ['2.8 (2023)', 'LTS', 'Supported to 2028; older feature set'],
            ],
          },
          {
            t: 'p',
            text: 'The Workbench Versions page has detailed notes, sources and a config-specific upgrade checklist. Check the official HAProxy site for the latest patch level and exact EOL dates.',
          },
        ],
      },
      {
        id: 'what-changes',
        title: 'What actually breaks in a 2.x → 3.x move',
        blocks: [
          {
            t: 'ul',
            items: [
              'Removed directives that were already obsolete (`reqadd`, `rspadd`, `reqirep`, `rspirep`, `nbproc`) fail validation.',
              'The default balancing algorithm changed from roundrobin to random in 3.3; backends without an explicit `balance` can distribute traffic differently.',
              'Duplicate proxy names across families and duplicate server names are deprecated in 3.1 and rejected in 3.3+.',
              'The `program` section and legacy C mailers are removed in 3.3.',
              'HAProxy 3.0 rejects `enabled` on dynamic servers and changed Runtime API handling of multiple commands in one request.',
              '`tune.ssl.ocsp-update` was renamed to `tune.ocsp-update`; the `.mindelay`/`.maxdelay` variants retain the old prefix.',
              'Stricter URI parsing and other validation changes can expose configurations that previously passed.',
              '`master-worker` as a config directive is deprecated in 3.3; use `-W`/`-Ws`.',
            ],
          },
          {
            t: 'note',
            tone: 'info',
            title: 'Most 2.x configs still run',
            text: 'The upgrade is usually a migration of warnings and edge cases, not a rewrite. But duplicate names, removed sections and runtime API assumptions must be handled before you switch the production binary.',
          },
        ],
      },
      {
        id: 'checklist',
        title: 'Upgrade checklist',
        blocks: [
          {
            t: 'ol',
            items: [
              'Inventory every HAProxy instance and the exact running version/build (`haproxy -vv`).',
              'Save the current config and a rollback procedure.',
              'Run `haproxy -c -f` with the target 3.x binary in staging; capture warnings, not just failures.',
              'Fix duplicate proxy/server names before 3.3.',
              'Move program sections and legacy mailers to real process supervision/alerting.',
              'Audit Runtime API scripts for multi-command requests and the `enabled` keyword.',
              'Check TLS directives against the new branch; keep certificate paths and permissions identical.',
              'Test reloads, health checks, stick tables, logging and certificate selection under load.',
              'Upgrade one instance/pool at a time with monitoring and a rollback gate.',
              'Update runbooks: new directives, new stats fields, changed process flags.',
            ],
          },
          {
            t: 'p',
            text: 'The analyzer’s Version findings highlight known blockers in the imported config. It cannot validate Lua scripts, external automation or build-specific features, so those remain manual review items.',
          },
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting HAProxy: 502, 503, 504, 421 and silent mismatches',
    eyebrow: 'Diagnostics',
    description: 'A symptom-to-cause map with the exact checks that usually reveal the answer.',
    level: 'Intermediate',
    minutes: 11,
    tags: ['502', '503', '504', '421', 'SNI', 'health checks'],
    sections: [
      {
        id: 'triage',
        title: 'Triage the class first',
        blocks: [
          {
            t: 'table',
            head: ['Symptom', 'First checks'],
            rows: [
              ['Immediate 503', 'Is a backend selected? Does it have servers? Are all servers down? Is default_backend missing?'],
              ['Immediate 502', 'Can HAProxy connect? Wrong port? TLS expected but not enabled? Server rejects HTTP?'],
              ['504 after a wait', 'Application latency vs timeout server; queue time; health-check latency; long-running endpoint.'],
              ['421', 'Host/SNI mismatch, wrong certificate/service frontend, HTTP/2 connection coalescing.'],
              ['TLS handshake failure', 'Certificate SNI selection, expired cert, missing client cert, protocol mismatch.'],
              ['Wrong application served', 'Rule order, wildcard match too broad, default backend, Host/SNI disagreement.'],
            ],
          },
          {
            t: 'p',
            text: 'The Workbench Simulate view answers routing questions without touching production: which frontend receives the request, which rule matches, which backend/server is selected and what happens when a server is marked down. Use it before changing ACL order.',
          },
        ],
      },
      {
        id: 'check-503',
        title: '503: no usable server',
        blocks: [
          {
            t: 'ul',
            items: [
              '`show stat` or the stats page: are servers UP or DOWN?',
              'Does the backend actually contain server lines?',
              'Did use_backend match a backend that exists?',
              'Is `check` enabled? Are health checks failing because the endpoint needs auth or returns an unexpected status?',
              'A stick table/affinity decision may leave no eligible server.',
              'A default backend with no servers and no explicit return produces 503 by design.',
            ],
          },
          {
            t: 'code',
            label: 'Useful runtime checks',
            code: `echo "show stat" | socat stdio /run/haproxy/admin.sock | cut -d, -f1,2,18
echo "show errors" | socat stdio /run/haproxy/admin.sock
haproxy -c -f /etc/haproxy/haproxy.cfg`,
          },
        ],
      },
      {
        id: 'check-502-504',
        title: '502 and 504: upstream communication',
        blocks: [
          {
            t: 'p',
            text: 'For 502, verify the exact address, port and protocol. A common mistake is connecting to an HTTPS upstream with a plain HTTP server line: add `ssl` and certificate verification. Another is a server that expects the PROXY protocol, or one that closes idle connections. For 504, separate connect latency from response latency using logs and the application’s own metrics.',
          },
          {
            t: 'code',
            label: 'Test from the HAProxy host',
            code: `# TCP reachability
nc -vz 192.0.2.10 8080

# HTTP reachability
curl -v http://192.0.2.10:8080/health

# TLS upstream
openssl s_client -connect 192.0.2.10:443 -servername app.example.com

# Request timing
curl -o /dev/null -sS -w 'connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total}\\n' https://example.com/`,
          },
        ],
      },
      {
        id: 'check-421',
        title: '421 and the TLS/Host mismatch',
        blocks: [
          {
            t: 'p',
            text: 'HTTP/2 connection coalescing lets a browser reuse one TLS connection for multiple hostnames when the certificate and IP match. A request with a Host that belongs to another service can arrive at the wrong frontend. Forcing HTTP/1.1 (`alpn http/1.1`) is one workaround; returning 421 for known-foreign hosts is another. More fundamentally, keep certificate/SNI/service boundaries aligned and route unknown hosts explicitly.',
          },
          {
            t: 'p',
            text: 'In passthrough architectures, SNI chooses the backend before Host is visible. If SNI routes to the wrong internal frontend, the Host header can disagree after termination. A 421 response makes this visible instead of serving a confusing default 404.',
          },
        ],
      },
      {
        id: 'silent',
        title: 'Silent mismatches and simulation limits',
        blocks: [
          {
            t: 'ul',
            items: [
              'A wildcard ACL matching more than intended: prefer `-m end .example.com` and test negative cases.',
              'A health check options block without `check` on servers.',
              'A bind without `ssl` when the team assumes HTTP termination.',
              'A TLS bind with a certificate that does not cover the hostname.',
              'An `http-request set-header` temporarily masked by a later rule.',
              'A default backend forwarding unknown hosts to the first app.',
            ],
          },
          {
            t: 'p',
            text: 'The Workbench uses a documented subset for ACLs, health checks and TLS hand-off. Unsupported expressions are flagged and treated as no-match. Always confirm with `haproxy -c` and a staging request before production. If the simulation and reality disagree, trust reality and inspect the unsupported expression.',
          },
        ],
      },
    ],
  },
];

export function getArticle(slug) {
  return ARTICLES.find((article) => article.slug === slug) || null;
}

export function articleIndex() {
  return ARTICLES.map((article) => ({
    slug: article.slug,
    title: article.title,
    eyebrow: article.eyebrow,
    description: article.description,
    level: article.level,
    minutes: article.minutes,
    tags: article.tags,
  }));
}
