import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFunctionResult, parseEther, toHex } from 'viem';
import { Scanner } from '../src/main.js';
import { config, WETH } from '../src/config.js';
import { Store } from '../src/store.js';
const token = '0x' + 'a'.repeat(40),
  router = '0x' + 'b'.repeat(40);
const pools = [
  { address: 'a', token, token0: WETH, v3: false, fee: 3000, router, symbol: 'T' },
  { address: 'b', token, token0: WETH, v3: false, fee: 3000, router, symbol: 'T' },
];
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'arb-scan-')),
    store = new Store(dir);
  let height = 10,
    orphan = false;
  const block = () => ({
    number: toHex(height),
    hash: '0x' + height.toString(16).padStart(64, '0'),
    baseFeePerGas: '0x1',
  });
  let scanner;
  const rpc = {
    multi: async () => [
      [1000n, 2400n, 0],
      [1000n, 2000n, 0],
    ],
    request: async (method, params) => {
      if (method === 'eth_getBlockByNumber') {
        const n = params[0] === 'latest' ? height : Number(BigInt(params[0]));
        return {
          ...block(),
          number: toHex(n),
          hash:
            orphan && params[0] !== 'latest' ? '0xdead' : '0x' + n.toString(16).padStart(64, '0'),
        };
      }
      if (method === 'eth_call')
        return encodeFunctionResult({
          abi: scanner.compiled.abi,
          functionName: 'run',
          result: [parseEther('0.03'), 200000n],
        });
      throw new Error('Unexpected method ' + method);
    },
  };
  scanner = new Scanner({ ...config({}), sizes: [parseEther('0.02')], simulations: 4 }, store, rpc);
  scanner.pools = pools;
  return {
    scanner,
    store,
    next: () => height++,
    orphan: () => {
      orphan = true;
    },
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('scanner saves positive full-cycle result once, then rechecks it at next block', async () => {
  const h = harness();
  try {
    await h.scanner.scan();
    assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM signals').get().n, 1);
    assert.equal(await h.scanner.scan(), false);
    h.next();
    await h.scanner.scan();
    const rows = h.store.db.prepare("SELECT data FROM events WHERE kind='recheck_ok'").all();
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].data).delta, 1);
    const sources = h.store.db
      .prepare('SELECT DISTINCT source FROM simulation_results')
      .all()
      .map((r) => r.source)
      .sort();
    assert.deepEqual(sources, ['candidate', 'control', 'recheck']);
    const repeated = JSON.parse(
      h.store.db.prepare("SELECT data FROM simulation_results WHERE source='recheck'").get().data,
    );
    assert.equal(repeated.origin.block, 10);
    assert.equal(repeated.block, 11);
    assert.equal(repeated.origin.input, repeated.input);
    assert.equal(repeated.origin.hash, '0x' + 'a'.padStart(64, '0'));
    assert.equal(repeated.origin.minProfit, h.scanner.cfg.minProfit.toString());
  } finally {
    h.close();
  }
});
test('block becoming noncanonical during simulation never produces a saved signal', async () => {
  const h = harness();
  try {
    h.orphan();
    assert.equal(await h.scanner.scan(), false);
    assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM signals').get().n, 0);
    assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM simulation_results').get().n, 0);
  } finally {
    h.close();
  }
});
test('a failed snapshot does not advance the last successful block', async () => {
  const h = harness();
  try {
    h.scanner.rpc.multi = async () => [null, null];
    await assert.rejects(h.scanner.scan(), /ALL_POOL_READS_FAILED/);
    assert.equal(h.store.get('lastBlock'), null);
  } finally {
    h.close();
  }
});
test('zero candidates still triggers a loss-making control, persisted across restart', async () => {
  const h = harness();
  try {
    h.scanner.rpc.multi = async () => [
      [1000n, 2000n, 0],
      [1000n, 2000n, 0],
    ];
    const request = h.scanner.rpc.request;
    h.scanner.rpc.request = async (method, params) =>
      method === 'eth_call'
        ? encodeFunctionResult({
            abi: h.scanner.compiled.abi,
            functionName: 'run',
            result: [parseEther('0.019'), 200000n],
          })
        : request(method, params);
    await h.scanner.scan();
    const count = (kind) =>
      h.store.db.prepare('SELECT count(*) AS n FROM events WHERE kind=?').get(kind).n;
    assert.equal(count('candidate'), 0);
    assert.equal(count('control_ok'), 1);
    assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM signals').get().n, 0);
    const nearest = JSON.parse(
      h.store.db.prepare("SELECT data FROM events WHERE kind='near_routes'").get().data,
    );
    assert.equal(nearest.routes.length, 2);
    assert.ok(nearest.routes[0].bps < 0);
    h.next();
    const restarted = new Scanner(h.scanner.cfg, h.store, h.scanner.rpc);
    restarted.pools = pools;
    await restarted.scan();
    assert.equal(count('control_attempt'), 1);
  } finally {
    h.close();
  }
});
test('control uses the existing simulation quota and unconfirmed results are excluded', async () => {
  const h = harness();
  try {
    h.scanner.cfg.simulations = 1;
    let calls = 0;
    const request = h.scanner.rpc.request;
    h.scanner.rpc.request = (method, params) => {
      if (method === 'eth_call') calls++;
      return request(method, params);
    };
    h.orphan();
    await h.scanner.scan();
    assert.equal(calls, 1);
    assert.equal(
      h.store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='control_ok'").get().n,
      0,
    );
    assert.equal(
      h.store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='near_routes'").get().n,
      0,
    );
  } finally {
    h.close();
  }
});
test('failed snapshot retries do not inflate gaps; null block is not a reorganization', async () => {
  const h = harness();
  try {
    await h.scanner.scan();
    h.next();
    h.next();
    h.next();
    const multi = h.scanner.rpc.multi;
    h.scanner.rpc.multi = async () => [null, null];
    await assert.rejects(h.scanner.scan());
    await assert.rejects(h.scanner.scan());
    assert.equal(
      h.store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='gap'").get().n,
      0,
    );
    h.scanner.rpc.multi = multi;
    await h.scanner.scan();
    assert.equal(
      JSON.parse(h.store.db.prepare("SELECT data FROM events WHERE kind='gap'").get().data).blocks,
      2,
    );
    h.next();
    const request = h.scanner.rpc.request;
    h.scanner.rpc.request = (method, params) =>
      method === 'eth_getBlockByNumber' && params[0] !== 'latest' ? null : request(method, params);
    await assert.rejects(h.scanner.scan(), /RPC_BLOCK_UNAVAILABLE/);
    assert.equal(
      h.store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='reorg'").get().n,
      0,
    );
  } finally {
    h.close();
  }
});

