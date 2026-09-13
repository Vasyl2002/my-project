import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { filterReason, controlReason, diagnosticLines, splitMessage } from '../src/diagnostics.js';
import { scheduledReport } from '../src/report.js';
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'arb-diag-'));
  const db = new Store(dir);
  return {
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('diagnostics separate fee, threshold, and actual gas losses', () => {
  assert.match(filterReason({ rawBps: 10, bps: -20 }, 20), /комиссии/);
  assert.match(filterReason({ rawBps: 80, bps: 20 }, 20), /ниже фильтра/);
  assert.match(controlReason({ input: '100', output: '120', net: '-5', minProfit: '10' }), /газа/);
  assert.match(
    controlReason({ input: '100', output: '90', net: '-30', minProfit: '10' }),
    /на обменах/,
  );
  assert.match(
    controlReason({ input: '100', output: '120', net: '5', minProfit: '10' }),
    /минимальной/,
  );
});
test('intervals and per-pool failed reads use only measurements within the report period', () => {
  const f = fixture();
  try {
    f.db.event('scan', {});
    f.db.event('scan', { intervalMs: 10000 });
    f.db.event('scan', { intervalMs: 30000 });
    f.db.event('pool_sample', { pools: ['a', 'b'], failed: ['b'] });
    f.db.event('pool_sample', { pools: ['a', 'b'], failed: [] });
    const text = diagnosticLines(f.db, Date.now() - 10000, Date.now() + 1).join('\n');
    assert.match(text, /средний 20.0 с/);
    assert.match(text, /p95 30.0 с/);
    assert.match(text, /3\/4 успешных \(75.00%\)/);
    assert.match(text, /Сбои b: 1\/2/);
    assert.match(diagnosticLines(f.db, Date.now() + 2, Date.now() + 3).join('\n'), /недостаточно/);
  } finally {
    f.close();
  }
});
test('nearest routes deduplicate by route using best net-of-fee observation, keeping negative values', () => {
  const f = fixture();
  try {
    for (const bps of [-30, -10, -20])
      f.db.event('near_routes', {
        block: 1,
        thresholdBps: 20,
        routes: [
          {
            key: 'a>b',
            symbol: 'T',
            buy: 'a',
            sell: 'b',
            rawBps: 10,
            bps,
            buyFee: 3000,
            sellFee: 500,
          },
        ],
      });
    const text = diagnosticLines(f.db, Date.now() - 10000, Date.now() + 1).join('\n');
    assert.match(text, /после комиссий -0.100%/);
    assert.equal(text.split('T |').length, 2);
    assert.match(text, /НЕ прибыль/);
  } finally {
    f.close();
  }
});
test('long Telegram text splits without losing content or breaking emoji', () => {
  const text = 'a'.repeat(3499) + '😀' + 'b'.repeat(4000);
  const chunks = splitMessage(text);
  assert.ok(chunks.every((c) => c.length <= 3500));
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c)));
});
test('daily multi-part delivery resumes after a failed part without resending acknowledged parts', async () => {
  const f = fixture(),
    old = global.fetch,
    cfg = config({ TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '1' });
  let calls = [];
  const end = Date.parse('2026-09-13T19:00:00Z');
  try {
    f.db.set('pendingReport', { date: '2026-09-13', end, chunks: ['part1', 'part2'], next: 0 });
    global.fetch = async (url, request) => {
      const text = JSON.parse(request.body).text;
      calls.push(text);
      return { ok: text === 'part1', json: async () => ({ ok: text === 'part1' }) };
    };
    await assert.rejects(scheduledReport(f.db, cfg, end));
    assert.equal(f.db.get('pendingReport').next, 1);
    assert.equal(f.db.get('lastReportEnd'), null);
    global.fetch = async (url, request) => {
      calls.push(JSON.parse(request.body).text);
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await scheduledReport(f.db, cfg, end + 86400000);
    assert.deepEqual(calls, ['part1', 'part2', 'part2']);
    assert.equal(f.db.get('lastReportEnd'), end);
    assert.equal(f.db.get('reportDate'), '2026-09-13');
    assert.equal(f.db.get('pendingReport'), null);
  } finally {
    global.fetch = old;
    f.close();
  }
});
