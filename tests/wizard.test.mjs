import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { analyzeConfig } from '../public/assets/js/config/analyzer.js';
import { parseConfig } from '../public/assets/js/config/parser.js';
import { simulateRequest } from '../public/assets/js/config/simulate.js';
import { buildServicePlan, serviceCandidates } from '../public/assets/js/config/wizard.js';

const sampleA = SAMPLES.find((sample) => sample.id === 'sni-passthrough').text;
const sampleB = SAMPLES.find((sample) => sample.id === 'edge-tls').text;

test('discovers the loopback bridge in sample A and routes a new HTTPS host end to end', () => {
  const model = parseConfig(sampleA);
  const candidates = serviceCandidates(model, 'https');
  assert.ok(candidates.some((candidate) => candidate.kind === 'bridge' && /ft_example_tls/.test(candidate.label)));

  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'newapp',
    hosts: 'new.example.com',
    server: '192.0.2.60:9000',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.kind, 'bridge');
  assert.equal(plan.target.frontend.name, 'ft_example_tls');
  assert.equal(plan.target.edgeFrontend.name, 'ft_edge');
  assert.match(plan.proposed, /req_ssl_sni -i new\.example\.com/);
  assert.match(plan.proposed, /hdr\(host\) -i new\.example\.com/);
  assert.match(plan.proposed, /backend bk_newapp/);

  const proposedModel = parseConfig(plan.proposed);
  assert.equal(
    proposedModel.issues.filter((issue) => issue.severity === 'error').length,
    0,
    'the generated config must still parse',
  );
  const result = simulateRequest(proposedModel, plan.request);
  assert.equal(result.code, 200);
  assert.equal(result.backend, 'bk_newapp');
  assert.equal(result.server.name, 'newapp');
  assert.equal(result.frontend, 'ft_example_tls');
});

test('places a new HTTPS host directly on an existing TLS frontend', () => {
  const model = parseConfig(sampleB);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'api',
    hosts: 'api.example.com',
    server: '192.0.2.70:8080',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.kind, 'direct');
  assert.equal(plan.target.frontend.name, 'http-https');
  assert.equal(plan.request.port, '443');
  assert.match(plan.proposed, /use_backend bk_api if \{ hdr\(host\) -i api\.example\.com \}/);
  const result = simulateRequest(parseConfig(plan.proposed), plan.request);
  assert.equal(result.code, 200);
  assert.equal(result.backend, 'bk_api');
});

test('creates a new HTTP frontend when no plain HTTP listener exists', () => {
  const model = parseConfig(sampleA);
  const plan = buildServicePlan(model, {
    kind: 'http',
    name: 'www',
    hosts: 'www.example.com',
    server: '192.0.2.61:8080',
    entryPort: '80',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.newFrontend, true);
  assert.match(plan.proposed, /frontend ft_www/);
  assert.match(plan.proposed, /bind \*:80/);
  assert.match(plan.proposed, /option forwardfor/);
  const result = simulateRequest(parseConfig(plan.proposed), plan.request);
  assert.equal(result.code, 200);
  assert.equal(result.backend, 'bk_www');
});

test('adds a TCP/SNI passthrough service above existing wildcard/default routing', () => {
  const model = parseConfig(sampleA);
  const plan = buildServicePlan(model, {
    kind: 'tcp',
    name: 'database',
    hosts: 'db.example.net',
    server: '192.0.2.62:5432',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.frontend.name, 'ft_edge');
  assert.match(plan.proposed, /use_backend bk_database if \{ req_ssl_sni -i db\.example\.net \}/);
  const result = simulateRequest(parseConfig(plan.proposed), plan.request);
  assert.equal(result.outcome, 'tunnel');
  assert.equal(result.backend, 'bk_database');
});

test('supports wildcard hostnames with a suffix condition', () => {
  const model = parseConfig(sampleB);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'wild',
    hosts: '*.apps.example.com',
    server: '192.0.2.71:8443',
    serverSsl: true,
  });
  assert.equal(plan.ok, true);
  assert.match(plan.proposed, /hdr\(host\) -m end \.apps\.example\.com/);
  assert.match(plan.proposed, /server wild 192\.0\.2\.71:8443 .*ssl/);
});