test('adaptive sizing shares quota, pins calls to one block and saves gas details', async () => {
  const h = harness();
  try {
    h.scanner.cfg.sizes = ['0.005', '0.02', '0.1', '0.5'].map((s) => parseEther(s));
    h.store.set('lastControlAttemptAt', Date.now());
    let calls = 0;
    const request = h.scanner.rpc.request;
    h.scanner.rpc.request = async (method, params) => {
      if (method === 'eth_call') {
        calls++;
        assert.equal(params[1].blockHash, '0x' + 'a'.padStart(64, '0'));
        const { decodeFunctionData } = await import('viem');
        const { args } = decodeFunctionData({ abi: h.scanner.compiled.abi, data: params[0].data });
        const amount = args[1];
        const peak = parseEther('0.06');
        const distance = amount > peak ? amount - peak : peak - amount;
        const gain = parseEther('0.001') - distance / 100n;
        return encodeFunctionResult({
          abi: h.scanner.compiled.abi,
          functionName: 'run',
          result: [amount + gain, 200000n],
        });
      }
      return request(method, params);
    };
    await h.scanner.scan();
    assert.equal(calls, 4);
    const results = h.store.db
      .prepare('SELECT data FROM simulation_results')
      .all()
      .map((r) => JSON.parse(r.data));
    assert.equal(results.length, 4);
    const refined = results.filter((s) => s.refined);
    assert.equal(refined.length, 1);
    assert.equal(refined[0].input, parseEther('0.06').toString());
    assert.ok(results.every((s) => s.baseFee === '1' && s.estimatedGasUnits === '250000'));
    assert.ok(BigInt(refined[0].net) > BigInt(results[1].net));
  } finally {
    h.close();
  }
});
