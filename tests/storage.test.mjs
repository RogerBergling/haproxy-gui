import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG_LIMIT_BYTES,
  HISTORY_LIMIT,
  clearAll,
  clearHistory,
  commitConfig,
  getCurrent,
  getHistory,
  pushHistory,
  saveCurrent,
  storageSummary,
} from '../public/assets/js/storage.js';

test('keeps the newest 100 versions and supports restore-style commits', () => {
  clearAll();
  const first = saveCurrent('global\n', { filename: 'one.cfg', label: 'One' });
  assert.equal(first.ok, true);
  assert.deepEqual(getCurrent().text, 'global\n');

  for (let index = 0; index < 105; index += 1) {
    const result = pushHistory(`global\n# version ${index}\n`, {
      label: `Version ${index}`,
      source: 'manual',
      filename: 'history.cfg',
    });
    assert.equal(result.ok, true);
  }
  const history = getHistory();
  assert.equal(history.length, HISTORY_LIMIT);
  assert.match(history[0].text, /version 104/);
  assert.match(history.at(-1).text, /version 5/);

  // Duplicate snapshots are not stored twice.
  const duplicate = pushHistory(history[0].text, { label: 'duplicate' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(getHistory().length, HISTORY_LIMIT);

  // Restoring an older snapshot is just another commit and remains undoable.
  const restored = commitConfig(history[20].text, {
    filename: 'restored.cfg',
    label: 'Restored',
    source: 'restore',
  });
  assert.equal(restored.ok, true);
  assert.equal(getCurrent().text, history[20].text);
  assert.equal(getHistory()[0].source, 'restore');
  assert.equal(getHistory().length, HISTORY_LIMIT);

  const summary = storageSummary();
  assert.equal(summary.persistent, false);
  assert.equal(summary.historyLimit, 100);
});

test('rejects configurations larger than the local limit', () => {
  clearAll();
  const tooBig = 'x'.repeat(CONFIG_LIMIT_BYTES + 1);
  const saved = saveCurrent(tooBig);
  assert.equal(saved.ok, false);
  assert.ok(saved.error);
  const committed = commitConfig(tooBig, { label: 'too large' });
  assert.equal(committed.ok, false);
  clearAll();
  clearHistory();
  assert.equal(getHistory().length, 0);
  assert.equal(getCurrent(), null);
});
