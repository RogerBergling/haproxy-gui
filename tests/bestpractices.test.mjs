import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { analyzeConfig } from '../public/assets/js/config/analyzer.js';
import {
  BEST_PRACTICE_FIXES,
  applyBestPracticeFixes,
  applyFindingFix,
  buildBestPracticeChecklist,
  canFixFinding,
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
  assert.match(result.text, /server ssh 192\.0\.2\.50:443 check inter 2s fall 3 rise 2/);
  assert.match(result.text, /option forwardfor/);

  const proposed = parseConfig(result.text);
  assert.equal(proposed.issues.filter((issue) => issue.severity === 'error').length, 0);
  const analysis = analyzeConfig(proposed);
  assert.equal(analysis.counts.warning, 0);
  assert.ok(analysis.score >= 95);

  const second = applyBestPracticeFixes(result.text, ['timeouts', 'server-checks', 'forwardfor']);
  assert.equal(second.applied.length, 0);
  assert.equal(second.text, result.text);
});

test('does not add inherited forwardfor twice in sample B', () => {
  const model = parseConfig(sampleB);
  const forward = BEST_PRACTICE_FIXES.find((fix) => fix.id === 'forwardfor');
  assert.equal(forward.applies(model), false, 'defaults already contains option forwardfor');
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
  assert.match(result.text, /server ssh 192\.0\.2\.50:443 check inter 2s fall 3 rise 2/);
  const proposedModel = parseConfig(result.text);
  const proposedAnalysis = analyzeConfig(proposedModel);
  assert.ok(!proposedAnalysis.findings.some((entry) => entry.id.startsWith('health-checks-not-enabled')));
  assert.ok(!proposedAnalysis.findings.some((entry) => entry.id.startsWith('health-no-check')));
  assert.equal(proposedModel.issues.filter((issue) => issue.severity === 'error').length, 0);
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