test('refuses a new frontend on an occupied port', () => {
  const model = parseConfig(sampleB);
  const plan = buildServicePlan(model, {
    kind: 'tcp',
    name: 'conflict',
    hosts: 'conflict.example.com',
    server: '192.0.2.80:443',
    entryPort: '443',
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => /already used/.test(error)));
});

test('validates hostnames and server addresses', () => {
  const model = parseConfig(sampleA);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: '',
    hosts: 'https://bad.example.com/path',
    server: 'not a server',
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => /hostname/i.test(error)));
  assert.ok(plan.errors.some((error) => /spaces/i.test(error)));
});

test('can force a new frontend with an explicit listen IP, port and certificate', () => {
  const model = parseConfig(sampleB);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'explicit',
    hosts: 'explicit.example.com',
    server: '192.0.2.88:9000',
    target: 'new',
    bindAddress: '192.0.2.10',
    entryPort: '9443',
    cert: '/etc/haproxy/certs/explicit.pem',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.newFrontend, true);
  assert.equal(plan.target, null);
  assert.equal(plan.bind.raw, '192.0.2.10:9443');
  assert.match(plan.proposed, /frontend ft_explicit/);
  assert.match(plan.proposed, /bind 192\.0\.2\.10:9443 ssl crt \/etc\/haproxy\/certs\/explicit\.pem/);
  const proposed = parseConfig(plan.proposed);
  assert.equal(proposed.issues.filter((issue) => issue.severity === 'error').length, 0);
  const result = simulateRequest(proposed, plan.request);
  assert.equal(result.code, 200);
  assert.equal(result.backend, 'bk_explicit');
});

test('formats IPv6 listen addresses and rejects ports in the address field', () => {
  const model = parseConfig(sampleA);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'ipv6',
    hosts: 'ipv6.example.com',
    server: '192.0.2.89:9000',
    target: 'new',
    bindAddress: '2001:db8::10',
    entryPort: '9444',
    cert: '/etc/haproxy/certs/ipv6.pem',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.bind.raw, '[2001:db8::10]:9444');
  assert.match(plan.proposed, /bind \[2001:db8::10\]:9444/);

  const invalid = buildServicePlan(model, {
    kind: 'http',
    name: 'bad',
    hosts: 'bad.example.com',
    server: '192.0.2.90:8080',
    target: 'new',
    bindAddress: '192.0.2.10:8080',
    entryPort: '8080',
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => /port field/i.test(error)));
});

