import test from 'node:test';
import assert from 'node:assert/strict';
import { gasDetails, gasCost } from '../src/math.js';
import { refinementJob } from '../src/sizing.js';
import { gasLines } from '../src/results.js';
test('block estimate and conservative cap stay distinct; break-even rounds down', () => {
  const d = gasDetails(150000n, 10n, 2n, 2500n, 3000001n);
  assert.equal(d.estimatedGasCost, '2400000');
  assert.equal(d.estimatedNet, '600001');
  assert.equal(d.breakEvenGasPrice, '15');
  assert.equal(gasCost(150000n, 10n, 2n, 2500n), 5500000n);
  assert.equal(gasDetails(150000n, 0n, 0n, 0n, 0n).breakEvenGasPrice, null);
  assert.equal(gasDetails(150000n, 0n, 0n, 0n, -1n).breakEvenGasPrice, null);
  assert.match(gasLines({ ...d, gasUsed: '150000' }), /200000/);
  assert.match(gasLines({}), /до обновления/);
});
const routes = [{ key: 'r' }];
const result = (input, gain) => ({
  result: {
    route: 'r',
    input: String(input),
    output: String(input + gain),
    estimatedNet: String(gain - 1n),
    net: String(gain - 2n),
  },
});
test('refinement brackets promising amount, stays in configured bounds and avoids retries', () => {
  const outcomes = [result(10n, 1n), result(20n, 8n), result(100n, -4n)];
  const attempted = new Set(['r:10', 'r:20', 'r:100']);
  assert.equal(refinementJob(outcomes, routes, [100n, 10n, 20n], attempted).amount, 60n);
  attempted.add('r:60');
  assert.equal(refinementJob(outcomes, routes, [10n, 20n, 100n], attempted).amount, 15n);
  assert.equal(refinementJob([result(10n, -1n)], routes, [10n, 20n], attempted), null);
  assert.equal(refinementJob(outcomes, [], [10n, 100n], attempted), null);
  assert.equal(refinementJob(outcomes, routes, [20n], attempted), null);
});
