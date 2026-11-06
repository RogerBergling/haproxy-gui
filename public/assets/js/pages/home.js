import { analyzeConfig } from '../config/analyzer.js';
import { parseConfig } from '../config/parser.js';
import { getSample, SAMPLES } from '../data/samples.js';
import { getCurrent, getHistory, commitConfig } from '../storage.js';
import { applyBuildInfo, buildNumber, formatBuildDate, loadBuildInfo, shortCommit } from '../version.js';
import {
  attachDropZone,
  confirmDialog,
  esc,
  formatBytes,
  formatRelative,
  icon,
  openImportDialog,
  scoreGauge,
  storageNotice,
  toast,
} from '../ui.js';

function sampleCards() {
  return SAMPLES.map((sample) => `
    <article class="sample-card" data-sample-card="${sample.id}">
      <div class="sample-card-head">
        <span class="pill accent">${sample.short}</span>
        <span class="sample-lines">${sample.text.split('\n').length} lines</span>
      </div>
      <h3>${esc(sample.name)}</h3>
      <p>${esc(sample.description)}</p>
      <div class="sample-arch">${icon('topology')}${esc(sample.architecture)}</div>
      <ul class="sample-highlights">${sample.highlights.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      <button class="btn btn-ghost sample-load" type="button" data-load-sample="${sample.id}">${icon('arrow')}Open example</button>
    </article>`).join('');
}

