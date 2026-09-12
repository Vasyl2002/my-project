import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEther } from 'viem';
import { config, WETH, PROBE } from '../src/config.js';
import { v2Out, routes, gasCost, budgetDelay } from '../src/math.js';
import { selectPools } from '../src/discover.js';
import { Store } from '../src/store.js';
import { localClock, reportText, scheduledReport } from '../src/report.js';
import { Rpc } from '../src/rpc.js';
import { artifact, simulate } from '../src/simulate.js';
import { encodeFunctionResult, decodeFunctionData } from 'viem';

test('v2 swap integer rounding and two trades in the SAME pool cannot manufacture profit', () => {
  const amount = 1000n,
    x = 1000000n,
    y = 2000000n;
  assert.equal(v2Out(amount, x, y), 1992n);
  const bought = v2Out(amount, x, y);
  const sold = v2Out(bought, y - bought, x + amount);
  assert.ok(sold < amount);
  assert.equal(v2Out(1n, 0n, y), 0n);
});
test('spot filter handles reversed ordering and fees', () => {
  const token = '0x' + 'a'.repeat(40);
  const a = { address: 'a', token, token0: WETH, v3: false, fee: 3000 };
  const b = { address: 'b', token, token0: token, v3: false, fee: 3000 };
  assert.equal(
    routes(
      [a, b],
      new Map([
        ['a', [100n, 200n]],
        ['b', [200n, 100n]],
      ]),
      0,
    ).length,
    0,
  );
  const r = routes(
    [a, b],
    new Map([
      ['a', [100n, 240n]],
      ['b', [200n, 100n]],
    ]),
    20,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].buy.address, 'a');
});
test('gas reserve includes intrinsic overhead, margin, doubled base fee and tip', () => {
  assert.equal(gasCost(150000n, 10n, 2n, 2500n), 5500000n);
});
test('RPC pacing spreads budget across UTC day and pauses at exhaustion', () => {
  const midnight = Date.parse('2026-09-12T00:00:00Z');
  assert.equal(budgetDelay(midnight, 15000, 8), 48384);
  assert.equal(budgetDelay(midnight, 0, 8), Infinity);
  assert.ok(budgetDelay(midnight + 12 * 3600000, 15000, 8) < budgetDelay(midnight, 15000, 8));
  assert.ok(budgetDelay(midnight, 1000, 8) > budgetDelay(midnight, 15000, 8));
});
test('discovery ignores spoof names, non-Ethereum, v4, low liquidity and singleton pools', () => {
  const token = '0x' + 'a'.repeat(40),
    other = '0x' + 'b'.repeat(40);
  const p = (i, t = token) => ({
    chainId: 'ethereum',
    dexId: 'uniswap',
    labels: ['v2'],
    pairAddress: '0x' + i.toString(16).padStart(40, '0'),
    baseToken: { address: t, symbol: 'TEST' },
    quoteToken: { address: WETH, symbol: 'WETH' },
    liquidity: { usd: 50000 },
    volume: { h24: 5000 },
  });
  const source = [
    p(1),
    p(2),
    p(3, other),
    { ...p(4), chainId: 'base' },
    { ...p(5), labels: ['v4'] },
    { ...p(6), liquidity: { usd: 1 } },
    { ...p(7), quoteToken: { address: other, symbol: 'WETH' } },
    p(1),
  ];
  const result = selectPools(source, config({}));
  assert.equal(result.length, 2);
  assert.ok(result.every((p) => p.token === token));
});
test('configuration rejects invalid network URL, schedule, amounts and half Telegram config', () => {
  for (const env of [
    { REPORT_TIME: '25:00' },
    { TRADE_SIZES_ETH: '-1' },
    { RPC_HTTP_URL: 'secret' },
    { TELEGRAM_CHAT_ID: '1' },
    { REPORT_TIMEZONE: 'imaginary' },
  ])
    assert.throws(() => config(env));
});
test('Berlin report clock follows DST', () => {
  assert.equal(localClock(new Date('2026-07-01T19:00:00Z'), 'Europe/Berlin').time, '21:00');
  assert.equal(localClock(new Date('2026-12-01T20:00:00Z'), 'Europe/Berlin').time, '21:00');
});
test('SQLite persists, deduplicates same block signal and report does not sum profits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arb-test-'));
  let db = new Store(dir);
  try {
    const s = {
      block: 1,
      hash: 'h',
      route: 'a>b',
      input: '1000',
      net: '2000',
      symbol: 'T',
      buy: 'a',
      sell: 'b',
    };
    db.signal(s);
    db.signal(s);
    db.set('test', 42);
    db.close();
    db = new Store(dir);
    assert.equal(db.get('test'), 42);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM signals').get().n, 1);
    const text = reportText(db, config({}), Date.now() + 1);
    assert.match(text, /уникальных маршрутов: 1/);
    assert.match(text, /не суммируются/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('failed Telegram send does not mark daily report delivered; successful retry is deduplicated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arb-test-')),
    db = new Store(dir),
    old = global.fetch;
  const cfg = config({ TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '1' });
  const now = Date.parse('2026-09-12T20:00:00Z');
  let calls = 0;
  try {
    global.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) });
    await assert.rejects(scheduledReport(db, cfg, now));
    assert.equal(db.get('reportDate'), null);
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await scheduledReport(db, cfg, now);
    await scheduledReport(db, cfg, now + 1000);
    assert.equal(calls, 1);
  } finally {
    global.fetch = old;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('RPC retries 429, counts attempts and refuses over-budget requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arb-test-')),
    db = new Store(dir),
    old = global.fetch;
  let attempts = 0;
  try {
    global.fetch = async () => {
      attempts++;
      return attempts === 1
        ? { status: 429 }
        : { status: 200, ok: true, json: async () => ({ result: '0x1' }) };
    };
    const rpc = new Rpc(
      { ...config({}), http: 'https://invalid.example', rpcInterval: 0, dailyCalls: 2 },
      db,
    );
    assert.equal(await rpc.request('eth_chainId'), '0x1');
    await assert.rejects(rpc.request('eth_chainId'), /BUDGET/);
    assert.equal(attempts, 2);
  } finally {
    global.fetch = old;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('simulation uses one full-cycle call bound to a canonical block and never broadcasts', async () => {
  const compiled = artifact();
  let calls = 0;
  const cfg = config({});
  const amount = parseEther('0.02');
  const route = {
    buy: {
      token: '0x' + 'a'.repeat(40),
      router: '0x' + 'b'.repeat(40),
      v3: true,
      fee: 500,
      symbol: 'T',
      address: 'a',
    },
    sell: { router: '0x' + 'c'.repeat(40), v3: false, fee: 3000, address: 'b' },
    key: 'a>b',
  };
  const rpc = {
    request: async (method, params) => {
      calls++;
      assert.equal(method, 'eth_call');
      assert.deepEqual(params[1], { blockHash: '0xabc', requireCanonical: true });
      assert.equal(params[2][PROBE].code, compiled.code);
      const call = decodeFunctionData({ abi: compiled.abi, data: params[0].data });
      assert.equal(call.functionName, 'run');
      assert.equal(call.args[1], amount);
      return encodeFunctionResult({
        abi: compiled.abi,
        functionName: 'run',
        result: [amount + 10000000000000000n, 200000n],
      });
    },
  };
  const result = await simulate(
    rpc,
    compiled,
    route,
    amount,
    { number: '0x10', hash: '0xabc', baseFeePerGas: '0x1' },
    cfg,
  );
  assert.equal(calls, 1);
  assert.equal(result.block, 16);
  assert.ok(BigInt(result.net) < 10000000000000000n);
});
