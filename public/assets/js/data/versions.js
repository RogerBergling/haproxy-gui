/**
 * HAProxy branch and upgrade guidance.
 *
 * Reviewed 2026-11-01. Release dates and EOL quarters are branch-level facts;
 * always verify the latest patch and exact support statement at haproxy.org.
 * Feature summaries are intentionally conservative and version-hedged.
 */

export const REVIEWED_AT = '2026-11-01';

export const BRANCHES = [
  {
    branch: '3.4',
    status: 'Current LTS',
    released: 'June 2026',
    eol: '2031 Q2',
    support: 'LTS',
    tone: 'ok',
    headline: 'Dynamic backends, OpenTelemetry',
    summary:
      'The current long-term-support branch. The headline feature is dynamic backends that can be created and managed through the Runtime API without a reload. It also adds OpenTelemetry tracing support and continues CPU scalability work.',
    changes: [
      'Dynamic backends managed through the Runtime API.',
      'OpenTelemetry filter support (experimental add-on; build-specific).',
      'Performance work on large systems and the random balancer’s recent-RPS awareness.',
      'Stats page no longer shows the HAProxy version by default (use the stats option if you relied on it).',
      '`compression-direction` is deprecated in this branch.',
    ],
    upgradeNotes: [
      'New deployments should normally target 3.4 LTS after staging validation.',
      'Review 3.3 removals first if coming from 2.x or 3.0/3.2.',
      'Check any automation that scrapes version information from the stats page.',
    ],
  },
  {
    branch: '3.3',
    status: 'Stable (short support)',
    released: 'November 2025',
    eol: '2027 Q1',
    support: 'Stable',
    tone: 'warn',
    headline: 'Duplicate-name enforcement, QUIC/backend TLS work',
    summary:
      'A feature branch with removals that matter to old configs: the program section and legacy mailers are gone, duplicate proxy/server names are rejected, and several QUIC tuning directives were renamed. Choose it for specific features, not as a long-term base.',
    changes: [
      'Duplicate names across proxy families are rejected.',
      '`program` section and legacy C mailers removed.',
      'The default balancing algorithm changed from roundrobin to random.',
      'QUIC backend and Kernel TLS work; several `tune.quic.*` directives renamed.',
      'Encrypted Client Hello (ECH) and persistent stats improvements.',
      '`master-worker`, `dispatch` and `option transparent` deprecated.',
    ],
    upgradeNotes: [
      'Most 3.3 removals were deprecated in 3.1; fix warnings before landing here.',
      'If you use QUIC, check the renamed tuning directives and build flags.',
      'Stick to an LTS branch for most production estates.',
    ],
  },
  {
    branch: '3.2',
    status: 'LTS',
    released: 'May 2025',
    eol: '2030 Q2',
    support: 'LTS',
    tone: 'ok',
    headline: 'Automatic CPU binding, ACME, more efficient QUIC',
    summary:
      'A mature LTS choice with CPU-topology-aware binding, experimental ACME certificate automation, DNS over TCP, QUIC efficiency improvements and expanded observability. A good target if your platform or organisation is not ready for 3.4 yet.',
    changes: [
      'Automatic CPU binding / CPU policy for large-core systems.',
      'Experimental ACME certificate support.',
      'QUIC performance and reliability work.',
      'DNS over TCP and Lua service discovery additions.',
      'Dynamic TLS record sizing is enabled automatically.',
    ],
    upgradeNotes: [
      'Check the exact ACME syntax and feature status in your build.',
      'Do not copy CPU binding settings blindly into containers with CPU limits.',
      'Review 3.0/3.1 warnings and removed syntax before moving from 2.8.',
    ],
  },
  {
    branch: '3.0',
    status: 'LTS',
    released: 'May 2024',
    eol: '2029 Q2',
    support: 'LTS',
    tone: 'ok',
    headline: 'crt-store, stricter runtime/API behaviour',
    summary:
      'The first 3.x LTS. Most of the config language is compatible with 2.8, but the jump includes stricter validation and behaviour changes that break some automation. crt-store modernises certificate management; existing crt/crt-list binds continue to work.',
    changes: [
      '`crt-store` certificate storage abstraction.',
      'Runtime API rejects accidental multiple commands in one request.',
      '`enabled` keyword rejected on dynamic servers.',
      'Stricter parsing of non-standard URIs.',
      '`tune.ssl.ocsp-update` renamed to `tune.ocsp-update` (the `.mindelay`/`.maxdelay` variants keep their old prefix).',
    ],
    upgradeNotes: [
      'Test Runtime API automation, not just the config file.',
      'Search for `enabled` on server lines used by dynamic workflows.',
      'Validate URI-heavy routing and logging.',
      'You do not need to migrate to crt-store during the upgrade; it is optional.',
    ],
  },
  {
    branch: '2.8',
    status: 'LTS (mature)',
    released: 'May 2023',
    eol: '2028 Q2',
    support: 'LTS',
    tone: 'neutral',
    headline: 'QUIC production-ready, Lua mailers, OCSP updates',
    summary:
      'A widely deployed LTS with production-ready QUIC, RFC 7239 Forwarded support, Lua mailers and better certificate/OCSP handling. Stable, but new features and some automation behaviour changes are only available in 3.x.',
    changes: [
      'QUIC considered production-ready in this branch.',
      'Lua mailers as a replacement path for legacy mailers.',
      'Automatic OCSP updates improvements.',
      'RFC 7239 Forwarded header support.',
    ],
    upgradeNotes: [
      'Use 2.8 as the source baseline when planning a 3.x migration.',
      'Do not skip warnings: 3.3 removes several things that 2.8 tolerated.',
      'Check Lua scripts against the target branch.',
    ],
  },
  {
    branch: '2.6',
    status: 'LTS (critical fixes only)',
    released: 'May 2022',
    eol: '2027 Q2',
    support: 'LTS',
    tone: 'warn',
    headline: 'Older LTS — plan an upgrade',
    summary:
      'Still within its nominal LTS window but far behind on feature and hardening work. If you are on 2.6, treat a move to a current LTS as a project, not a routine package update.',
    changes: [
      'Older TLS, QUIC and observability capabilities than 2.8+.',
      'Many directives deprecated or removed in later branches are still accepted here.',
    ],
    upgradeNotes: [
      'Inventory every directive and automation dependency before choosing 3.0, 3.2 or 3.4.',
      'Test Lua/Data Plane API compatibility.',
      'Prefer a supported LTS target rather than an odd-numbered feature branch.',
    ],
  },
];

