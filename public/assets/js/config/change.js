/**
 * Append generated changes to an in-file changelog.
 *
 * Every change prepends a new dated entry and leaves all previous entries
 * untouched, so the configuration keeps its full modification history. The
 * marker lines are valid HAProxy comments and are ignored by the parser.
 * Newest entries are at the top; an exact duplicate is not added twice.
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

  if (!lines.includes(line)) lines.unshift(line);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

export { MARKER };
