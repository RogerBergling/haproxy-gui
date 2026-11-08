import test from 'node:test';
import assert from 'node:assert/strict';

import { parseConfig } from '../public/assets/js/config/parser.js';
import { structureHTML } from '../public/assets/js/pages/workbench.js';

const HOSTILE_MODE = 'http"><img src=x onerror=alert(1)>';

test('normalises unknown mode directives to the inherited default', () => {
  const model = parseConfig(`defaults
    mode ${HOSTILE_MODE}
frontend fe
    bind *:8080
`);

  assert.equal(model.defaults[0].mode, '');
  assert.equal(model.defaults[0].effectiveMode, 'tcp');
  assert.equal(model.frontends[0].effectiveMode, 'tcp');
});

test('escapes a hostile effective mode before inserting it into HTML', () => {
  const model = parseConfig(`frontend fe
    bind *:8080
`);
  model.frontends[0].effectiveMode = HOSTILE_MODE;

  const html = structureHTML(model);

  assert.equal(html.toLowerCase().includes('<img'), false, 'raw mode markup must not be emitted');
  assert.ok(html.includes('&quot;&gt;&lt;IMG'), 'mode must be HTML-escaped');
});
