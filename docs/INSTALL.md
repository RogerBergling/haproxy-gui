# Install, upgrade and operate HAProxy Workbench

HAProxy Workbench is a **browser-only** HAProxy configuration studio. The container or local server only serves static files. Imported configurations, analysis, topology, simulation and version history stay in your browser.

Installing the app does **not** connect it to HAProxy. You import a configuration file in the browser, work on it locally, export the result, then validate and deploy it with your own process.

> **No built-in authentication or TLS.** The app is designed for localhost or a trusted private network. If you expose it beyond localhost, put it behind an HTTPS reverse proxy with authentication and access control.

---

## Requirements

| Component | Requirement |
|---|---|
| Docker install | Docker Engine with Compose v2 (`docker compose`) |
| Local install | Python 3.10 or newer, standard library only |
| Browser | A current Chrome, Edge, Firefox or Safari with JavaScript, ES modules, File API and `localStorage` |
| Architecture | `linux/amd64` or `linux/arm64` images |
| Network | Outbound access to `ghcr.io` for the first image pull; the app makes no third-party network calls at runtime |
| HAProxy | Not required by the app; use `haproxy -c -f` separately for real validation |
| Development | Node.js 20+ for JavaScript checks and tests; Docker optional |

The container does not need a database, account, API key, mounted configuration file or Docker socket.

---

## Quick install with Docker Compose

```bash
curl -O https://raw.githubusercontent.com/RogerBergling/haproxy-gui/main/compose.yaml
docker compose up -d
```

Open **<http://localhost:8004>**.

Stop it:

```bash
docker compose down
```

The included [`compose.yaml`](../compose.yaml):

- publishes `127.0.0.1:8004` only
- runs as a non-root user
- uses a read-only root filesystem with a small `/tmp` tmpfs
- drops all Linux capabilities
- sets `no-new-privileges`
- has a health check
- does not mount the Docker socket
- does not include Watchtower

If you already cloned the repository, run `docker compose up -d` from the repository root instead of downloading the file again.

### Change the port

Edit the `ports` entry in `compose.yaml`:

```yaml
ports:
  - "127.0.0.1:9000:8080"
```

Then recreate the container:

```bash
docker compose up -d --force-recreate
```

Open `http://localhost:9000`. The browser origin changes, so existing `localStorage` history will not be visible at the new port.

### Expose it to other devices

