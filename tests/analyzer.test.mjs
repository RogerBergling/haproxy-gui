import test from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLES } from '../public/assets/js/data/samples.js';
import { analyzeConfig } from '../public/assets/js/config/analyzer.js';
import { parseConfig } from '../public/assets/js/config/parser.js';

const sampleA = SAMPLES.find((sample) => sample.id === 'sni-passthrough').text;
const sampleB = SAMPLES.find((sample) => sample.id === 'edge-tls').text;

test('analyzes sample A, collapsing repeated health-check warnings', () => {
  const model = parseConfig(sampleA);
  const analysis = analyzeConfig(model);
  assert.equal(analysis.counts.error, 0);
  assert.ok(analysis.counts.warning >= 1);
  const collapsed = analysis.findings.find((finding) => finding.id === 'health-checks-not-enabled-multiple');
  assert.ok(collapsed, 'repeated health-check findings should collapse');
  assert.match(collapsed.detail, /bk_ssh/);
  assert.ok(!analysis.findings.some((finding) => finding.id === 'operations-stats-timeout'));
  assert.ok(!analysis.findings.some((finding) => finding.id.startsWith('timeouts-http-request-bk_')));
  assert.ok(analysis.score >= 80);
});

test('finds the deliberate issues in sample B', () => {
  const analysis = analyzeConfig(parseConfig(sampleB));
  assert.ok(analysis.findings.some((finding) => finding.id === 'parser-frontend-no-bind'));
  assert.ok(analysis.findings.some((finding) => finding.id === 'security-client-cert-unverified-clientcert'));
  assert.ok(!analysis.findings.some((finding) => finding.id.startsWith('routing-no-forwardfor')), 'forwardfor is inherited from defaults');
  assert.ok(!analysis.findings.some((finding) => finding.id === 'tls-min-version-missing'), 'no-tlsv10/11 imply a TLS 1.2 floor');
  assert.equal(analysis.counts.error, 0);
});

test('flags insecure TLS, missing timeouts and missing certificate sources', () => {
  const config = `global
    ssl-default-bind-ciphers RC4-SHA:DES-CBC3-SHA
    ssl-default-bind-options ssl-min-ver TLSv1.0
defaults
    mode http
frontend fe
    bind *:443 ssl
    default_backend bk
backend bk
    server app 192.0.2.10:80
`;
  const analysis = analyzeConfig(parseConfig(config));
  const ids = analysis.findings.map((finding) => finding.id);
  assert.ok(ids.includes('tls-old-min-version'));
  assert.ok(ids.includes('tls-weak-ciphers'));
  assert.ok(ids.some((id) => id.startsWith('tls-no-cert')));
  assert.ok(ids.includes('timeouts-default-connect'));
  assert.ok(ids.includes('timeouts-default-client'));
  assert.ok(ids.includes('timeouts-default-server'));
  assert.equal(analysis.counts.error >= 1, true);
});

test('flags modern HAProxy upgrade blockers and removed directives', () => {
  const config = `global
    nbproc 4
    tune.ssl.ocsp-update on
defaults
    mode http
frontend fe
    bind *:80
    reqadd X-Test:\\ yes
    default_backend bk
backend bk
    server app 192.0.2.10:80 enabled
program helper
    command /usr/bin/helper
mailers mail
    mailer smtp 192.0.2.1:25
`;
  const analysis = analyzeConfig(parseConfig(config));
  const ids = analysis.findings.map((finding) => finding.id);
  assert.ok(ids.some((id) => id.startsWith('version-removed-reqadd')));
  assert.ok(ids.some((id) => id.startsWith('version-nbproc')));
  assert.ok(ids.some((id) => id.startsWith('version-ocsp-directive')));
  assert.ok(ids.some((id) => id.startsWith('version-program')));
  assert.ok(ids.some((id) => id.startsWith('version-mailers')));
  assert.ok(ids.some((id) => id.startsWith('version-server-enabled')));
});

test('flags implicit balancing defaults on multi-server backends', () => {
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
    server app1 192.0.2.10:80 check
    server app2 192.0.2.11:80 check
`;
  const analysis = analyzeConfig(parseConfig(config));
  const finding = analysis.findings.find((entry) => entry.id === 'version-implicit-balance-default');
  assert.ok(finding);
  assert.match(finding.detail, /bk/);
  assert.equal(finding.versionImpact, '3.3');
});

test('flags duplicate proxy and server names', () => {
  const config = `global
defaults
    mode tcp
frontend dup
    bind *:1000
    default_backend dup
backend dup
    server app 192.0.2.10:80
    server app 192.0.2.11:80
`;
  const analysis = analyzeConfig(parseConfig(config));
  assert.ok(analysis.findings.some((finding) => finding.id === 'parser-proxy-name-cross-family'));
  assert.ok(analysis.findings.some((finding) => finding.id === 'parser-server-name-duplicate'));
});

test('does not warn about unconditional X-Forwarded-Proto on a loopback-only bind', () => {
  const config = `global
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend internal
    bind 127.0.0.1:8443 ssl crt /etc/ssl/example.pem
    http-request set-header X-Forwarded-Proto https
    default_backend bk
backend bk
    server app 192.0.2.10:80 check
`;
  const analysis = analyzeConfig(parseConfig(config));
  assert.ok(!analysis.findings.some((finding) => finding.id === 'security-unconditional-proto-internal'));
});
