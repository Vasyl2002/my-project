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
