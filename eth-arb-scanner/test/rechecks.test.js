import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { describeRecheck, recheckReport } from '../src/rechecks.js';
const origin = { hash: 'old', block: 10, route: 'a>b', input: '1000', net: '200', symbol: 'T' };
const sample = (net) => ({
  origin,
  hash: 'new',
  block: 13,
  route: 'a>b',
  input: '1000',
  output: String(1100n + BigInt(net)),
  gasBudget: '100',
  net: String(net),
  minProfit: '100',
  symbol: 'T',
  buy: 'a',
  sell: 'b',
});
test('rechecks distinguish losses, small profits and exact threshold using signed integer math', () => {
  assert.match(describeRecheck(sample(-1)), /неположительный/);
  assert.match(describeRecheck(sample(0)), /неположительный/);
  assert.match(describeRecheck(sample(99)), /прибыль положительная, но ниже порога/);
  assert.match(describeRecheck(sample(100)), /порог достигнут/);
  assert.match(describeRecheck(sample(100)), /через 3 блок/);
  assert.match(describeRecheck(sample(100)), /изменение итога: -0.0000000000000001 WETH/);
});
test('report links exact signal identity, includes checks of older signals and excludes invalid rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rechecks-'));
  const store = new Store(dir);
  try {
    const now = Date.now();
    store.simulation(sample(99), 'recheck', 100n);
    store.db.prepare('UPDATE simulation_results SET ts=?').run(now);
    const legacy = { ...sample(101), hash: 'legacy' };
    delete legacy.origin;
    store.simulation(legacy, 'recheck', 100n);
    const invalid = { ...sample(999), hash: 'invalid', origin: { ...origin, hash: 'orphan' } };
    store.simulation(invalid, 'recheck', 100n);
    store.db.prepare("UPDATE simulation_results SET valid=0 WHERE hash='invalid'").run();
    const report = recheckReport(store, now, Date.now() + 1);
    assert.match(report.forSignal(origin), /ниже порога/);
    assert.match(report.forSignal({ ...origin, input: '2000' }), /результат неизвестен/);
    assert.match(report.forSignal({ ...origin, hash: 'orphan' }), /результат неизвестен/);
    assert.match(report.lines.join('\n'), /Сигнал: блок 10/);
    assert.match(report.lines.join('\n'), /до обновления\): 1/);
    assert.equal(recheckReport(store, Date.now() + 2, Date.now() + 3).lines.length, 0);
    store.set('pending', [{ ...origin, hash: 'pending' }]);
    assert.match(
      recheckReport(store, now, Date.now() + 1).forSignal({ ...origin, hash: 'pending' }),
      /ожидается/,
    );
    store.event('recheck_expired', {
      origin: { ...origin, hash: 'expired' },
      block: 16,
      reason: 'too_old',
    });
    store.event('recheck_error', { origin: { ...origin, hash: 'failed' }, block: 12 });
    const updated = recheckReport(store, now, Date.now() + 1);
    assert.match(updated.forSignal({ ...origin, hash: 'expired' }), /больше 5 блоков/);
    assert.match(updated.forSignal({ ...origin, hash: 'failed' }), /ошибка симуляции/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
