import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { renderDrawio } from '../public/assets/js/config/drawio.js';
import { parseConfig } from '../public/assets/js/config/parser.js';

test('exports an editable draw.io topology with nodes, edges and risk note', () => {
  const model = parseConfig(SAMPLES.find((sample) => sample.id === 'sni-passthrough').text);
  const xml = renderDrawio(model, { version: '1.3.1' });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<mxfile host="HAProxy Workbench"/);
  assert.match(xml, /<diagram id="haproxy-topology"/);
  assert.match(xml, /Use at your own risk/);
  assert.match(xml, /version 1\.3\.1/);
  assert.match(xml, /ft_edge/);
  assert.match(xml, /bk_learning/);
  assert.match(xml, /TLS hand-off/);
  assert.ok((xml.match(/edge="1"/g) || []).length >= 10);
});

test('draw.io export handles a listen section and minimal config', () => {
  const model = parseConfig(`global
defaults
    mode tcp
listen app
    bind *:9000
    server app1 192.0.2.10:9000 check
`);
  const xml = renderDrawio(model);
  assert.match(xml, /listen · TCP/);
  assert.match(xml, /own servers/);
  assert.match(xml, /srv-1/);
});
