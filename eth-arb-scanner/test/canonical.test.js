import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { beginAudit, auditHistory, priorityDecision } from '../src/canonical.js';
const s = (block) => ({
  block,
  hash: 'h' + block,
  route: 'a>b',
  input: '10',
  output: '21',
  gasBudget: '1',
  net: '10',
  symbol: 'T',
  buy: 'a',
  sell: 'b',
});
test('canonical audit preserves common-ancestor history, quarantines unknowns and resumes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  let store = new Store(dir);
  try {
    for (const n of [10, 11, 12]) {
      store.simulation(s(n), 'candidate', 1n);
      store.signal(s(n));
    }
    beginAudit(store, 'h12');
    assert.equal(
      store.db.prepare('SELECT valid FROM simulation_results WHERE hash=?').get('h10').valid,
      -1,
    );
    assert.equal(await auditHistory(store, { request: async () => null }), false);
    store.close();
    store = new Store(dir);
    const calls = [];
    assert.equal(
      await auditHistory(store, {
        request: async (_, p) => {
          const n = Number(BigInt(p[0]));
          calls.push(n);
          return { hash: n === 11 ? 'changed' : 'h' + n };
        },
      }),
      true,
    );
    assert.deepEqual(calls, [11, 10]);
    assert.deepEqual(
      store.db
        .prepare('SELECT valid FROM simulation_results ORDER BY id')
        .all()
        .map((r) => r.valid),
      [1, 0, 0],
    );
    assert.deepEqual(
      store.db
        .prepare('SELECT valid FROM signals ORDER BY block')
        .all()
        .map((r) => r.valid),
      [1, 0, 0],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('priority repeats respect reserve, low remaining budget and retry interval', () => {
  const p = {
    now: 10000,
    lastAttempt: 0,
    pending: true,
    remaining: 1000,
    spent: 0,
    dailyCalls: 15000,
  };
  assert.equal(priorityDecision(p).due, true);
  assert.equal(priorityDecision(p).reserve, 300);
  for (const delta of [{ pending: false }, { remaining: 0 }, { spent: 300 }, { lastAttempt: 9000 }])
    assert.equal(priorityDecision({ ...p, ...delta }).due, false);
});
