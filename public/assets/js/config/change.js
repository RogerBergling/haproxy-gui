/**
 * Stamp generated changes into the configuration itself.
 *
 * A single replaceable marker keeps one current date/time/action annotation
 * instead of accumulating a new comment every time a fix is previewed or
 * applied. The marker is a valid HAProxy comment and is ignored by the parser.
 */

const MARKER = '# Modified by HAProxy Workbench on ';

export function stampWorkbenchChange(text, action, when = new Date()) {
  const timestamp = (when instanceof Date ? when : new Date(when)).toISOString();
  const cleanAction = String(action || 'Configuration change')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  const line = `${MARKER}${timestamp}: ${cleanAction}. Use at your own risk; validate with haproxy -c before deployment.`;
  const normalized = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let replaced = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith(MARKER)) continue;
    if (!replaced) {
      lines[index] = line;
      replaced = true;
    } else {
      lines.splice(index, 1);
      index -= 1;
    }
  }

  if (!replaced) lines.unshift(line);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

export { MARKER };
