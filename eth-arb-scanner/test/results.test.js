import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { resultClass, resultLines } from '../src/results.js';
import { reportText } from '../src/report.js';
const sample = (net, route = 'a>b', input = '1000000') => ({
  block: 1,
  hash: 'h',
  route,
  input,
  output: (BigInt(input) + BigInt(net) + 1000n).toString(),
  gasBudget: '1000',
  net: net.toString(),
  symbol: route,
  buy: 'a',
  sell: 'b',
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'arb-results-'));
  const store = new Store(dir);
  return {
    store,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('zero, positive below threshold, and exact threshold are disjoint categories', () => {
  for (const [net, expected] of [
    ['-1', 'nonpositive'],
    ['0', 'nonpositive'],
    ['1', 'below'],
    ['99', 'below'],
    ['100', 'eligible'],
  ])
    assert.equal(resultClass({ net, minProfit: '100' }), expected);
});
test('all outcomes persist, duplicate records are ignored and accounting inconsistencies rejected', () => {
  const f = fixture();
  try {
    f.store.simulation(sample(-10), 'candidate', 100n);
    f.store.simulation(sample(-10), 'candidate', 100n);
    f.store.simulation(sample(-10), 'control', 100n);
    const rows = f.store.db.prepare('SELECT data FROM simulation_results').all();
    assert.equal(rows.length, 2);
    assert.equal(JSON.parse(rows[0].data).gross, '990');
    assert.throws(
      () => f.store.simulation({ ...sample(10), net: '11' }, 'candidate', 100n),
      /INCONSISTENT/,
    );
  } finally {
    f.close();
  }
});
test('ranking uses signed integer net and the best amount of each route, retaining losses', () => {
  const f = fixture();
  try {
    f.store.simulation(sample(-20, 'loss1'), 'candidate', 100n);
    f.store.simulation(sample(-2, 'loss2'), 'candidate', 100n);
    f.store.simulation(sample(9, 'best', '1000000'), 'candidate', 100n);
    f.store.simulation(sample(99, 'best', '2000000'), 'candidate', 100n);
    const text = resultLines(f.store, config({}), Date.now() - 10000, Date.now() + 1).join('\n');
    assert.match(text, /≤0 — 2; >0, но ниже порога — 2; достигли порога — 0/);
    assert.ok(text.indexOf('1. best') < text.indexOf('2. loss2'));
    assert.match(text, /3. loss1/);
    assert.match(text, /Вход 0.000000000002 WETH/);
    assert.equal(text.split('1. best').length, 2);
  } finally {
    f.close();
  }
});
test('historical threshold is respected and invalidated / out-of-period results are excluded', () => {
  const f = fixture();
  try {
    f.store.simulation(sample(100, 'at-threshold'), 'candidate', 100n);
    f.store.simulation(sample(1000, 'invalid'), 'control', 100n);
    f.store.db.prepare("UPDATE simulation_results SET valid=0 WHERE route='invalid'").run();
    const text = resultLines(
      f.store,
      { ...config({}), minProfit: 10000n },
      Date.now() - 10000,
      Date.now() + 1,
    ).join('\n');
    assert.match(text, /достигли порога — 1/);
    assert.match(text, /Исключено.*1 результатов/);
    assert.doesNotMatch(text, /1. invalid/);
    assert.match(
      resultLines(f.store, config({}), Date.now() + 2, Date.now() + 3).join('\n'),
      /ещё нет сохранённых/,
    );
  } finally {
    f.close();
  }
});
test('legacy counters are not treated as known nonpositive results and report names the threshold', () => {
  const f = fixture();
  try {
    f.store.event('sim_ok');
    const text = reportText(f.store, config({}), Date.now() + 1);
    assert.match(text, /Старые симуляции восстановить из счётчиков нельзя/);
    assert.match(text, /Сигналов, достигших порога прибыли, за период нет/);
    assert.doesNotMatch(text, /положительных результатов за период нет/);
  } finally {
    f.close();
  }
});
