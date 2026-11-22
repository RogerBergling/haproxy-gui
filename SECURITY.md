# Security policy

HAProxy Workbench is a local-first, browser-only HAProxy configuration tool. The container and local server only serve static files; configurations and history are processed and stored in the browser.

## Supported versions

| Version | Supported |
|---|---|
| 1.4.x | Yes |
| 1.3.x and older | No — upgrade to the latest release |

Security fixes are applied to the latest published release. The `latest` image moves with `main`; production deployments should pin a reviewed commit tag or image digest.

## Reporting a vulnerability

Do **not** open a public GitHub issue for a security problem.

Use GitHub private vulnerability reporting:

**<https://github.com/RogerBergling/haproxy-gui/security/advisories/new>**

If that link is unavailable, contact the repository owner through GitHub and ask for a private reporting channel. Do not include working exploit details in a public issue.

Please include:

- affected version, commit and deployment method
- browser and operating system
- a description of the issue and its security impact
- reproduction steps or a minimal proof of concept
- whether the issue involves imported configuration text, generated configuration, `localStorage`, the static server, the container, or the reverse proxy
- any relevant configuration with secrets, hostnames, IP addresses and certificate paths redacted

Maintainers will investigate and coordinate a fix and disclosure on a best-effort basis. Please allow time for a patched release before public disclosure.

## Scope

### In scope

- The static Python server and request-path containment
- Security headers and Content-Security-Policy behavior
- The Docker image and included Compose hardening
- Cross-site scripting or HTML injection through imported configuration text
- Generated HAProxy configuration that is unsafe because of a tool defect
- Handling of browser-local data, clearing, export and backup behavior
- Source allowlist generation and simulation correctness
- Supply-chain or workflow issues in this repository

### Out of scope

- Vulnerabilities in HAProxy itself
- Whether a generated configuration is correct for your environment
- A configuration that is invalid because it was not tested with the target HAProxy binary
- Reverse proxy, TLS certificate, DNS or firewall misconfiguration outside this project
- Compromised browsers, malicious extensions, shared devices or users with access to the same browser profile
- Social engineering or physical access
- Configurations containing private keys, passwords or tokens that the user chose to paste into the browser

## Security model

```text
Browser tab
  File API ──► parser ──► analyzer ──► topology ──► simulator ──► localStorage
                                                                     │
                                                               up to 100 snapshots
Server / container
  static files + GET /version.json only
```

- There is no account system, API, database, upload endpoint or server-side configuration storage.
- Imported configurations are read by the browser and stored in `localStorage` only.
- The only same-origin fetch is `/version.json` for build metadata.
- There are no external fonts, CDNs, analytics, crash-reporting scripts or third-party requests.
- The container runs as a non-root user with a read-only root filesystem, dropped capabilities and `no-new-privileges` in the included Compose file.
- User-controlled configuration text is escaped before rendering and is never evaluated as code.
- The static server blocks directory indexes and keeps resolved paths inside `public/`.

The app does **not** provide authentication, authorization or transport encryption. Anyone who can reach the server can load the application. Browser-local data is readable by anyone with access to that browser profile or device. If the app is exposed beyond localhost, put it behind an HTTPS reverse proxy with authentication and access control.

## Sensitive data

- Do not paste private keys, passwords, API tokens or other secrets into a configuration. Reference files with restricted permissions instead.
- Exported configurations and history JSON are plaintext infrastructure documents. Store them securely.
- A malicious browser extension, compromised device or shared browser profile can read workbench data.
- The server operator can serve modified JavaScript. Self-host from a reviewed commit or use a trusted deployment.
- Clearing browser data deletes the local history. Export important work first.

## Source allowlist limitations

Generated source ACLs use HAProxy's `src` fetch, which is the **immediate peer address**. It is not user identity, authentication or a WAF.

- Behind another proxy, NAT or container network, `src` is that device's address. `option forwardfor` does not change it.
- A backend ACL runs after host/SNI routing. Disallowed clients can still reach the listener and other services on it.
- The wizard rejects source allowlists for loopback/bridge placements because HAProxy itself would be the peer (`127.0.0.1`/`::1`).
- The wizard rejects `/0` catch-alls; leaving the allowlist empty is the explicit way to disable the restriction.
- TCP source rules run at the content stage, not at connection accept.
- Use a host/SNI-scoped ACL on the entry frontend, or configure PROXY protocol end-to-end and verify the resulting `src`, when stronger placement is required.

## Disclosure policy

Please report privately and allow time for a fix. After a patched release, the issue may be described in the release notes or a GitHub security advisory. Credit is optional. There is no bug bounty program.

## License

This project is MIT licensed. It is provided as-is, without warranty. See [LICENSE](LICENSE).