Changing the bind to `0.0.0.0:8004:8080` exposes the unauthenticated app to the network. Prefer a reverse proxy with HTTPS and authentication. See [Reverse proxy and HTTPS](#reverse-proxy-and-https).

---

## Install with `docker run`

```bash
docker run -d \
  --name haproxy-workbench \
  --restart unless-stopped \
  -p 127.0.0.1:8004:8080 \
  --read-only \
  --tmpfs /tmp:size=8m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  ghcr.io/rogerbergling/haproxy-gui:latest
```

Open **<http://localhost:8004>**.

Useful commands:

```bash
docker logs -f haproxy-workbench
docker inspect --format '{{.State.Health.Status}}' haproxy-workbench
docker stop haproxy-workbench
docker rm haproxy-workbench
```

For a temporary foreground session, replace `-d --name haproxy-workbench` with `--rm`.

---

## Image tags and reproducible updates

Published images:

```text
ghcr.io/rogerbergling/haproxy-gui:latest
ghcr.io/rogerbergling/haproxy-gui:main
ghcr.io/rogerbergling/haproxy-gui:sha-<commit>
ghcr.io/rogerbergling/haproxy-gui:v<tag>     # when a version tag is pushed
```

`latest` moves when `main` is published. For production, pin a commit tag or an image digest.

Get the digest:

```bash
docker pull ghcr.io/rogerbergling/haproxy-gui:latest
docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/rogerbergling/haproxy-gui:latest
```

Use the result in Compose:

```yaml
services:
  haproxy-workbench:
    image: ghcr.io/rogerbergling/haproxy-gui@sha256:REPLACE_WITH_DIGEST
```

Check the running build:

```bash
curl -s http://localhost:8004/version.json | python3 -m json.tool
```

The home page and footer also show version, build number, image tag, commit and UTC build time.

### Update deliberately

```bash
docker compose pull
docker compose up -d --force-recreate
curl -s http://localhost:8004/version.json | python3 -m json.tool
```

Keep Watchtower and other Docker-socket auto-updaters out of this deployment. The app is stateless and updates are a reviewed pull/recreate.

### Roll back

Pin the previous `sha-<commit>` tag or digest in `compose.yaml`, then:

```bash
docker compose up -d --force-recreate
```

Browser data is versioned with `v1` storage keys. Back up anything important before changing versions.

If the first pull fails with an authentication error, the GHCR package may still be private. Make it public under **GitHub → Packages → haproxy-gui → Package settings**, or authenticate the host with `docker login ghcr.io`.

---

## Run locally without Docker

Requires Python 3.10+ and no third-party packages.

```bash
python3 start.py
```

The launcher picks the first free port in `8080–8099`, prints the URL and opens a browser.

```bash
python3 start.py --port 8004 --host 127.0.0.1
python3 start.py --no-browser
```

Use the HTTP URL printed by the server. Opening `public/index.html` as a `file://` URL will not work because ES modules and `/version.json` require an HTTP origin.

`--host 0.0.0.0` exposes the unauthenticated app to the network. Review the security policy before doing that and prefer a reverse proxy.

Local runs show `dev`/`local` build metadata because `/version.json` is normally baked by the Docker build.

---

## Build from source

```bash
git clone https://github.com/RogerBergling/haproxy-gui.git
cd haproxy-gui
docker build -t haproxy-workbench:local .
```

Run it with the same hardening flags:

```bash
docker run --rm -p 127.0.0.1:8004:8080 \
  --read-only --tmpfs /tmp:size=8m \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  haproxy-workbench:local
```

Development verification:

```bash
python3 scripts/verify.py
python3 -m py_compile start.py scripts/verify.py scripts/smoke.py
python3 scripts/smoke.py
node scripts/check-js.mjs
node --test
```

---

## Reverse proxy and HTTPS

The app does not terminate TLS and does not authenticate users. The static server sends a strict Content-Security-Policy, `frame-ancestors 'none'`, `no-referrer`, `nosniff`, COOP/CORP and `no-store` caching.

If you expose it beyond localhost:

1. Terminate HTTPS at a reverse proxy you control.
2. Require authentication and restrict access.
3. Keep the app container bound to loopback or a private Docker network.
4. Do not remove the application security headers.
5. Keep the image and proxy updated.
6. Review the [security policy](../SECURITY.md).

### Nginx example

```nginx
server {
    listen 443 ssl;
    server_name workbench.example.com;

    ssl_certificate     /etc/ssl/certs/workbench.example.com.pem;
    ssl_certificate_key /etc/ssl/private/workbench.example.com.key;

    auth_basic           "HAProxy Workbench";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8004;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy example

```caddyfile
workbench.example.com {
    reverse_proxy 127.0.0.1:8004
}
```

Add Caddy authentication or another access-control layer before exposing it. Caddy provisions TLS automatically when the hostname is public and DNS is correct.

No WebSocket upgrade is required. The app uses hash routing, so `/` and the static assets are sufficient. Do not add caching for `version.json` or application assets.

### Reverse proxy in Docker

If the proxy runs in another container, publish the app only on a private Docker network instead of a host port:

```yaml
services:
  haproxy-workbench:
    image: ghcr.io/rogerbergling/haproxy-gui:latest
    expose:
      - "8080"
    networks:
      - workbench

  proxy:
    image: your-reverse-proxy
    ports:
      - "443:443"
    networks:
      - workbench

networks:
  workbench:
```

Use `http://haproxy-workbench:8080` as the proxy upstream. Do not publish the app port publicly.

---

## First run

1. Open the app.
2. Click **Import configuration**, paste a config, or open an anonymised example.
3. Inspect the source and structure in **Workbench**.
4. Open **Analyze** for findings and safe fixes.
5. Open **Topology** to inspect routing and simulate requests.
6. Use **Add service** to preview a new HTTPS, HTTP or SNI-passthrough service, including an optional backend source allowlist.
7. Use **Compare** and **History** to compare files or saved versions.
8. Export or download the result before relying on it.

Generated changes are local proposals. The app does not deploy, reload HAProxy, call the Runtime API or push configurations.

---

## Where your data lives

| Data | Location |
|---|---|
| Current configuration | Browser memory + `localStorage` |
| Up to 100 snapshots | `localStorage` |
| Theme/settings | `localStorage` |
| Analysis, topology, simulation | Browser memory only |
| Server-side configuration data | None |
| Analytics or telemetry | None |

Important consequences:

- `localStorage` is scoped to the **exact origin**: scheme, hostname and port. Moving from `http://localhost:8004` to `https://workbench.example.com` or another port creates a different storage area. The old data is not deleted, but it will not appear at the new origin.
- Use one stable URL for a given browser profile.
- Incognito/private windows and browser profiles have separate storage.
- Clearing site data, browser history or application storage deletes the workbench data.
- The app budgets about 4 MB for history and 512 KB per configuration, but the browser quota is authoritative.
- If `localStorage` is unavailable or full, the app falls back to memory for the current tab and shows a warning. Export before closing.

**Do not paste private keys, passwords or API tokens into a configuration.** Use file references with restricted permissions. Exported configs and history JSON are plaintext infrastructure documents.

---

## Backup and restore

### Back up the current configuration

Use **Workbench → Export** to download the `.cfg`, or copy the source. This is the authoritative artifact to deploy.

### Back up history

Open **History → Export history**. The JSON file contains the snapshots, timestamps, labels, notes and configuration text. It is an archive, **not an importable history backup**; the app has no history-import button.

Store the export securely: it can contain internal hostnames, IP addresses, certificate paths and routing policy.

### Restore

- To restore a configuration, import the saved `.cfg` or paste it into the editor.
- If the in-browser history still exists, use **History → Restore** on a snapshot. Restoring creates a new snapshot, so the rollback itself can be inspected or undone.
- There is no server-side copy. If browser data is gone and you have no export, it cannot be recovered.

Export before upgrades, browser cleanup, device changes or clearing site data.

---

## Uninstall

Docker Compose:

```bash
docker compose down
```

Docker run:

```bash
docker stop haproxy-workbench
docker rm haproxy-workbench
```

Optionally remove the image:

```bash
docker image rm ghcr.io/rogerbergling/haproxy-gui:latest
```

Then clear browser-local data in the app via **History → Clear all local data**, or remove site data for the workbench origin in your browser.

There are no server-side volumes or databases to delete.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| `unauthorized` or `denied` pulling from GHCR | Package is private or the host is not logged in | Make the package public or run `docker login ghcr.io` |
| `docker compose` is not found | Compose v2 is missing | Install the Docker Compose plugin |
| Port 8004 is already in use | Another process or old container | Change the host port or stop the conflicting process |
| Blank page | Opened through `file://` or assets were not served | Use the HTTP URL from `start.py` or the container |
| Page loads but history is missing | Different scheme, hostname or port; private window; site data cleared | Use the original origin; restore from an export |
| Version shows `dev`/`local` | Running from source without a Docker build | Expected for local runs; Docker bakes metadata |
| Storage warning or changes disappear | Browser storage blocked or full | Export, clear old history, or use a browser profile with storage |
| Container is unhealthy | Server failed to start or port/network problem | Run `docker logs`, inspect the health check, verify the port |
| Reverse proxy returns 502 | Wrong upstream or container network | Use `127.0.0.1:8004` for a host proxy or the service name and port `8080` in Docker |
| `exec format error` | Image architecture does not match the host | Use the multi-arch image and check the platform |
| HAProxy rejects generated config | This tool is not `haproxy -c` | Validate with the exact HAProxy binary and branch |
| Source allowlist is blocked in the wizard | Loopback/bridge placement or `/0` catch-all | Use an entry-frontend ACL instead; never use `/0` for default-deny |
| Browser warns about TLS/certificate placeholders | The config references certificate paths that do not exist yet | Replace placeholders and validate on the target host |

For application errors, include the app version from **Home**, browser name/version, deployment method (Compose, `docker run`, local Python) and reproduction steps. Redact internal hostnames, IPs, certificate paths and configuration secrets.

---

## Security notes

- No built-in authentication, accounts or authorization.
- No TLS listener; use an HTTPS reverse proxy.
- No server-side configuration storage; browser data is readable by anyone with access to that browser profile.
- Do not store secrets in configurations.
- A backend source allowlist matches HAProxy's immediate peer `src`, not `X-Forwarded-For`; loopback/bridge placements and `/0` catch-alls are rejected by the wizard.
- The app is not a compiler, deployment tool or WAF. Review changes and run `haproxy -c -f` against the target binary.

Read [SECURITY.md](../SECURITY.md) for the threat model and private vulnerability-reporting process.

---

## Support and license

- Bugs and feature requests: <https://github.com/RogerBergling/haproxy-gui/issues>
- Security reports: [SECURITY.md](../SECURITY.md) — do not open a public issue
- License: MIT, see [LICENSE](../LICENSE)

HAProxy is a registered trademark of HAProxy Technologies. This project is unofficial and is not affiliated with or endorsed by HAProxy Technologies.
