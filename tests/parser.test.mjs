import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import {
  findBackend,
  getTimeout,
  parseConfig,
  tokenize,
} from '../public/assets/js/config/parser.js';

const sampleA = SAMPLES.find((sample) => sample.id === 'sni-passthrough').text;
const sampleB = SAMPLES.find((sample) => sample.id === 'edge-tls').text;

test('tokenizes quotes, comments, escapes and whitespace', () => {
  assert.deepEqual(
    tokenize('log-format "sni=%[capture.req.hdr(0)]" # access log'),
    ['log-format', 'sni=%[capture.req.hdr(0)]'],
  );
  assert.deepEqual(tokenize("http-request return status 200 string 'hello world'"), [
    'http-request', 'return', 'status', '200', 'string', 'hello world',
  ]);
  assert.deepEqual(tokenize('log /dev/log local0 # comment'), ['log', '/dev/log', 'local0']);
  assert.deepEqual(tokenize('description "hash # is inside quotes"'), ['description', 'hash # is inside quotes']);
});

test('parses both anonymised examples without structural errors', () => {
  for (const sample of SAMPLES) {
    const model = parseConfig(sample.text);
    assert.equal(
      model.issues.filter((issue) => issue.severity === 'error').length,
      0,
      `${sample.id} should have no parser errors`,
    );
    assert.equal(model.global?.type, 'global');
    assert.ok(model.stats.lines > 50);
    assert.ok(model.stats.frontends >= 2);
    assert.ok(model.stats.servers >= 1);
  }
});

test('builds section ranges, binds, routes and servers for sample A', () => {
  const model = parseConfig(sampleA);
  assert.equal(model.stats.frontends, 2);
  assert.equal(model.stats.backends, 10);
  assert.equal(model.stats.rules, 12);
  const edge = model.frontends.find((frontend) => frontend.name === 'ft_edge');
  assert.equal(edge.effectiveMode, 'tcp');
  assert.equal(edge.binds[0].port, '443');
  assert.equal(edge.binds[0].ssl, false);
  assert.equal(edge.defaultBackend, 'bk_default');
  const internal = model.frontends.find((frontend) => frontend.name === 'ft_example_tls');
  assert.equal(internal.binds[0].host, '127.0.0.1');
  assert.equal(internal.binds[0].port, '8443');
  assert.equal(internal.binds[0].ssl, true);
  assert.equal(internal.binds[0].cert, '/etc/haproxy/certs/example.pem');
  const learning = findBackend(model, 'bk_learning');
  assert.equal(learning.effectiveMode, 'http');
  assert.equal(learning.servers[0].name, 'learning');
  assert.equal(learning.servers[0].host, '192.0.2.40');
  assert.equal(learning.servers[0].port, '8003');
  assert.equal(getTimeout(model.defaults[0], 'connect').timeoutValue, '5000');
});

test('detects an unbounded frontend in sample B and explains duplicate binds', () => {
  const model = parseConfig(sampleB);
  const clientcert = model.frontends.find((frontend) => frontend.name === 'clientcert');
  assert.equal(clientcert.binds.length, 0);
  assert.ok(model.issues.some((issue) => issue.code === 'frontend-no-bind'));

  const duplicate = parseConfig(`global
defaults
    mode http
frontend fe_one
    bind *:8080
frontend fe_two
    bind 0.0.0.0:8080
`);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'bind-duplicate'));
});

test('detects missing backend references and HTTP directives in TCP mode', () => {
  const model = parseConfig(`global
defaults
    mode tcp
frontend fe
    bind *:9000
    http-request deny
    use_backend missing
    default_backend also_missing
`);
  assert.ok(model.issues.some((issue) => issue.code === 'use-backend-missing'));
  assert.ok(model.issues.some((issue) => issue.code === 'default-backend-missing'));
  assert.ok(model.issues.some((issue) => issue.code === 'http-directive-in-tcp'));
  assert.ok(model.issues.some((issue) => issue.code === 'frontend-no-routing') === false);
});

test('models a listen section as both frontend and backend', () => {
  const model = parseConfig(`global
defaults
    mode tcp
listen app
    bind *:9000
    server app1 192.0.2.10:9000 check
`);
  assert.equal(model.stats.listens, 1);
  assert.equal(model.stats.frontends, 0);
  assert.equal(model.stats.backends, 0);
  assert.ok(model.frontends.some((section) => section.name === 'app'));
  assert.ok(model.backends.some((section) => section.name === 'app'));
  assert.ok(!model.issues.some((issue) => issue.code === 'frontend-no-routing'));
});

test('normalises CRLF, BOM and line continuations', () => {
  const model = parseConfig('\uFEFFglobal\r\n    log /dev/log local0\r\n\r\ndefaults\r\n    mode http\r\n    timeout connect 5s \\\r\n        # continued\r\nfrontend fe\r\n    bind *:80\r\n    default_backend bk\r\nbackend bk\r\n    server app 192.0.2.10:80\r\n');
  assert.equal(model.lines[0], 'global');
  assert.equal(model.text.includes('\r'), false);
  assert.equal(model.stats.frontends, 1);
  assert.equal(model.stats.backends, 1);
  assert.equal(getTimeout(model.defaults[0], 'connect').timeoutValue, '5s');
});

test('keeps real-world markers and comments intact in the source', () => {
  const model = parseConfig(sampleB);
  assert.ok(model.text.includes('#<----------START_BACKEND---------->'));
  assert.ok(model.text.includes('#log /dev/log    local1 notice'));
});
