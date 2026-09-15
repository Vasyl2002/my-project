import WebSocket from 'ws';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHex } from 'viem';
import { config } from './config.js';
import { Store } from './store.js';
import { Rpc } from './rpc.js';
import { discover, validatePools } from './discover.js';
import { poolAbi } from './abi.js';
import { rankedRoutes, budgetDelay } from './math.js';
import { artifact, simulate, checkOverrides } from './simulate.js';
import { scheduledReport } from './report.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Scanner {
  constructor(cfg, store, rpc) {
    this.cfg = cfg;
    this.store = store;
    this.rpc = rpc;
    this.compiled = artifact();
    this.pools = [];
    this.pending = store.get('pending', []);
    this.cursor = 0;
  }
  async refresh() {
    const discovered = await discover(this.cfg);
    const pools = await validatePools(this.rpc, discovered.pools);
    if (pools.length < 2) throw new Error('NO_VALIDATED_PAIRS');
    this.pools = pools;
    this.store.set('pools', pools);
    this.store.set('discovery', discovered);
    this.store.set('discoveryAt', Date.now());
    console.log(
      `Validated ${pools.length} pools / ${new Set(pools.map((p) => p.token)).size} tokens`,
    );
  }
  async scan() {
    const sampleAt = Date.now();
    const block = await this.rpc.request('eth_getBlockByNumber', ['latest', false]);
    if (!block?.hash || !block.baseFeePerGas) throw new Error('INVALID_MAINNET_BLOCK');
    const height = Number(BigInt(block.number)),
      previous = this.store.get('lastBlock');
    if (previous?.hash === block.hash) return false;
    if (previous) {
      const old = await this.rpc.request('eth_getBlockByNumber', [toHex(previous.number), false]);
      if (!old?.hash) throw new Error('RPC_BLOCK_UNAVAILABLE');
      if (old?.hash !== previous.hash) {
        this.store.db.prepare('DELETE FROM signals').run();
        this.store.db.prepare('UPDATE simulation_results SET valid=0 WHERE valid=1').run();
        this.pending = [];
        this.store.set('pending', []);
        this.store.event('reorg');
      } else if (height < previous.number) return false;
    }
    const stateTag = { blockHash: block.hash, requireCanonical: true };
    const values = await this.rpc.multi(
      this.pools.map((p) => ({
        address: p.address,
        abi: poolAbi,
        name: p.v3 ? 'slot0' : 'getReserves',
      })),
      stateTag,
    );
    const states = new Map(this.pools.map((p, i) => [p.address, values[i]]));
    this.store.event('pool_sample', {
      pools: this.pools.map((p) => p.address),
      failed: this.pools.filter((p, i) => values[i] == null).map((p) => p.address),
    });
    if (values.some((x) => x === null))
      this.store.event('pool_read_failure', { count: values.filter((x) => x === null).length });
    if (values.every((x) => x === null)) throw new Error('ALL_POOL_READS_FAILED');
    const ranked = rankedRoutes(this.pools, states);
    const opportunities = ranked.filter((r) => r.bps > this.cfg.spreadBps);
    for (const r of opportunities) this.store.event('candidate', { route: r.key });
    const staged = [];
    const outcomes = [];
    const rechecks = [];
    const controlResults = [];
    const next = [];
    let used = 0;
    let controlJob;
    if (
      ranked.length &&
      sampleAt - this.store.get('lastControlAttemptAt', 0) >= this.cfg.controlMs
    ) {
      // Rotate among the three nearest routes, including those rejected by the filter.
      const cursor = this.store.get('controlCursor', 0);
      const r = ranked[cursor % Math.min(3, ranked.length)];
      const amount = this.cfg.sizes.reduce((a, b) => (a < b ? a : b));
      controlJob = { r, amount };
      used++;
      this.store.set('lastControlAttemptAt', sampleAt);
      this.store.set('controlCursor', cursor + 1);
      this.store.event('control_attempt', { route: r.key, block: height });
      try {
        const s = await simulate(this.rpc, this.compiled, r, amount, block, this.cfg);
        controlResults.push({ ...s, minProfit: this.cfg.minProfit.toString() });
        outcomes.push({ result: s, source: 'control' });
        if (BigInt(s.net) >= this.cfg.minProfit) staged.push(s);
      } catch (e) {
        this.store.event('control_fail', {
          code: /^RPC_[A-Z0-9_-]+$/.test(e.message) ? e.message : 'SIMULATION_FAILED',
        });
      }
    }
    for (const p of this.pending) {
      if (p.block >= height) {
        next.push(p);
        continue;
      }
      const buy = this.pools.find((x) => x.address === p.buy),
        sell = this.pools.find((x) => x.address === p.sell);
      if (!buy || !sell || height - p.block > 5) {
        this.store.event('recheck_expired');
        continue;
      }
      if (used >= Math.min(2, this.cfg.simulations)) {
        next.push(p);
        continue;
      }
      used++;
      try {
        const s = await simulate(
          this.rpc,
          this.compiled,
          { buy, sell, key: p.route },
          BigInt(p.input),
          block,
          this.cfg,
        );
        rechecks.push({
          kind: BigInt(s.net) >= this.cfg.minProfit ? 'recheck_ok' : 'recheck_lost',
          data: { route: p.route, block: height, delta: height - p.block },
        });
        outcomes.push({ result: s, source: 'recheck' });
      } catch {
        this.store.event('recheck_error');
      }
    }
    const jobs = opportunities
      .flatMap((r) => this.cfg.sizes.map((amount) => ({ r, amount })))
      .filter(
        (job) => !controlJob || job.r.key !== controlJob.r.key || job.amount !== controlJob.amount,
      );
    const available = this.cfg.simulations - used;
    for (let i = 0; i < Math.min(jobs.length, available); i++) {
      const job = jobs[(this.cursor + i) % jobs.length];
      try {
        const s = await simulate(this.rpc, this.compiled, job.r, job.amount, block, this.cfg);
        this.store.event('sim_ok');
        outcomes.push({ result: s, source: 'candidate' });
        if (BigInt(s.net) >= this.cfg.minProfit) staged.push(s);
      } catch {
        this.store.event('sim_fail');
      }
    }
    this.cursor += Math.min(jobs.length, available);
    // Discard results if the sampled block became noncanonical while work ran.
    const check = await this.rpc.request('eth_getBlockByNumber', [block.number, false]);
    if (!check?.hash) throw new Error('RPC_BLOCK_UNAVAILABLE');
    if (check?.hash !== block.hash) {
      this.store.event('reorg');
      return false;
    }
    for (const r of rechecks) this.store.event(r.kind, r.data);
    for (const item of outcomes)
      this.store.simulation(item.result, item.source, this.cfg.minProfit);
    for (const result of controlResults) this.store.event('control_ok', result);
    this.store.event('near_routes', {
      block: height,
      thresholdBps: this.cfg.spreadBps,
      routes: ranked.slice(0, 3).map((r) => ({
        key: r.key,
        symbol: r.buy.symbol,
        buy: r.buy.address,
        sell: r.sell.address,
        buyVenue: r.buy.venue,
        sellVenue: r.sell.venue,
        buyFee: r.buy.fee,
        sellFee: r.sell.fee,
        rawBps: r.rawBps,
        bps: r.bps,
      })),
    });
    if (previous && height > previous.number + 1)
      this.store.event('gap', { blocks: height - previous.number - 1 });
    for (const s of staged) {
      this.store.signal(s);
      if (!next.some((p) => p.route === s.route && p.input === s.input)) next.push(s);
    }
    this.pending = next.slice(0, 100);
    this.store.set('pending', this.pending);
    this.store.set('lastBlock', { number: height, hash: block.hash, at: Date.now(), sampleAt });
    this.store.event('scan', {
      intervalMs: previous ? Math.max(0, sampleAt - (previous.sampleAt || previous.at)) : null,
      comparedRoutes: ranked.length,
    });
    return true;
  }
}
export async function main() {
  const cfg = config();
  if (!cfg.http || cfg.http.includes('REPLACE_ME')) throw new Error('SET_RPC_HTTP_URL_IN_ENV');
  const store = new Store(cfg.data),
    rpc = new Rpc(cfg, store);
  let stopped = false,
    ws,
    reconnectAt = 0,
    dirty = true,
    lastPoll = 0,
    lastRefreshAttempt = 0,
    lastScan = 0,
    lastPrune = 0,
    lastPing = 0,
    pongAt = Date.now();
  const stop = () => {
    stopped = true;
    ws?.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    if (BigInt(await rpc.request('eth_chainId')) !== 1n)
      throw new Error('ETHEREUM_MAINNET_REQUIRED');
    await checkOverrides(rpc);
    const scanner = new Scanner(cfg, store, rpc);
    await scanner.refresh();
    const connect = () => {
      if (!cfg.ws || stopped) return;
      ws = new WebSocket(cfg.ws, { handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
      ws.on('open', () => {
        pongAt = Date.now();
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_subscribe',
            params: ['logs', { address: scanner.pools.map((p) => p.address) }],
          }),
        );
      });
      ws.on('pong', () => {
        pongAt = Date.now();
      });
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m.error) {
            store.event('ws_subscription_error');
            ws.close();
          } else if (m.method === 'eth_subscription') dirty = true;
        } catch {}
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        if (!stopped) {
          store.event('ws_disconnect');
          reconnectAt = Date.now() + 15000;
        }
        ws = undefined;
      });
    };
    connect();
    console.log('Ethereum simulation scanner started. No transaction signing or broadcasting.');
    if (!cfg.telegramToken)
      console.log('Telegram not configured; reports available with npm run report.');
    while (!stopped) {
      const now = Date.now();
      if (now - lastPrune > 86400000) {
        store.prune();
        lastPrune = now;
      }
      if (ws?.readyState === WebSocket.OPEN && now - lastPing > 30000) {
        if (now - pongAt > 90000) ws.terminate();
        else ws.ping();
        lastPing = now;
      }
      if (cfg.ws && !ws && now >= reconnectAt) connect();
      if (now - store.get('discoveryAt', 0) > 86400000 && now - lastRefreshAttempt > 3600000) {
        lastRefreshAttempt = now;
        try {
          await scanner.refresh();
          ws?.close();
        } catch {
          store.event('discovery_error');
        }
      }
      const remaining =
        cfg.dailyCalls - store.get('rpc:' + new Date(now).toISOString().slice(0, 10), 0);
      const interval = Math.max(12000, budgetDelay(now, remaining, 4 + cfg.simulations));
      if ((dirty || now - lastPoll >= cfg.pollMs) && now - lastPoll >= interval) {
        dirty = false;
        lastPoll = now;
        try {
          if (await scanner.scan()) lastScan = Date.now();
        } catch (e) {
          store.event('scan_error', {
            code: e.message?.startsWith('RPC_') ? e.message : 'SCAN_FAILED',
          });
          console.warn('Scan failed; retrying next interval.');
        }
      }
      try {
        await scheduledReport(store, cfg);
      } catch {
        store.event('report_error');
        console.warn('Daily report delivery failed; will retry.');
        await sleep(30000);
      }
      const path = join(cfg.data, 'health.json');
      writeFileSync(path + '.tmp', JSON.stringify({ at: Date.now(), lastScan }));
      renameSync(path + '.tmp', path);
      if (!stopped) await sleep(1000);
    }
  } finally {
    stopped = true;
    ws?.terminate();
    store.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(
      'Startup failed:',
      /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'CHECK_CONFIGURATION_OR_RPC',
    );
    process.exitCode = 1;
  });