export const BREAKING_CHANGES = [
  {
    introduced: '3.3',
    area: 'Balancing',
    change: 'The default load-balancing algorithm changed from roundrobin to random.',
    impact: 'Backends without an explicit `balance` line distribute traffic differently after the upgrade, which can surface uneven application load or change cache locality.',
    action: 'Set an explicit `balance` on every multi-server backend and test distribution after the upgrade.',
    finding: 'version-implicit-balance-default',
  },
  {
    introduced: '3.3',
    area: 'Naming',
    change: 'Duplicate proxy names across families and duplicate server names are rejected.',
    impact: 'A config that started on older versions may fail validation. Logs/metrics may also become ambiguous before the hard failure.',
    action: 'Rename every duplicate proxy/server. Check the analyzer’s duplicate findings.',
    finding: 'proxy-name-cross-family',
  },
  {
    introduced: '3.3',
    area: 'Process management',
    change: 'The `program` section is removed.',
    impact: 'Config validation fails. Any helper process started by HAProxy must be supervised elsewhere.',
    action: 'Move the process to systemd, a container entrypoint or another supervisor.',
    finding: 'version-program',
  },
  {
    introduced: '3.3',
    area: 'Alerting',
    change: 'Legacy C mailers are removed.',
    impact: 'The mailers section is rejected. Alerts stop if not migrated.',
    action: 'Use Lua mailers or an external alerting pipeline.',
    finding: 'version-mailers',
  },
  {
    introduced: '3.0',
    area: 'Runtime API',
    change: 'Accidental multiple commands in one Runtime API request are rejected.',
    impact: 'Scripts that relied on several commands being accepted in a single payload can fail or partially execute.',
    action: 'Send one command per request or use a supported batch mechanism; test automation.',
    finding: null,
  },
  {
    introduced: '3.0',
    area: 'Dynamic servers',
    change: 'The `enabled` keyword is rejected for dynamic servers.',
    impact: 'Automation that creates servers with `enabled` fails. Servers are enabled by default.',
    action: 'Remove `enabled` from dynamic server workflows and validate with the target binary.',
    finding: 'version-server-enabled',
  },
  {
    introduced: '3.0',
    area: 'TLS tuning rename',
    change: '`tune.ssl.ocsp-update` is renamed to `tune.ocsp-update`.',
    impact: 'The old boolean name may fail validation or be ignored depending on compatibility handling.',
    action: 'Rename the directive. The `.mindelay`/`.maxdelay` options keep the `tune.ssl.` prefix.',
    finding: 'version-ocsp-directive',
  },
  {
    introduced: '3.0',
    area: 'HTTP parsing',
    change: 'Stricter parsing of non-standard URIs and request syntax.',
    impact: 'Clients or intermediaries sending malformed requests may be rejected where older versions tolerated them.',
    action: 'Test legacy clients and monitoring probes; inspect 400s after the upgrade.',
    finding: null,
  },
  {
    introduced: '3.0 / earlier',
    area: 'Removed directives',
    change: 'Long-obsolete directives such as `reqadd`, `rspadd`, `reqirep`, `rspirep` and `nbproc` are not part of the modern language.',
    impact: 'Validation fails. Some configs survived only because the old binary was never upgraded.',
    action: 'Replace request/response rewrite rules with http-request/http-response and remove nbproc in favour of nbthread/cpu-policy.',
    finding: 'version-removed',
  },
  {
    introduced: '3.3',
    area: 'Process flags',
    change: 'The `master-worker` config directive is deprecated in favour of `-W`/`-Ws`.',
    impact: 'Warnings now; removal is planned in a later branch. Repeated flags/directives can confuse supervision.',
    action: 'Move master-worker behaviour to the service/container command line.',
    finding: 'version-master-worker',
  },
  {
    introduced: '3.3',
    area: 'QUIC',
    change: 'Several QUIC tuning directives were renamed/consolidated and some old names deprecated.',
    impact: 'QUIC configs may produce warnings or lose the intended tuning.',
    action: 'Review QUIC tuning against the target branch and your build flags.',
    finding: null,
  },
  {
    introduced: '3.4',
    area: 'Stats',
    change: 'The stats page hides the HAProxy version by default.',
    impact: 'Dashboards or support scripts that scrape version from the HTML page can break or show nothing.',
    action: 'Use `haproxy -vv`, the Runtime API or the explicit stats option instead of scraping the page.',
    finding: null,
  },
];

