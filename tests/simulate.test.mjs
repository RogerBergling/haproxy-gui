import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { parseConfig } from '../public/assets/js/config/parser.js';
import { evaluateCondition, simulateRequest } from '../public/assets/js/config/simulate.js';

const sampleA = SAMPLES.find((sample) => sample.id === 'sni-passthrough').text;
const sampleB = SAMPLES.find((sample) => sample.id === 'edge-tls').text;

test('follows SNI passthrough into loopback TLS termination and a backend', () => {
  const model = parseConfig(sampleA);
  const result = simulateRequest(model, {
    scheme: 'https',
    host: 'learning.example.com',
    sni: 'learning.example.com',
    port: '443',
    path: '/',
  });
  assert.equal(result.code, 200);
  assert.equal(result.outcome, 'response');
  assert.equal(result.backend, 'bk_learning');
  assert.equal(result.server.name, 'learning');
  assert.ok(result.steps.some((step) => step.kind === 'handoff'));
  assert.ok(result.steps.some((step) => step.kind === 'entry' && /ft_example_tls/.test(step.title)));
  assert.match(result.summary, /bk_learning/);
});

test('routes passthrough SNI to a TCP backend without HTTP parsing', () => {
  const model = parseConfig(sampleA);
  const result = simulateRequest(model, {
    scheme: 'https',
    host: 'ssh.example.net',
    sni: 'ssh.example.net',
    port: '443',
  });
  assert.equal(result.code, 'tunnel');
  assert.equal(result.outcome, 'tunnel');
  assert.equal(result.backend, 'bk_ssh');
  assert.equal(result.server.name, 'ssh');
});

test('rejects unknown SNI via the TCP default backend', () => {
  const model = parseConfig(sampleA);
  const result = simulateRequest(model, {
    scheme: 'https',
    host: 'unknown.example.org',
    sni: 'unknown.example.org',
    port: '443',
  });
  assert.equal(result.outcome, 'reset');
  assert.equal(result.backend, 'bk_default');
  assert.equal(result.ok, false);
});

test('simulates sample B over HTTPS and HTTP', () => {
  const model = parseConfig(sampleB);
  const httpsResult = simulateRequest(model, {
    scheme: 'https',
    host: 'example.com',
    sni: 'example.com',
    port: '443',
    path: '/',
  });
  assert.equal(httpsResult.code, 200);
  assert.equal(httpsResult.backend, 'nodes');
  assert.equal(httpsResult.server.name, 'node-1');

  const httpResult = simulateRequest(model, {
    scheme: 'http',
    host: 'example.com',
    port: '80',
    path: '/',
  });
  assert.equal(httpResult.code, 200);
  assert.equal(httpResult.backend, 'nodes');
});

test('returns 503 when all servers are marked down', () => {
  const model = parseConfig(sampleB);
  const result = simulateRequest(model, {
    scheme: 'https',
    host: 'example.com',
    sni: 'example.com',
    port: '443',
    downServers: ['nodes/node-1'],
  });
  assert.equal(result.code, 503);
  assert.equal(result.backend, 'nodes');
  assert.equal(result.server, null);
});

test('routes a listen section to its own server pool', () => {
  const model = parseConfig(`global
defaults
    mode tcp
listen app
    bind *:9000
    server app1 192.0.2.10:9000 check
`);
  const result = simulateRequest(model, {
    scheme: 'tcp',
    host: 'app.example.com',
    sni: 'app.example.com',
    port: '9000',
  });
  assert.equal(result.outcome, 'tunnel');
  assert.equal(result.frontend, 'app');
  assert.equal(result.backend, 'app');
  assert.equal(result.server.name, 'app1');
});

test('refuses a port with no listener', () => {
  const model = parseConfig(sampleA);
  const result = simulateRequest(model, {
    scheme: 'http',
    host: 'learning.example.com',
    port: '80',
  });
  assert.equal(result.outcome, 'refused');
  assert.equal(result.code, 'refused');
});

test('evaluates exact, suffix and negated ACLs safely', () => {
  const model = parseConfig(`global
defaults
    mode tcp
frontend fe
    bind *:443
    use_backend bk_suffix if { req_ssl_sni -m end .example.com }
    use_backend bk_exact if { req_ssl_sni -i exact.example.net }
    default_backend bk_default
backend bk_suffix
    server s 192.0.2.1:443
backend bk_exact
    server e 192.0.2.2:443
backend bk_default
    server d 192.0.2.3:443
`);
  const request = {
    scheme: 'https', host: 'notexample.com', sni: 'notexample.com', port: '443', path: '/', method: 'GET',
    source: '203.0.113.10', headers: {},
  };
  const context = { tlsTerminated: false, httpVisible: false };
  const suffix = evaluateCondition(['{', 'req_ssl_sni', '-m', 'end', '.example.com', '}'], false, request, context, model.frontends[0]);
  assert.equal(suffix.matched, false, 'a dot-prefixed suffix must not match notexample.com');
  const exact = evaluateCondition(['{', 'req_ssl_sni', '-i', 'exact.example.net', '}'], false, request, context, model.frontends[0]);
  assert.equal(exact.matched, false);
  const negated = evaluateCondition(['{', 'req_ssl_sni', '-m', 'end', '.example.com', '}'], true, request, context, model.frontends[0]);
  assert.equal(negated.matched, true);
});

test('reports unsupported ACLs instead of silently pretending to route', () => {
  const model = parseConfig(`global
defaults
    mode http
frontend fe
    bind *:80
    use_backend bk if { does_not_exist(foo) -i bar }
    default_backend bk
backend bk
    server app 192.0.2.10:80
`);
  const result = simulateRequest(model, { scheme: 'http', host: 'example.com', port: '80' });
  assert.equal(result.backend, 'bk');
  assert.ok(result.warnings.some((warning) => /unsupported/i.test(warning)));
});
