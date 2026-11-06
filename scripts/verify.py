#!/usr/bin/env python3
"""Static verification for the HAProxy Workbench repository.

Checks required files, local module references, security headers, packaging,
documentation slugs and the anonymisation of example data. This complements the
unit tests; it does not run a browser.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PRIVATE_MARKERS_FILE = ROOT / "scripts" / "private-markers.txt"
ERRORS: list[str] = []
CHECKS = 0

# These are deliberately fake examples. Real private markers belong in the
# gitignored scripts/private-markers.txt or in the
# HAPROXY_WORKBENCH_PRIVATE_MARKERS environment variable, never in this file.
DEFAULT_PRIVATE_MARKERS = [
    "private.invalid",
    "192.0.2.254",
    "example-agency",
    "service-a.private.invalid",
    "service-b.private.invalid",
]


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        ERRORS.append(message)


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        ERRORS.append(f"Missing required file: {path.relative_to(ROOT)}")
        return ""


def load_private_markers() -> list[str]:
    """Load fake defaults plus optional local/CI markers that are not published."""
    markers = list(DEFAULT_PRIVATE_MARKERS)
    if PRIVATE_MARKERS_FILE.is_file():
        try:
            markers.extend(
                line.strip()
                for line in PRIVATE_MARKERS_FILE.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            )
        except OSError:
            pass
    markers.extend(
        line.strip()
        for line in os.environ.get("HAPROXY_WORKBENCH_PRIVATE_MARKERS", "").splitlines()
        if line.strip()
    )
    return sorted(set(markers))


def require(path: str) -> None:
    check((ROOT / path).is_file(), f"Missing required file: {path}")


def main() -> int:
    for path in [
        "README.md",
        "LICENSE",
        "package.json",
        "Dockerfile",
        "compose.yaml",
        ".dockerignore",
        "start.py",
        "public/index.html",
        "public/LICENSE.txt",
        "public/version.json",
        "public/assets/css/app.css",
        "public/assets/js/app.js",
        "public/assets/js/config/parser.js",
        "public/assets/js/config/analyzer.js",
        "public/assets/js/config/simulate.js",
        "public/assets/js/config/wizard.js",
        "public/assets/js/config/bestpractices.js",
        "public/assets/js/config/style.js",
        "public/assets/js/config/change.js",
        "public/assets/js/config/drawio.js",
        "public/assets/js/pages/compare.js",
        "public/assets/js/data/samples.js",
        "public/assets/js/data/learn.js",
        "public/assets/js/data/glossary.js",
        "public/assets/js/data/versions.js",
        "scripts/smoke.py",
        "scripts/check-js.mjs",
        ".github/workflows/ci.yml",
        ".github/workflows/docker-publish.yml",
        "docs/screenshots/home.png",
        "docs/screenshots/workbench.png",
        "docs/screenshots/analyze.png",
        "docs/screenshots/topology.png",
        "docs/screenshots/services.png",
        "docs/screenshots/security.png",
        "docs/screenshots/fix-dialog.png",
        "docs/screenshots/learning.png",
        "docs/screenshots/compare.png",
    ]:
        require(path)

    index = read(PUBLIC / "index.html")
    check("/assets/css/app.css" in index, "index.html must reference the local stylesheet")
    check("/assets/js/app.js" in index, "index.html must reference the local app module")
    check(
        not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", index),
        "index.html must not contain inline scripts (CSP script-src 'self')",
    )
    check(
        not re.search(r"<(?:link|script)[^>]+(?:href|src)=[\"']https?://", index),
        "index.html must not load external CSS or JavaScript",
    )
    check(
        not re.search(r"<link[^>]+rel=[\"']stylesheet[\"'][^>]+href=[\"'](?![/])", index),
        "stylesheet references must be local absolute paths",
    )
    for marker in ("data-build-number", "data-live-clock", "data-build-date"):
        check(marker in index, f"index.html lacks the build stamp slot: {marker}")
    version_js = read(PUBLIC / "assets/js/version.js")
    for marker in ("hourCycle: 'h23'", "data-build-number", "buildNumber", "formatBuildDate"):
        check(marker in version_js, f"version.js missing build/clock marker: {marker}")

    # Local ES module imports must resolve.
    js_files = sorted((PUBLIC / "assets" / "js").rglob("*.js"))
    check(len(js_files) >= 10, "expected a multi-module JavaScript application")
    import_pattern = re.compile(r"(?:from\s+|import\s*\()\s*[\"'](\.[^\"']+)[\"']")
    for file in js_files:
        content = read(file)
        for target in import_pattern.findall(content):
            resolved = (file.parent / target).resolve()
            check(resolved.is_file(), f"{file.relative_to(ROOT)} imports missing module {target}")

    # Documentation slugs used by findings and directive guides must exist.
    learn = read(PUBLIC / "assets/js/data/learn.js")
    article_slugs = set(re.findall(r"slug:\s*'([^']+)'", learn))
    check(len(article_slugs) >= 8, "expected at least eight learning articles")
    docs_slugs = set(re.findall(r"docs:\s*'([^']+)'", read(PUBLIC / "assets/js/config/analyzer.js")))
    for slug in sorted(docs_slugs):
        check(slug in article_slugs, f"analyzer links to missing learn article: {slug}")

    # Version-specific guidance must include the key upgrade facts.
    versions = read(PUBLIC / "assets/js/data/versions.js")
    for fact in ["3.3", "3.4", "program", "mailers", "ocsp-update", "duplicate"]:
        check(fact.lower() in versions.lower(), f"version guide is missing expected topic: {fact}")

    # Security headers in the Python server.
    start = read(ROOT / "start.py")
    for header in [
        "Content-Security-Policy",
        "script-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "Referrer-Policy",
        "X-Content-Type-Options",
        "Cross-Origin-Opener-Policy",
    ]:
        check(header in start, f"start.py is missing security header directive: {header}")
    check("list_directory" in start and "send_error(404" in start, "directory listing must be disabled")
    check("server_version" in start, "start.py must override the default server banner")
    check("version_string" in start, "start.py must not advertise the Python runtime")
    check("isprintable" in start, "start.py must sanitize request-log output")

    # Packaging.
    dockerfile = read(ROOT / "Dockerfile")
    check(
        bool(re.search(r"^USER\s+(?!root\b)\S+", dockerfile, re.MULTILINE)),
        "Dockerfile must run as a non-root user",
    )
    check("HEALTHCHECK" in dockerfile, "Dockerfile must define a healthcheck")
    check("public/version.json" in dockerfile, "Dockerfile must bake build metadata")
    compose = read(ROOT / "compose.yaml")
    check("ghcr.io/rogerbergling/haproxy-gui:latest" in compose, "compose must use the GHCR image")
    check("read_only: true" in compose, "compose must use a read-only filesystem")
    check("no-new-privileges:true" in compose, "compose must set no-new-privileges")
    check("cap_drop:" in compose, "compose must drop Linux capabilities")
    check("8004:8080" in compose, "compose must publish the documented port")
    check("watchtower:" not in compose.lower(), "compose must not include Watchtower")
    check("/var/run/docker.sock" not in compose, "compose must not mount the Docker socket")
    check("DOCKER_API_VERSION" not in compose, "compose must not pin a Watchtower Docker API version")

    publish = read(ROOT / ".github/workflows/docker-publish.yml")
    check("ghcr.io" in publish, "publish workflow must target GHCR")
    check("linux/amd64,linux/arm64" in publish, "publish workflow must build multi-arch")
    check("packages: write" in publish, "publish workflow needs packages: write")

    # Version metadata.
    try:
        version = json.loads(read(PUBLIC / "version.json"))
        for key in ("version", "imageTag", "commit", "buildDate"):
            check(key in version, f"version.json is missing key: {key}")
    except json.JSONDecodeError:
        ERRORS.append("public/version.json is not valid JSON")

    package = json.loads(read(ROOT / "package.json"))
    check(package.get("type") == "module", "package.json must be an ES module package")
    check("node --test" in package.get("scripts", {}).get("test", ""), "npm test must run node --test")

    # Personal data from the source configs must not leak into examples or docs.
    # The public defaults are fake; real markers are loaded from the optional
    # local file or environment variable so they are never committed.
    forbidden = load_private_markers()
    text_files = [
        file for file in ROOT.rglob("*")
        if file.is_file()
        and ".git" not in file.parts
        and file.suffix in {".js", ".json", ".md", ".py", ".yml", ".yaml", ".html", ".css", ".cfg"}
    ]
    for file in text_files:
        if file.resolve() in (Path(__file__).resolve(), PRIVATE_MARKERS_FILE.resolve()):
            continue
        content = read(file)
        for marker in forbidden:
            check(marker not in content, f"private data marker '{marker}' found in {file.relative_to(ROOT)}")

    if ERRORS:
        print(f"verification failed: {len(ERRORS)} issue(s) across {CHECKS} checks\n")
        for error in ERRORS:
            print(f"  - {error}")
        print()
        return 1

    print(f"verification passed: {CHECKS} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
