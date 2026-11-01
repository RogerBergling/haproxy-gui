/**
 * Detect the "design language" of an existing HAProxy config so generated
 * service blocks follow it instead of imposing tabs, comments or section order.
 */

function indentOfLine(line) {
  const match = String(line ?? '').match(/^(\s+)/);
  return match ? match[1] : '';
}

export function detectConfigStyle(model) {
  const indentCounts = new Map();
  for (const section of model.sections) {
    for (const item of section.items) {
      const indent = indentOfLine(model.lines[item.line - 1]);
      if (!indent) continue;
      indentCounts.set(indent, (indentCounts.get(indent) || 0) + 1);
    }
  }

  let indent = '\t';
  let best = 0;
  for (const [value, count] of indentCounts) {
    if (count > best) {
      best = count;
      indent = value;
    }
  }

  const commentLines = model.lines.filter((line) => line.trim().startsWith('#'));
  const hasBoxComment = commentLines.some((line) => /^#\s*[=-]{8,}/.test(line.trim()));
  const separatorChar = commentLines.some((line) => /^#\s*={8,}/.test(line.trim())) ? '=' : '-';
  const uppercaseHeadings = commentLines.some((line) => /^#\s+[A-Z][A-Z0-9 _/:-]{5,}$/.test(line.trim()));

  return {
    indent,
    indentLabel: indent === '\t' ? 'tabs' : `${indent.length} spaces`,
    boxComments: hasBoxComment,
    separatorChar,
    uppercaseHeadings,
    commentCount: commentLines.length,
    blankLineBetweenSections: /\n\s*\n\s*(?:frontend|backend|global|defaults|listen)\b/.test(model.text),
  };
}

export function styleLines(style, lines) {
  return lines.map((line) => (line.startsWith('\t') ? `${style.indent}${line.slice(1)}` : line));
}

export function resourceComment(style, title, details = []) {
  const cleanDetails = details.filter(Boolean);
  if (style.boxComments) {
    const rule = `# ${style.separatorChar.repeat(60)}`;
    return [
      rule,
      `# ${style.uppercaseHeadings ? title.toUpperCase() : title}`,
      ...cleanDetails.map((detail) => `# ${detail}`),
      rule,
    ];
  }
  return [
    `# ${style.uppercaseHeadings ? title.toUpperCase() : title}`,
    ...cleanDetails.map((detail) => `# ${detail}`),
  ];
}

export function routeComment(style, hosts, backend) {
  const label = hosts.length === 1 ? hosts[0] : `${hosts.length} hosts`;
  return style.boxComments
    ? resourceComment(style, `Route: ${label}`, [`Backend: ${backend}`])
    : [`# Route: ${label} -> ${backend}`];
}

/** Style summary shown in the wizard review. */
export function describeStyle(style) {
  return `${style.indentLabel} indentation, ${style.boxComments ? 'boxed section comments' : 'simple comments'}${style.uppercaseHeadings ? ', uppercase headings' : ''}`;
}
