/**
 * Build metadata is baked into /version.json by the Docker build and is also
 * available when running locally. Fetch only from the same origin.
 */

let cached = null;

export async function loadBuildInfo() {
  if (cached) return cached;
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cached = {
      version: data.version || 'dev',
      imageTag: data.imageTag || 'local',
      commit: data.commit || 'local',
      buildDate: data.buildDate || null,
    };
  } catch {
    cached = { version: 'dev', imageTag: 'local', commit: 'local', buildDate: null };
  }
  return cached;
}

export function formatBuildDate(value) {
  if (!value) return 'local build';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

export function shortCommit(commit) {
  if (!commit || commit === 'local') return 'local';
  return String(commit).slice(0, 12);
}

export function applyBuildInfo(root = document, info) {
  const set = (selector, value) => {
    root.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  };
  set('[data-app-version]', info.version);
  set('[data-image-tag]', info.imageTag);
  set('[data-commit]', shortCommit(info.commit));
  set('[data-build-date]', formatBuildDate(info.buildDate));
  set('[data-build-time]', info.buildDate ? new Date(info.buildDate).toISOString() : 'not recorded');

  root.querySelectorAll('[data-commit-link]').forEach((element) => {
    if (/^[0-9a-f]{7,40}$/i.test(info.commit)) {
      element.href = `https://github.com/RogerBergling/haproxy-gui/commit/${info.commit}`;
      element.title = `Commit ${info.commit}`;
    } else {
      element.removeAttribute('href');
    }
  });
}

export function startClock(element) {
  if (!element) return () => {};
  const render = () => {
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    element.textContent = `${time} · ${zone}`;
    element.dateTime = now.toISOString();
  };
  render();
  const timer = setInterval(render, 1000);
  return () => clearInterval(timer);
}
