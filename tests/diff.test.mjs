import test from 'node:test';
import assert from 'node:assert/strict';

import { diffLines } from '../public/assets/js/config/diff.js';
import { applyEdits, appendBlock, routeInsertionLine } from '../public/assets/js/config/edit.js';
import { parseConfig } from '../public/assets/js/config/parser.js';

test('computes added, removed and unchanged lines', () => {
  const before = 'global\n    log /dev/log local0\n\ndefaults\n    mode http\n';
  const after = 'global\n    log /dev/log local0\n    maxconn 5000\n\ndefaults\n    mode http\n    timeout connect 5s\n';
  const diff = diffLines(before, after);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 0);
  assert.equal(diff.unchanged, 5);
  assert.ok(diff.hunks.length >= 1);
  assert.ok(diff.rows.some((row) => row.type === 'add' && row.text.includes('maxconn')));
});

test('handles modifications and deletions', () => {
  const diff = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.ok(diff.rows.some((row) => row.type === 'del' && row.text === 'b'));
  assert.ok(diff.rows.some((row) => row.type === 'add' && row.text === 'B'));
});

test('applies multiple line edits bottom-up without shifting anchors', () => {
  const source = 'one\ntwo\nthree\nfour\n';
  const result = applyEdits(source, [
    { type: 'insert', line: 2, lines: ['inserted after one'] },
    { type: 'replace', line: 3, text: 'THREE' },
    { type: 'insert', line: 4, lines: ['before four'] },
  ]);
  assert.equal(result, 'one\ninserted after one\ntwo\nTHREE\nbefore four\nfour\n');
});

test('appends backend blocks with predictable blank lines', () => {
  const result = appendBlock('global\n', ['backend bk', '\tserver app 192.0.2.1:80']);
  assert.equal(result, 'global\n\nbackend bk\n\tserver app 192.0.2.1:80\n');
});

test('finds the insertion point before default_backend', () => {
  const model = parseConfig(`global
defaults
    mode http
frontend fe
    bind *:80
    use_backend bk_a if { hdr(host) -i a.example.com }
    default_backend bk_default
backend bk_a
    server a 192.0.2.1:80
backend bk_default
    server d 192.0.2.2:80
`);
  const frontend = model.frontends[0];
  const line = routeInsertionLine(frontend);
  assert.ok(line > 1);
  assert.equal(model.lines[line - 1].trim(), 'default_backend bk_default');
});
