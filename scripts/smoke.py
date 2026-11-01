#!/usr/bin/env python3
"""HTTP smoke test for the hardened static launcher.

Starts start.py on a free local port, fetches the app shell and key assets,
checks security headers and route behaviour, then stops the server.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request(url: str, method: str = "GET") -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, method=method)
    try:
        with OPENER.open(req, timeout=3) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def main() -> int:
    port = free_port()
    process = subprocess.Popen(
        [
            sys.executable,
            str(ROOT / "start.py"),
            "--host", "127.0.0.1",
            "--port", str(port),
            "--no-browser",
        ],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    failures: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    try:
        ready = False
        for _ in range(60):
            try:
                status, _, _ = request(f"{base}/")
                if status == 200:
                    ready = True
                    break
            except Exception:
                time.sleep(0.15)
        check(ready, "server did not become ready")
        if not ready:
            raise RuntimeError("server not ready")

        status, headers, body = request(f"{base}/")
        check(status == 200, "GET / should return 200")
        check(b"HAProxy Workbench" in body, "home page should contain the app name")
        check("Content-Security-Policy" in headers, "CSP header missing")
        check("frame-ancestors 'none'" in headers.get("Content-Security-Policy", ""), "CSP frame-ancestors missing")
        check(headers.get("X-Frame-Options") == "DENY", "X-Frame-Options should be DENY")
        check(headers.get("X-Content-Type-Options") == "nosniff", "nosniff header missing")
        check("no-store" in headers.get("Cache-Control", ""), "Cache-Control should be no-store")

        for asset in [
            "/assets/css/app.css",
            "/assets/js/app.js",
            "/assets/js/pages/home.js",
            "/assets/js/config/parser.js",
        ]:
            status, _, _ = request(base + asset)
            check(status == 200, f"{asset} should return 200")

        status, _, raw = request(f"{base}/version.json")
        check(status == 200, "version.json should return 200")
        try:
            data = json.loads(raw)
            for key in ("version", "imageTag", "commit", "buildDate"):
                check(key in data, f"version.json missing {key}")
        except json.JSONDecodeError:
            check(False, "version.json is not valid JSON")

        status, _, _ = request(f"{base}/learn/tls")
        check(status == 200, "extension-less deep routes should serve the app shell")

        status, _, _ = request(f"{base}/missing.js")
        check(status == 404, "missing assets should return 404")

        status, _, _ = request(f"{base}/assets")
        check(status == 404, "directory indexes should be disabled")

        status, _, _ = request(f"{base}/", method="POST")
        check(status != 200, "POST must not be served by the static app")

        status, _, _ = request(f"{base}/", method="HEAD")
        check(status == 200, "HEAD / should return 200")
    except Exception as error:  # noqa: BLE001 - smoke test reports any failure
        failures.append(f"unexpected smoke-test error: {error}")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    if failures:
        print("smoke test failed:\n")
        for failure in failures:
            print(f"  - {failure}")
        print()
        return 1
    print(f"smoke test passed on port {port}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
