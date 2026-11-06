import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { analyzeConfig } from '../public/assets/js/config/analyzer.js';
import {
  BEST_PRACTICE_FIXES,
  applyBestPracticeFixes,
  applyFindingFix,
  applyHttpHealthCheck,
  bareHttpCheckBackends,
  buildBestPracticeChecklist,
  canFixFinding,
  validateHttpHealthCheckOptions,
} from '../public/assets/js/config/bestpractices.js';
import { parseConfig } from '../public/assets/js/config/parser.js';

const sampleA = SAMPLES.find((sample) => sample.id === 'sni-passthrough').text;
const sampleB = SAMPLES.find((sample) => sample.id === 'edge-tls').text;

test('applies the missing-check and timeout fixes to sample A', () => {
  const model = parseConfig(sampleA);
  const applies = Object.fromEntries(BEST_PRACTICE_FIXES.map((fix) => [fix.id, fix.applies(model)]));
  assert.equal(applies.timeouts, true);
  assert.equal(applies['server-checks'], true);
  assert.equal(applies.forwardfor, true);

  const result = applyBestPracticeFixes(sampleA, ['timeouts', 'server-checks', 'forwardfor']);
  assert.equal(result.applied.length, 3);
  assert.match(result.text, /timeout http-request 10s/);
  assert.match(result.text, /server ssh 192\.0\.2\.50:443 check inter 5s fall 3 rise 3/);
  assert.match(result.text, /option forwardfor/);

  const proposed = parseConfig(result.text);
  assert.equal(proposed.issues.filter((issue) => issue.severity === 'error').length, 0);
  const analysis = analyzeConfig(proposed);
  const remaining = analysis.findings.find((entry) => entry.id === 'health-checks-not-enabled-multiple');
  assert.ok(remaining, 'bare option httpchk backends must stay flagged');
  assert.match(remaining.detail, /bk_sendpass/);
  assert.match(remaining.detail, /bk_sendfile/);
  assert.match(remaining.detail, /bk_decode/);
  assert.match(remaining.detail, /bk_learning/);
  assert.match(result.text, /backend bk_sendpass\n    mode http\n    option httpchk\n    server sendpass 192\.0\.2\.40:8000\n/);
  assert.ok(analysis.score >= 70);

  const second = applyBestPracticeFixes(result.text, ['timeouts', 'server-checks', 'forwardfor']);
  assert.equal(second.applied.length, 0);
  assert.equal(second.text, result.text);
});

test('does not add inherited forwardfor twice in sample B', () => {
  const model = parseConfig(sampleB);
  const forward = BEST_PRACTICE_FIXES.find((fix) => fix.id === 'forwardfor');
  assert.equal(forward.applies(model), false, 'defaults already contains option forwardfor');
});

