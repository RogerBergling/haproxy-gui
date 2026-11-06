import test from 'node:test';
import assert from 'node:assert/strict';

import { MARKER, stampWorkbenchChange } from '../public/assets/js/config/change.js';

test('stamps a generated change with tool, UTC time, action and risk notice', () => {
  const when = new Date('2026-11-01T12:34:56.789Z');
  const result = stampWorkbenchChange('global\n    maxconn 1000\n', 'Added service app.example.com', when);
  assert.ok(result.startsWith(`${MARKER}2026-11-01T12:34:56.789Z:`));
  assert.match(result, /Added service app\.example\.com/);
  assert.match(result, /Use at your own risk/);
  assert.ok(result.endsWith('global\n    maxconn 1000\n'));
});

test('prepends a changelog entry and preserves every previous entry', () => {
  const first = stampWorkbenchChange('global\n', 'First change', new Date('2026-11-01T10:00:00Z'));
  const second = stampWorkbenchChange(first, 'Second change', new Date('2026-11-01T11:00:00Z'));
  assert.equal((second.match(/# Modified by HAProxy Workbench on /g) || []).length, 2);
  assert.ok(second.startsWith(`${MARKER}2026-11-01T11:00:00.000Z:`));
  assert.match(second, /Second change/);
  assert.match(second, /First change/);
  assert.ok(second.endsWith('global\n'));
});

test('does not add the exact same changelog entry twice', () => {
  const when = new Date('2026-11-01T12:00:00Z');
  const first = stampWorkbenchChange('global\n', 'Same change', when);
  const second = stampWorkbenchChange(first, 'Same change', when);
  assert.equal((second.match(/# Modified by HAProxy Workbench on /g) || []).length, 1);
});
