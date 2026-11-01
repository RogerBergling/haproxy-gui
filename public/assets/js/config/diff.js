/**
 * Small line diff used for config previews and version history.
 * The common prefix/suffix is trimmed first, then an LCS matrix is used.
 * Very large unrelated files fall back to a coarse replace block instead of
 * allocating an unbounded matrix.
 */

const MAX_MATRIX_CELLS = 1_800_000;

function split(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  if (normalized === '') return [];
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function coarseDiff(a, b, offsetA, offsetB) {
  const rows = [];
  a.forEach((line, index) => {
    rows.push({ type: 'del', text: line, aLine: offsetA + index + 1, bLine: null });
  });
  b.forEach((line, index) => {
    rows.push({ type: 'add', text: line, aLine: null, bLine: offsetB + index + 1 });
  });
  return rows;
}

export function diffLines(before, after, options = {}) {
  const context = options.context ?? 3;
  const a = split(before);
  const b = split(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const rows = [];
  for (let index = 0; index < prefix; index += 1) {
    rows.push({ type: 'same', text: a[index], aLine: index + 1, bLine: index + 1 });
  }

  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  const cells = (middleA.length + 1) * (middleB.length + 1);

  if (cells > MAX_MATRIX_CELLS) {
    rows.push(...coarseDiff(middleA, middleB, prefix, prefix));
  } else {
    const n = middleA.length;
    const m = middleB.length;
    const matrix = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        matrix[i][j] = middleA[i] === middleB[j]
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (middleA[i] === middleB[j]) {
        rows.push({
          type: 'same',
          text: middleA[i],
          aLine: prefix + i + 1,
          bLine: prefix + j + 1,
        });
        i += 1;
        j += 1;
      } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
        rows.push({ type: 'del', text: middleA[i], aLine: prefix + i + 1, bLine: null });
        i += 1;
      } else {
        rows.push({ type: 'add', text: middleB[j], aLine: null, bLine: prefix + j + 1 });
        j += 1;
      }
    }
    while (i < n) {
      rows.push({ type: 'del', text: middleA[i], aLine: prefix + i + 1, bLine: null });
      i += 1;
    }
    while (j < m) {
      rows.push({ type: 'add', text: middleB[j], aLine: null, bLine: prefix + j + 1 });
      j += 1;
    }
  }

  for (let index = 0; index < suffix; index += 1) {
    const aIndex = a.length - suffix + index;
    const bIndex = b.length - suffix + index;
    rows.push({ type: 'same', text: a[aIndex], aLine: aIndex + 1, bLine: bIndex + 1 });
  }

  const added = rows.filter((row) => row.type === 'add').length;
  const removed = rows.filter((row) => row.type === 'del').length;
  const unchanged = rows.filter((row) => row.type === 'same').length;

  // Group changed rows with surrounding context into renderable hunks.
  const changedIndexes = rows
    .map((row, index) => (row.type === 'same' ? -1 : index))
    .filter((index) => index >= 0);
  const hunks = [];
  let current = null;

  for (const index of changedIndexes) {
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    if (current && from <= current.to + 1) {
      current.to = Math.max(current.to, to);
    } else {
      current = { from, to };
      hunks.push(current);
    }
  }
  for (const hunk of hunks) hunk.rows = rows.slice(hunk.from, hunk.to + 1);

  return {
    rows,
    hunks,
    added,
    removed,
    unchanged,
    changed: added + removed > 0,
    beforeLines: a.length,
    afterLines: b.length,
  };
}

export function changedCount(before, after) {
  const result = diffLines(before, after);
  return result.added + result.removed;
}