export const UPGRADE_STEPS = [
  {
    title: 'Inventory and baseline',
    detail:
      'Record every HAProxy instance, branch, patch level, build options, config path, service unit/container command and external automation (Data Plane API, Runtime API scripts, certificate tooling). Capture a baseline of logs and metrics.',
  },
  {
    title: 'Save a rollback path',
    detail:
      'Keep the current config and binary/package available. Know exactly how to restore the previous service state and how to reload it without dropping connections.',
  },
  {
    title: 'Validate in staging with the target binary',
    detail:
      'Install the intended 3.x binary (prefer a current LTS). Run `haproxy -c -f` and read warnings, not just the exit code. Load the config in Workbench for structural and version findings.',
  },
  {
    title: 'Fix names, balancing and removed syntax',
    detail:
      'Rename duplicate proxies/servers, set an explicit balance algorithm on multi-server backends, remove program/mailers sections, replace reqadd/rspadd and nbproc, and update `tune.ssl.ocsp-update`. These are the common hard blockers and silent behaviour changes.',
  },
  {
    title: 'Audit automation',
    detail:
      'Test Runtime API scripts for multi-command requests, dynamic server `enabled`, changed stats output and any dependency on version strings. Test Data Plane API version compatibility separately.',
  },
  {
    title: 'Re-test TLS and certificates',
    detail:
      'Verify SNI certificate selection, client-certificate verification, OCSP/ACME settings, cipher policy and upstream TLS. Distribution OpenSSL changes can alter negotiated results even when HAProxy syntax is unchanged.',
  },
  {
    title: 'Exercise failure paths',
    detail:
      'Kill a backend, roll a certificate, reload during traffic, fill a stick table, mark servers down, and verify health checks and logs. Upgrade risk is mostly in failure behaviour, not the happy path.',
  },
  {
    title: 'Roll out gradually',
    detail:
      'Upgrade one node or pool, keep the old version available, compare error/latency metrics and logs, then continue. Have a defined rollback trigger.',
  },
  {
    title: 'Update runbooks',
    detail:
      'Document new directives, Runtime API behaviour, stats fields, process flags, QUIC/build requirements and the new patch-upgrade cadence. Remove workarounds for old syntax.',
  },
];

