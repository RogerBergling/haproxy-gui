/**
 * Text-edit helpers shared by the service wizard and best-practice fixes.
 * Edits are anchored to 1-based line numbers and applied bottom-up so earlier
 * edits cannot shift later anchors.
 */

export function normalizeText(text) {
  return String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function ensureTrailingNewline(text) {
  const normalized = normalizeText(text);
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

export function textLines(text) {
  return normalizeText(text).split('\n');
}

/** Apply {type:'insert', line, lines} and {type:'replace', line, text} edits. */
export function applyEdits(text, edits) {
  const lines = textLines(text);
  const sorted = [...edits].sort((left, right) => {
    if (left.line !== right.line) return right.line - left.line;
    if (left.type === right.type) return 0;
    return left.type === 'replace' ? -1 : 1;
  });

  for (const edit of sorted) {
    const index = Math.max(0, Math.min(lines.length, edit.line - 1));
    if (edit.type === 'replace') {
      lines[index] = edit.text;
    } else if (edit.type === 'delete') {
      lines.splice(index, 1);
    } else {
      lines.splice(index, 0, ...edit.lines);
    }
  }
  return lines.join('\n');
}

export function insertLines(text, line, lines) {
  return applyEdits(text, [{ type: 'insert', line, lines }]);
}

export function replaceLine(text, line, replacement) {
  return applyEdits(text, [{ type: 'replace', line, text: replacement }]);
}

export function appendBlock(text, blockLines) {
  const base = normalizeText(text).replace(/\s+$/, '');
  const block = blockLines.join('\n').replace(/\s+$/, '');
  if (!base) return `${block}\n`;
  return `${base}\n\n${block}\n`;
}

/** Point immediately before default_backend, or after the frontend section. */
export function routeInsertionLine(frontend) {
  const defaultBackend = frontend.items.find((item) => item.keyword === 'default_backend');
  if (defaultBackend) return defaultBackend.line;
  return frontend.endLine + 1;
}

/** Point before the first line of a section's body. */
export function sectionBodyInsertionLine(section) {
  return section.line + 1;
}

export function indentOf(line) {
  const match = String(line).match(/^\s*/);
  return match ? match[0] : '';
}

export function findItemLine(section, keyword) {
  return section.items.find((item) => item.keyword === keyword)?.line || null;
}

/** Ensure a directive exists in a section; returns an edit or null. */
export function insertDirectiveEdit(section, lines, beforeLine = null) {
  if (!section) return null;
  return {
    type: 'insert',
    line: beforeLine || section.endLine + 1,
    lines,
  };
}

/** Ensure there is exactly one blank line between appended sections. */
export function tidyTail(text) {
  return ensureTrailingNewline(normalizeText(text).replace(/[ \t]+$/gm, ''));
}