test('stamps generated fixes with tool, UTC date/time, action and risk notice', () => {
  const model = parseConfig(sampleA);
  const analysis = analyzeConfig(model);
  const finding = analysis.findings.find((entry) => entry.id === 'health-checks-not-enabled-multiple');
  const result = applyFindingFix(sampleA, finding);
  assert.match(result.text, /^# Modified by HAProxy Workbench on \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z: Fixed warning:/);
  assert.match(result.text, /Use at your own risk/);
  assert.equal((result.text.match(/# Modified by HAProxy Workbench on /g) || []).length, 1);
});

test('adds the HTTP request timeout without overwriting existing timeouts', () => {
  const model = parseConfig(sampleB);
  const result = applyBestPracticeFixes(sampleB, ['timeouts']);
  assert.equal(result.applied.length, 1);
  assert.match(result.text, /timeout http-request 10s/);
  assert.match(result.text, /timeout connect 30s/);
  assert.equal((result.text.match(/timeout connect/g) || []).length, 1);
  const second = applyBestPracticeFixes(result.text, ['timeouts']);
  assert.equal(second.applied.length, 0);
});

test('offers a direct fix for the aggregated health-check warning', () => {
  const model = parseConfig(sampleA);
  const analysis = analyzeConfig(model);
  const finding = analysis.findings.find((entry) => entry.id === 'health-checks-not-enabled-multiple');
  assert.ok(finding);
  assert.equal(canFixFinding(model, finding), true);

  const result = applyFindingFix(sampleA, finding);
  assert.ok(result.applied.some((item) => item.id === 'server-checks'));
  assert.match(result.text, /server ssh 192\.0\.2\.50:443 check inter 5s fall 3 rise 3/);
  const proposedModel = parseConfig(result.text);
  const proposedAnalysis = analyzeConfig(proposedModel);
  const remaining = proposedAnalysis.findings.find((entry) => entry.id === 'health-checks-not-enabled-multiple');
  assert.ok(remaining, 'the unsafe bare httpchk backends must remain flagged');
  assert.match(remaining.detail, /bk_sendpass/);
  assert.ok(!proposedAnalysis.findings.some((entry) => entry.id.startsWith('health-no-check')));
  assert.equal(proposedModel.issues.filter((issue) => issue.severity === 'error').length, 0);
});

test('does not activate a bare option httpchk that could mark a healthy app down', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    option httpchk
    server app 192.0.2.10:8000
`;
  const model = parseConfig(config);
  const fix = BEST_PRACTICE_FIXES.find((entry) => entry.id === 'server-checks');
  assert.equal(fix.applies(model), false);
  const result = applyBestPracticeFixes(config, ['server-checks']);
  assert.equal(result.applied.length, 0);
  assert.equal(result.text, config);
});

test('preserves server-line indentation and comments when adding checks', () => {
  const config = `global
defaults
    mode tcp
backend bk
    mode tcp
    server app 192.0.2.10:8000 # primary
`;
  const result = applyBestPracticeFixes(config, ['server-checks']);
  assert.match(result.text, /    server app 192\.0\.2\.10:8000 check inter 5s fall 3 rise 3 # primary/);
});

test('adds check when option httpchk names an explicit health request', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    option httpchk GET /health
    server app 192.0.2.10:8000
`;
  const result = applyBestPracticeFixes(config, ['server-checks']);
  assert.equal(result.applied.length, 1);
  assert.match(result.text, /server app 192\.0\.2\.10:8000 check inter 5s fall 3 rise 3/);
});

test('does not claim a safe fix for warnings that need an environment decision', () => {
  const model = parseConfig(sampleB);
  const analysis = analyzeConfig(model);
  const manual = analysis.findings.find((entry) => entry.id === 'security-client-cert-unverified-clientcert');
  assert.ok(manual);
  assert.equal(canFixFinding(model, manual), false);
});

test('adds keep-alive timeout and Runtime API timeout through safe fixes', () => {
  const model = parseConfig(sampleB);
  const timeoutResult = applyBestPracticeFixes(sampleB, ['timeouts']);
  assert.match(timeoutResult.text, /timeout http-keep-alive 30s/);

  const statsModel = parseConfig(`global
    stats socket /run/haproxy/admin.sock mode 660 level admin
defaults
    mode http
frontend fe
    bind *:80
    default_backend bk
backend bk
    server app 192.0.2.10:80 check
`);
  const statsResult = applyBestPracticeFixes(statsModel.text, ['stats-timeout']);
  assert.equal(statsResult.applied.length, 1);
  assert.match(statsResult.text, /stats timeout 30s/);
});

test('builds a checklist with explicit environment-specific items', () => {
  const model = parseConfig(sampleB);
  const analysis = analyzeConfig(model);
  const checklist = buildBestPracticeChecklist(model, analysis);
  const statuses = Object.fromEntries(checklist.map((item) => [item.id, item.status]));
  assert.equal(statuses.health, 'pass');
  assert.equal(statuses.logging, 'pass');
  assert.equal(statuses.forwardfor, 'pass');
  assert.equal(statuses['client-cert'], 'fail');
  assert.equal(statuses.structure, 'pass');
});

test('guided HTTP check replaces bare option httpchk with an explicit request', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    option httpchk
    server app 192.0.2.10:8000 # primary
`;
  const model = parseConfig(config);
  const result = applyHttpHealthCheck(config, model, 'bk', {
    method: 'GET',
    uri: '/health',
    status: '200',
    host: 'app.example.com',
    inter: '5s',
    fall: '3',
    rise: '3',
    timeoutCheck: '3s',
  });
  assert.equal(result.errors, undefined);
  assert.match(result.text, /option httpchk GET \/health/);
  assert.match(result.text, /http-check send hdr Host app\.example\.com/);
  assert.match(result.text, /http-check expect status 200/);
  assert.match(result.text, /timeout check 3s/);
  assert.match(result.text, /    server app 192\.0\.2\.10:8000 check inter 5s fall 3 rise 3 # primary/);
  assert.match(result.text, /^# Modified by HAProxy Workbench on /);
});

test('guided HTTP check adds a direct request when defaults contain bare httpchk', () => {
  const config = `global
defaults
    mode http
    option httpchk
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    server app 192.0.2.10:8000
`;
  const model = parseConfig(config);
  const result = applyHttpHealthCheck(config, model, 'bk', {
    method: 'GET',
    uri: '/health',
    status: '200',
    inter: '5s',
    fall: '3',
    rise: '3',
    timeoutCheck: '3s',
  });
  assert.equal(result.errors, undefined);
  assert.match(result.text, /backend bk\n    mode http\n    option httpchk GET \/health/);
});

test('guided HTTP check refuses to overwrite a custom expectation', () => {
  const config = `global
defaults
    mode http
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    option httpchk
    http-check expect rstatus ^2
    server app 192.0.2.10:8000
`;
  const model = parseConfig(config);
  const result = applyHttpHealthCheck(config, model, 'bk', {
    method: 'GET',
    uri: '/health',
    status: '200',
    inter: '5s',
    fall: '3',
    rise: '3',
    timeoutCheck: '3s',
  });
  assert.ok(result.errors?.some((error) => /custom `http-check expect`/.test(error)));
});

test('validates guided HTTP check fields', () => {
  assert.deepEqual(validateHttpHealthCheckOptions({
    method: 'GET',
    uri: '/health',
    status: '200',
    inter: '5s',
    fall: '3',
    rise: '3',
    timeoutCheck: '3s',
  }), []);
  const errors = validateHttpHealthCheckOptions({
    method: 'POST',
    uri: 'health',
    status: 'abc',
    inter: 'soon',
    fall: '0',
    rise: 'x',
    timeoutCheck: 'later',
  });
  assert.ok(errors.length >= 5);
});

test('lists only backends whose httpchk request is still bare', () => {
  const model = parseConfig(`global
defaults
    mode http
backend bare
    option httpchk
    server app1 192.0.2.10:8000
backend explicit
    option httpchk GET /health
    http-check expect status 200
    server app2 192.0.2.11:8000
backend no-check-method
    server app3 192.0.2.12:8000
`);
  assert.deepEqual(bareHttpCheckBackends(model).map((backend) => backend.name), ['bare']);
});

test('marks the health checklist for review when active checks use a bare httpchk', () => {
  const model = parseConfig(`global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend fe
    bind *:80
    default_backend bk
backend bk
    mode http
    option httpchk
    server app 192.0.2.10:8000 check inter 5s fall 3 rise 3
`);
  const checklist = buildBestPracticeChecklist(model, analyzeConfig(model));
  const health = checklist.find((item) => item.id === 'health');
  assert.equal(health.status, 'warn');
  assert.equal(health.action?.type, 'http-checks');
});