export async function renderHome(view) {
  const info = await loadBuildInfo();
  const current = getCurrent();
  const history = getHistory();
  const model = current ? parseConfig(current.text) : null;
  const summary = model ? analyzeConfig(model) : null;
  const fileName = current?.filename || 'haproxy.cfg';
  const hasConfig = Boolean(current);
  const commitLink = /^[0-9a-f]{7,40}$/i.test(info.commit)
    ? `<a href="https://github.com/RogerBergling/haproxy-gui/commit/${esc(info.commit)}" target="_blank" rel="noopener noreferrer">${esc(shortCommit(info.commit))}</a>`
    : `<span>${esc(shortCommit(info.commit))}</span>`;

  view.innerHTML = `
    ${storageNotice()}
    <section class="home-hero">
      <div class="hero-copy">
        <span class="eyebrow"><span class="pulse-dot" aria-hidden="true"></span> Local-first HAProxy studio</span>
        <h1>Understand the config.<br><em>Change it safely.</em></h1>
        <p class="hero-lede">Import HAProxy, see the traffic graph, learn what every line does, catch security and reliability problems, and simulate routing changes before they reach production.</p>
        <div class="home-buildline" aria-label="Version, build, commit and build time">
          <span><em>Version</em><strong data-app-version>${esc(info.version)}</strong></span>
          <span><em>Build</em><strong data-build-number>${esc(buildNumber(info.buildDate))}</strong></span>
          <span><em>Image</em><strong data-image-tag>${esc(info.imageTag)}</strong></span>
          <span><em>Commit</em><strong>${/^[0-9a-f]{7,40}$/i.test(info.commit) ? commitLink : esc(shortCommit(info.commit))}</strong></span>
          <span><em>Built</em><strong data-build-date>${esc(formatBuildDate(info.buildDate))}</strong></span>
          <span class="home-live-time"><em>Now</em><time data-live-clock>—</time></span>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" type="button" data-action="import">${icon('upload')}Import configuration</button>
          <a class="btn btn-ghost btn-lg" href="${hasConfig ? '#/workbench' : '#/learn'}">${hasConfig ? `${icon('edit')}Open workbench` : `${icon('book')}Learn HAProxy`}</a>
        </div>
        <div class="hero-trust">
          <span>${icon('lock')}<strong>Nothing is uploaded.</strong> No account, no server storage, no analytics.</span>
          <a href="#/security">How privacy works →</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><strong>${hasConfig ? summary.score : '—'}</strong><span>config score</span></div>
          <div class="hero-stat"><strong>${hasConfig ? summary.findings.length : '—'}</strong><span>findings</span></div>
          <div class="hero-stat"><strong>${history.length}<small>/100</small></strong><span>local versions</span></div>
          <div class="hero-stat"><strong>${SAMPLES.length}</strong><span>example architectures</span></div>
        </div>
      </div>

      <aside class="hero-side">
        <article class="build-card">
          <div class="build-card-head">
            <span class="status-dot" aria-hidden="true"></span>
            <div>
              <strong>Running locally in your browser</strong>
              <span>No configuration leaves this tab</span>
            </div>
          </div>
          <div class="build-grid">
            <div><span>Version</span><strong data-app-version>${esc(info.version)}</strong></div>
            <div><span>Build</span><strong data-build-number>${esc(buildNumber(info.buildDate))}</strong></div>
            <div><span>Image</span><strong data-image-tag>${esc(info.imageTag)}</strong></div>
            <div><span>Commit</span><strong>${commitLink}</strong></div>
            <div><span>Built</span><strong data-build-date>${esc(formatBuildDate(info.buildDate))}</strong></div>
          </div>
          <div class="build-clock">
            ${icon('clock')}
            <div><span>Current time</span><time data-live-clock>—</time></div>
          </div>
          <p class="build-note">Build information comes from <code>/version.json</code>. Version, build, commit and build time are shown on this first page and in the footer.</p>
        </article>

        <div class="mini-topology" aria-hidden="true">
          <div class="mini-node client"><span>clients</span></div>
          <div class="mini-rail"></div>
          <div class="mini-stack">
            <div class="mini-node fe tcp"><span>SNI edge</span><small>TCP</small></div>
            <div class="mini-node fe tls"><span>TLS frontend</span><small>HTTP</small></div>
            <div class="mini-node fe http"><span>HTTP frontend</span><small>HTTP</small></div>
          </div>
          <div class="mini-rail"></div>
          <div class="mini-stack">
            <div class="mini-node be"><span>backend</span><small>check</small></div>
            <div class="mini-node server"><span>servers</span><small>pool</small></div>
          </div>
        </div>
      </aside>
    </section>

    <div class="privacy-banner">
      <div class="privacy-banner-icon">${icon('shield')}</div>
      <div>
        <strong>Your configuration never leaves this browser.</strong>
        <p>Imports are read with the File API. Parsing, analysis, topology and simulation run locally. History is stored in this browser's localStorage, not on the server. The container is a static file server with no write endpoint.</p>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/security">Read the security model</a>
    </div>

    ${hasConfig ? `
      <section class="resume-card">
        <div class="resume-main">
          <span class="eyebrow">Resume where you left off</span>
          <h2>${esc(current.label || 'Current configuration')}</h2>
          <p class="resume-meta">${icon('code')}${esc(fileName)} · ${model.stats.lines} lines · saved ${esc(formatRelative(current.updatedAt))}</p>
          <div class="meta-strip">
            <span class="pill ${summary.counts.error ? 'danger' : summary.counts.warning ? 'warn' : 'ok'}">${summary.counts.error ? `${summary.counts.error} error${summary.counts.error === 1 ? '' : 's'}` : summary.counts.warning ? `${summary.counts.warning} warning${summary.counts.warning === 1 ? '' : 's'}` : 'No blocking findings'}</span>
            <span class="pill">${model.stats.frontends + model.stats.listens} frontend${model.stats.frontends + model.stats.listens === 1 ? '' : 's'}</span>
            <span class="pill">${model.stats.backends + model.stats.listens} backend${model.stats.backends + model.stats.listens === 1 ? '' : 's'}</span>
            <span class="pill">${model.stats.servers} server${model.stats.servers === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div class="resume-score">${scoreGauge(summary.score, summary.grade)}</div>
        <div class="resume-actions">
          <a class="btn btn-primary" href="#/workbench">${icon('edit')}Workbench</a>
          <a class="btn btn-ghost" href="#/analyze">Analyze</a>
          <a class="btn btn-ghost" href="#/topology">Topology</a>
          <a class="btn btn-ghost" href="#/services">Add service</a>
          <button class="btn btn-ghost" type="button" data-action="import">${icon('upload')}Import another</button>
        </div>
      </section>
    ` : `
      <section class="start-panel">
        <div class="start-copy">
          <span class="eyebrow">Start here</span>
          <h2>Import a config or explore a real architecture</h2>
          <p>Drop a file anywhere in this panel, choose one from disk, or paste it. You can also open an anonymised example with deliberately realistic issues.</p>
          <div class="start-actions">
            <button class="btn btn-primary" type="button" data-action="import">${icon('upload')}Choose or paste a config</button>
            <a class="btn btn-ghost" href="#/learn/config-anatomy">Read the mental model</a>
          </div>
          <p class="muted-note">${icon('lock')}Files are read locally with the browser File API. Maximum ${formatBytes(512 * 1024)}.</p>
        </div>
        <label class="dropzone home-dropzone" data-home-drop>
          <div class="dropzone-icon">${icon('upload')}</div>
          <strong>Drop <code>haproxy.cfg</code> here</strong>
          <span>or click to browse</span>
          <small>The server never receives the file.</small>
          <input type="file" accept=".cfg,.conf,.txt,text/plain" class="visually-hidden" data-home-file>
        </label>
      </section>
    `}

    <section class="section-block">
      <div class="section-head">
        <div><span class="eyebrow">Workbench</span><h2>From file to confident change</h2></div>
        <p>Import, understand, inspect, simulate, then export. Every step runs locally and every change can be reverted from the 100-version history.</p>
      </div>
      <div class="feature-grid">
        <a class="feature-card" href="#/workbench?tab=learn"><span class="feature-icon">${icon('book')}</span><h3>Learn every config row</h3><p>A guided walkthrough of your own file: section context, directive meaning, effective behaviour and deeper guides.</p></a>
        <a class="feature-card" href="#/analyze"><span class="feature-icon">${icon('shield')}</span><h3>Warnings & best practices</h3><p>TLS policy, timeouts, health checks, header trust, admin-socket permissions and 3.x upgrade risks.</p></a>
        <a class="feature-card" href="#/topology"><span class="feature-icon">${icon('topology')}</span><h3>Graphical topology</h3><p>See frontends, loopback TLS hand-offs, backends and servers as a real routing graph.</p></a>
        <a class="feature-card" href="#/topology?tab=simulate"><span class="feature-icon">${icon('shuffle')}</span><h3>Request simulation</h3><p>Trace Host/SNI ACLs, see the selected server, and test what happens when a server is down.</p></a>
        <a class="feature-card" href="#/services"><span class="feature-icon">${icon('plus')}</span><h3>Add a service safely</h3><p>HTTPS, HTTP or TLS passthrough. The wizard considers the running config and previews the diff.</p></a>
        <a class="feature-card" href="#/history"><span class="feature-icon">${icon('history')}</span><h3>100 local versions</h3><p>Every import, manual save and generated change is snapshotted. Compare and restore in one click.</p></a>
        <a class="feature-card" href="#/versions"><span class="feature-icon">${icon('layers')}</span><h3>Version intelligence</h3><p>LTS branches, what changed, and a 2.x → 3.x guide with config-specific upgrade checks.</p></a>
        <a class="feature-card" href="#/glossary"><span class="feature-icon">${icon('book')}</span><h3>Admin glossary</h3><p>SNI, stick tables, 503/504, ALPN, PROXY protocol and the terms that matter at 03:00.</p></a>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head">
        <div><span class="eyebrow">Samples</span><h2>Two architectures, all data anonymised</h2></div>
        <p>These mirror real patterns: a TCP/SNI edge into loopback TLS termination, and a direct HTTP/HTTPS frontend with sticky sessions. Every hostname and address is documentation-only.</p>
      </div>
      <div class="sample-grid">${sampleCards()}</div>
    </section>

    <section class="section-block split-block">
      <div>
        <span class="eyebrow">Privacy by architecture</span>
        <h2>The server has nothing to store</h2>
        <p class="page-lede">This is not a promise bolted onto a backend. The container serves static files and exposes no API. Parsing, analysis, simulation and history all happen in the browser. There is no database, account system, upload endpoint, analytics script or third-party request.</p>
        <div class="link-row"><a class="btn btn-ghost" href="#/security">Security & privacy model ${icon('arrow')}</a><a class="btn btn-ghost" href="https://github.com/RogerBergling/haproxy-gui" target="_blank" rel="noopener noreferrer">Read the source ${icon('external')}</a></div>
      </div>
      <div class="privacy-facts">
        <div class="fact">${icon('lock')}<div><strong>Browser-only processing</strong><span>File API + ES modules. No configuration bytes are sent to the server.</span></div></div>
        <div class="fact">${icon('shield')}<div><strong>Hardened static delivery</strong><span>Strict CSP, no inline scripts, no framing, no external origins, read-only container.</span></div></div>
        <div class="fact">${icon('history')}<div><strong>Local history, your control</strong><span>100 snapshots in localStorage with one-click clear and export.</span></div></div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head"><div><span class="eyebrow">Limits are explicit</span><h2>An assistant, not a compiler</h2></div></div>
      <div class="callout warn">
        ${icon('warning')}
        <p><strong>Use at your own risk.</strong> This workbench uses a conservative parser and a documented ACL subset. It cannot execute HAProxy, resolve DNS, inspect certificate files, validate Lua or know your application’s semantics. Run <code>haproxy -c -f</code>, test in staging, and keep a rollback path.</p>
      </div>
    </section>
  `;

  applyBuildInfo(view, info);

  const open = () => openImportDialog({
    onLoad: (text, filename) => {
      const result = commitConfig(text, {
        filename,
        label: `Imported ${filename}`,
        source: 'import',
      });
      if (!result.ok) {
        toast(result.error?.message || 'Import failed.', { tone: 'danger', duration: 6500 });
        return;
      }
      toast('Imported. The configuration stays in this browser.', { tone: 'ok' });
      location.hash = '#/workbench';
    },
  });

  view.querySelectorAll('[data-action="import"]').forEach((button) => button.addEventListener('click', open));
  const fileInput = view.querySelector('[data-home-file]');
  fileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      if (!text.trim()) {
        toast('That file is empty.', { tone: 'danger' });
        return;
      }
      const result = commitConfig(text, { filename: file.name, label: `Imported ${file.name}`, source: 'import' });
      if (!result.ok) {
        toast(result.error?.message || 'Could not import that file.', { tone: 'danger' });
        return;
      }
      toast('Imported. The configuration stays in this browser.', { tone: 'ok' });
      location.hash = '#/workbench';
    } catch {
      toast('Could not read that file as text.', { tone: 'danger' });
    }
  });
  attachDropZone(view.querySelector('[data-home-drop]'), {
    onFile: (text, filename) => {
      const result = commitConfig(text, { filename, label: `Imported ${filename}`, source: 'import' });
      if (!result.ok) {
        toast(result.error?.message || 'Could not import that file.', { tone: 'danger' });
        return;
      }
      toast('Imported. The configuration stays in this browser.', { tone: 'ok' });
      location.hash = '#/workbench';
    },
  });

  view.querySelectorAll('[data-load-sample]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sample = getSample(button.dataset.loadSample);
      if (!sample) return;
      if (getCurrent()) {
        const proceed = await confirmDialog({
          title: `Load ${sample.name}?`,
          message: 'This replaces the current configuration. The previous version remains in history.',
          confirmLabel: 'Load example',
          details: ['The current config is snapshotted first only if it was already saved.', 'You can restore it from History.'],
        });
        if (!proceed) return;
      }
      const result = commitConfig(sample.text, {
        filename: `${sample.id}.cfg`,
        label: sample.name,
        source: 'sample',
        note: sample.description,
      });
      if (!result.ok) {
        toast(result.error?.message || 'Could not load the example.', { tone: 'danger' });
        return;
      }
      toast(`${sample.short} loaded. Explore it in the workbench.`, { tone: 'ok' });
      location.hash = '#/workbench';
    });
  });

}
