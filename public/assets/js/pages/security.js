import {
  CONFIG_LIMIT_BYTES,
  getCurrent,
  getHistory,
  isPersistent,
  storageSummary,
  clearAll,
  clearHistory,
} from '../storage.js';
import {
  confirmDialog,
  downloadJson,
  esc,
  formatBytes,
  formatRelative,
  icon,
  toast,
} from '../ui.js';

const HEADERS = [
  ['Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"],
  ['Referrer-Policy', 'no-referrer'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'],
];

function headerRows() {
  return HEADERS.map(([name, value]) => `<tr><td><code>${esc(name)}</code></td><td><code>${esc(value)}</code></td></tr>`).join('');
}

export async function renderSecurity(view) {
  const current = getCurrent();
  const history = getHistory();
  const summary = storageSummary();
  const persistent = isPersistent();

  view.innerHTML = `
    <header class="page-head security-head">
      <div class="page-head-copy">
        <span class="eyebrow">Security & privacy</span>
        <h1>Your configuration stays in this browser.</h1>
        <p class="page-lede">This is an architectural property, not a marketing promise. HAProxy Workbench is a static single-page app. It has no account system, no upload endpoint, no database, no analytics and no third-party scripts. The Docker container only serves files.</p>
        <div class="privacy-badges">
          <span class="pill ok">${icon('lock')}No server-side storage</span>
          <span class="pill ok">${icon('shield')}No telemetry</span>
          <span class="pill ok">${icon('code')}No external requests</span>
          <span class="pill ${persistent ? 'accent' : 'warn'}">${persistent ? 'localStorage available' : 'memory-only session'}</span>
        </div>
      </div>
      <div class="page-actions"><a class="btn btn-ghost" href="https://github.com/RogerBergling/haproxy-gui" target="_blank" rel="noopener noreferrer">${icon('external')}Inspect the source</a></div>
    </header>

    <section class="privacy-hero">
      <div class="privacy-flow">
        <div class="flow-step"><span class="flow-icon">${icon('upload')}</span><strong>Import</strong><small>File API reads the file in this tab</small></div>
        <span class="flow-arrow">${icon('arrow')}</span>
        <div class="flow-step"><span class="flow-icon">${icon('code')}</span><strong>Parse & explain</strong><small>ES modules in your browser</small></div>
        <span class="flow-arrow">${icon('arrow')}</span>
        <div class="flow-step"><span class="flow-icon">${icon('shield')}</span><strong>Analyze & simulate</strong><small>All computation is local</small></div>
        <span class="flow-arrow">${icon('arrow')}</span>
        <div class="flow-step"><span class="flow-icon">${icon('history')}</span><strong>localStorage</strong><small>Only on this device</small></div>
      </div>
      <p class="flow-note">The network path is static files plus <code>GET /version.json</code> for build metadata. There is no path that sends the imported configuration to the server.</p>
    </section>

    <div class="security-grid">
      <section class="security-card">
        <h2>${icon('lock')}What is stored where</h2>
        <table class="data-table compact-table"><thead><tr><th>Data</th><th>Location</th><th>Leaves the browser?</th></tr></thead><tbody>
          <tr><td>Imported/edited config</td><td>In-memory + localStorage</td><td><span class="pill tiny ok">No</span></td></tr>
          <tr><td>Up to 100 snapshots</td><td>localStorage</td><td><span class="pill tiny ok">No</span></td></tr>
          <tr><td>Analysis, topology, simulation</td><td>Memory only</td><td><span class="pill tiny ok">No</span></td></tr>
          <tr><td>Theme preference</td><td>localStorage</td><td><span class="pill tiny ok">No</span></td></tr>
          <tr><td>Build metadata fetch</td><td><code>GET /version.json</code>, same origin</td><td><span class="pill tiny ok">Static file only</span></td></tr>
          <tr><td>Analytics / crash reports</td><td>Does not exist</td><td><span class="pill tiny ok">No</span></td></tr>
        </tbody></table>
      </section>

      <section class="security-card">
        <h2>${icon('layers')}Your local data right now</h2>
        <div class="storage-facts">
          <div><span>Current config</span><strong>${current ? esc(current.filename || 'haproxy.cfg') : 'none'}</strong><small>${current ? `saved ${esc(formatRelative(current.updatedAt))} · ${current.text.split('\n').length} lines` : 'Import a config to begin'}</small></div>
          <div><span>Snapshots</span><strong>${history.length} / 100</strong><small>${formatBytes(summary.approxBytes)} estimated local usage</small></div>
          <div><span>Persistence</span><strong>${persistent ? 'Available' : 'Unavailable'}</strong><small>${persistent ? 'Data survives a reload on this browser profile' : 'This session only; storage is blocked'}</small></div>
        </div>
        <div class="storage-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="export">${icon('download')}Export history</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="clear-history" ${history.length ? '' : 'disabled'}>${icon('trash')}Clear history</button>
          <button class="btn btn-danger btn-ghost btn-sm" type="button" data-action="clear-all">${icon('trash')}Clear all local data</button>
        </div>
        <p class="muted-note">Browser storage keys: <code>haproxy-workbench.current.v1</code>, <code>haproxy-workbench.history.v1</code>, <code>haproxy-workbench.settings.v1</code>.</p>
      </section>
    </div>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Threat model</span><h2>What this protects — and what it cannot</h2></div></div>
      <div class="two-col">
        <div class="security-card">
          <h3>Designed to reduce exposure</h3>
          <ul class="check-list">
            <li>${icon('check')}<span>No server-side config storage, so a server compromise cannot leak your imported topology through this app.</span></li>
            <li>${icon('check')}<span>Static container with no write path, no API and no database.</span></li>
            <li>${icon('check')}<span>Strict CSP, no inline scripts, no third-party origins, framing denied.</span></li>
            <li>${icon('check')}<span>User-controlled config text is escaped before rendering; it is never evaluated as code.</span></li>
            <li>${icon('check')}<span>Non-root, read-only, capability-dropped container guidance.</span></li>
            <li>${icon('check')}<span>No analytics, fonts, CDNs or telemetry calls.</span></li>
          </ul>
        </div>
        <div class="security-card warning-card">
          <h3>Not protected against</h3>
          <ul class="check-list">
            <li>${icon('warning')}<span><strong>Anyone with access to this browser profile or device</strong> can read localStorage, including exported history. Use a private window on shared machines and clear data afterwards.</span></li>
            <li>${icon('warning')}<span><strong>Malicious browser extensions or a compromised device</strong> can read page data. This app cannot defend the endpoint.</span></li>
            <li>${icon('warning')}<span><strong>Secrets placed in the config.</strong> Never paste private keys, passwords, API tokens or unencrypted credentials. HAProxy configs should reference secrets, not embed them.</span></li>
            <li>${icon('warning')}<span><strong>A shared public deployment</strong> still has the same browser-local model. The server operator cannot read your config, but they can serve modified JavaScript if they are malicious. Use a trusted deployment and verify the source.</span></li>
            <li>${icon('warning')}<span><strong>Export and backup files</strong> are plaintext. Treat downloaded configs and history JSON as sensitive infrastructure documents.</span></li>
          </ul>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Delivery hardening</span><h2>Security headers and container posture</h2></div><p>The included server sends these headers on every response. The Docker image runs as an unprivileged user with a read-only filesystem.</p></div>
      <div class="table-scroll"><table class="data-table headers-table"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>${headerRows()}</tbody></table></div>
      <div class="security-notes">
        <div>${icon('check')}<span>The Python launcher supports <code>GET</code>/<code>HEAD</code> only, blocks directory indexes, resolves paths inside <code>public/</code> and sends extension-less routes to the app shell.</span></div>
        <div>${icon('check')}<span>The container drops all Linux capabilities, enables <code>no-new-privileges</code>, mounts a read-only root filesystem and runs as the <code>app</code> user.</span></div>
        <div>${icon('check')}<span>The app makes no network calls except a same-origin <code>/version.json</code> read for version, build time and commit. It fails gracefully when offline.</span></div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Verify</span><h2>Check it yourself</h2></div><p>You do not have to trust this description. Use the browser and the source.</p></div>
      <ol class="verify-steps">
        <li><strong>Watch the network panel.</strong> Open DevTools → Network, clear it, then import and analyze a config. You should see no request carrying the file. The only app fetch is same-origin <code>/version.json</code>.</li>
        <li><strong>Inspect localStorage.</strong> DevTools → Application → Local Storage. The current config and snapshots are there in plain text; nothing equivalent exists on the server.</li>
        <li><strong>Check the headers.</strong> <code>curl -sI http://localhost:8004/</code> should show the CSP and related headers.</li>
        <li><strong>Read the server code.</strong> <code>start.py</code> is a stdlib static file handler. The Dockerfile copies only the launcher and <code>public/</code>.</li>
        <li><strong>Confirm the container.</strong> <code>docker inspect haproxy-workbench</code> shows read-only root, dropped capabilities and the non-root user.</li>
      </ol>
    </section>

    <div class="callout info">${icon('info')}<p><strong>Use the right tool for production validation.</strong> This app is a learning, review and change-planning tool. It is not a secrets manager, a deployment system or a replacement for <code>haproxy -c</code>. Always keep an independent rollback path.</p></div>
  `;

  const onClearHistory = async () => {
    const proceed = await confirmDialog({
      title: 'Clear local version history?',
      message: 'The current configuration stays, but every snapshot in this browser is deleted. There is no server copy.',
      confirmLabel: 'Clear history',
      tone: 'danger',
    });
    if (!proceed) return;
    clearHistory();
    toast('Local history cleared.', { tone: 'ok' });
    window.dispatchEvent(new CustomEvent('workbench:reload'));
  };

  const onClearAll = async () => {
    const proceed = await confirmDialog({
      title: 'Clear all local workbench data?',
      message: 'This deletes the current config, all snapshots and local settings from this browser. It does not change any HAProxy server.',
      confirmLabel: 'Delete everything',
      tone: 'danger',
      details: [`${history.length} snapshot(s) will be deleted.`, 'Export history first if you need a backup.'],
    });
    if (!proceed) return;
    clearAll();
    toast('All local workbench data cleared.', { tone: 'ok' });
    location.hash = '#/';
  };

  const onExport = () => {
    downloadJson('haproxy-workbench-history.json', {
      app: 'HAProxy Workbench',
      exportedAt: new Date().toISOString(),
      warning: 'Plaintext local export. May contain sensitive topology, hostnames, IP addresses and certificate paths. Store securely.',
      history,
    });
    toast('History exported locally. Store it securely.', { tone: 'ok' });
  };

  const onClick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'export') onExport();
    else if (action === 'clear-history') onClearHistory();
    else if (action === 'clear-all') onClearAll();
  };
  view.addEventListener('click', onClick);

  return () => view.removeEventListener('click', onClick);
}