test('allows a specific new bind on the same port as an unrelated specific bind', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend existing
    bind 192.0.2.10:8080
    default_backend bk
backend bk
    server app 192.0.2.20:80 check
`;
  const model = parseConfig(config);
  const plan = buildServicePlan(model, {
    kind: 'http',
    name: 'second',
    hosts: 'second.example.com',
    server: '192.0.2.21:8080',
    target: 'new',
    bindAddress: '192.0.2.11',
    entryPort: '8080',
  });
  assert.equal(plan.ok, true);
  assert.match(plan.proposed, /bind 192\.0\.2\.11:8080/);

  const conflict = buildServicePlan(model, {
    kind: 'http',
    name: 'conflict',
    hosts: 'conflict.example.com',
    server: '192.0.2.22:8080',
    target: 'new',
    bindAddress: '192.0.2.10',
    entryPort: '8080',
  });
  assert.equal(conflict.ok, false);
  assert.ok(conflict.errors.some((error) => /already used by existing/i.test(error)));
});

test('combines service host names with the domain and supports apex and wildcards', () => {
  const model = parseConfig(sampleB);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'multi',
    domain: 'example.com',
    hosts: 'app, api, @, *.apps',
    server: '192.0.2.99:9000',
    target: 'frontend:http-https',
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.form.hosts, [
    'app.example.com',
    'api.example.com',
    'example.com',
    '*.apps.example.com',
  ]);
  assert.match(plan.proposed, /hdr\(host\) -i app\.example\.com/);
  assert.match(plan.proposed, /hdr\(host\) -i example\.com/);
  assert.match(plan.proposed, /hdr\(host\) -m end \.apps\.example\.com/);
  assert.match(plan.proposed, /^# Modified by HAProxy Workbench on /m);
  assert.match(plan.proposed, /Use at your own risk/);

  const shortOnly = buildServicePlan(model, {
    kind: 'https',
    hosts: 'app',
    server: '192.0.2.99:9000',
  });
  assert.equal(shortOnly.ok, false);
  assert.ok(shortOnly.errors.some((error) => /only a host name/i.test(error)));

  const fqdn = buildServicePlan(model, {
    kind: 'https',
    domain: 'example.com',
    hosts: 'api.example.net',
    server: '192.0.2.99:9000',
  });
  assert.deepEqual(fqdn.form.hosts, ['api.example.net']);
});

test('follows detected indentation, comment style and section order', () => {
  const config = `# ============================================================
# Sample
# ============================================================
global
    log /dev/log local0

defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s

frontend existing
    bind *:80
    default_backend bk

backend bk
    server app 192.0.2.10:80 check
`;
  const model = parseConfig(config);
  const plan = buildServicePlan(model, {
    kind: 'https',
    name: 'styled',
    domain: 'example.com',
    hosts: 'styled',
    server: '192.0.2.30:9000',
    target: 'new',
    bindAddress: '192.0.2.10',
    entryPort: '9446',
    cert: '/etc/haproxy/certs/example.com.pem',
  });
  assert.equal(plan.ok, true);
  assert.match(plan.proposed, /^# ={20,}$/m);
  assert.match(plan.proposed, /\n {4}bind 192\.0\.2\.10:9446 ssl/);
  assert.ok(!plan.proposed.includes('\tbind'), 'generated directives should use the detected spaces');
  const frontendPosition = plan.proposed.indexOf('frontend ft_styled');
  const backendPosition = plan.proposed.indexOf('backend bk_styled');
  assert.ok(frontendPosition > -1 && backendPosition > frontendPosition, 'new frontend should be placed before the new backend');
  assert.ok(frontendPosition < plan.proposed.indexOf('\nbackend bk\n'), 'new frontend should be inserted after the last frontend, before existing backends');
});

test('inserts a route before the first matching wildcard, not always at the top', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    use_backend bk_other if { hdr(host) -i other.example.com }
    use_backend bk_wild if { hdr(host) -m end .example.com }
    default_backend bk_default
backend bk_other
    server app 192.0.2.10:80 check
backend bk_wild
    server app 192.0.2.11:80 check
backend bk_default
    server app 192.0.2.12:80 check
`;
  const model = parseConfig(config);
  const plan = buildServicePlan(model, {
    kind: 'http',
    name: 'targeted',
    domain: 'example.com',
    hosts: 'app',
    server: '192.0.2.40:8080',
    target: 'frontend:fe',
  });
  assert.equal(plan.ok, true);
  const other = plan.proposed.indexOf('use_backend bk_other');
  const inserted = plan.proposed.indexOf('use_backend bk_targeted');
  const wildcard = plan.proposed.indexOf('use_backend bk_wild');
  const fallback = plan.proposed.indexOf('default_backend bk_default');
  assert.ok(other < inserted && inserted < wildcard && wildcard < fallback);
});

test('generated service plan never increases structural errors for the examples', () => {
  for (const [text, forms] of [
    [sampleA, [
      { kind: 'https', name: 'a', hosts: 'a.example.com', server: '192.0.2.91:9000' },
      { kind: 'tcp', name: 'b', hosts: 'b.example.net', server: '192.0.2.92:5432' },
    ]],
    [sampleB, [
      { kind: 'https', name: 'c', hosts: 'c.example.com', server: '192.0.2.93:9000' },
      { kind: 'http', name: 'd', hosts: 'd.example.com', server: '192.0.2.94:8080' },
    ]],
  ]) {
    const model = parseConfig(text);
    const before = analyzeConfig(model).counts.error;
    for (const form of forms) {
      const plan = buildServicePlan(model, form);
      assert.equal(plan.ok, true);
      const after = analyzeConfig(parseConfig(plan.proposed)).counts.error;
      assert.equal(after, before);
    }
  }
});