export const VERSION_SOURCES = [
  {
    label: 'HAProxy releases and supported branches',
    href: 'https://www.haproxy.org/',
    note: 'Authoritative branch list, release dates, latest patch levels and changelogs.',
  },
  {
    label: 'HAProxy 3.0 announcement',
    href: 'https://www.haproxy.com/blog/announcing-haproxy-3-0',
    note: 'crt-store, runtime behaviour and breaking changes in 3.0.',
  },
  {
    label: 'HAProxy 3.1 announcement',
    href: 'https://www.haproxy.com/blog/announcing-haproxy-3-1',
    note: 'Deprecations (program, mailers, duplicate names) and new features.',
  },
  {
    label: 'HAProxy 3.2 announcement',
    href: 'https://www.haproxy.com/blog/announcing-haproxy-3-2',
    note: 'CPU binding, ACME, QUIC and performance work.',
  },
  {
    label: 'HAProxy 3.3 announcement',
    href: 'https://www.haproxy.com/blog/announcing-haproxy-3-3',
    note: 'Removals, duplicate-name enforcement, QUIC/Kernel TLS and ECH.',
  },
  {
    label: 'HAProxy 3.4 announcement',
    href: 'https://www.haproxy.com/blog/announcing-haproxy-3-4',
    note: 'Dynamic backends, OpenTelemetry and the current LTS feature set.',
  },
  {
    label: 'HAProxy configuration manual',
    href: 'https://docs.haproxy.org/',
    note: 'Version-specific syntax. Match the manual branch to the binary you will run.',
  },
  {
    label: 'HAProxy breaking-changes wiki',
    href: 'https://github.com/haproxy/wiki/wiki/Breaking-changes',
    note: 'Upcoming removals and planned deprecations maintained by the project.',
  },
];

export const UPGRADE_MATRIX = [
  { from: '2.6 / 2.8', to: '3.0 LTS', difficulty: 'Medium', note: 'Largest jump. Removed syntax, runtime API and stricter parsing need testing.' },
  { from: '2.6 / 2.8', to: '3.2 LTS', difficulty: 'Medium–high', note: 'Includes 3.0/3.1 changes plus newer CPU/TLS/QUIC features. Validate automation.' },
  { from: '2.6 / 2.8', to: '3.4 LTS', difficulty: 'Medium–high', note: 'Current LTS. Also includes 3.3 removals (program, mailers, duplicate names).' },
  { from: '3.0 / 3.2', to: '3.4 LTS', difficulty: 'Low–medium', note: 'Mostly 3.3 removals and current feature changes. Review deprecations and stats output.' },
];
