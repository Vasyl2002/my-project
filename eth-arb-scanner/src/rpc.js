import { encodeFunctionData, decodeFunctionResult, toHex } from 'viem';
import { mcAbi } from './abi.js';
import { MULTICALL } from './config.js';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export class Rpc {
  constructor(cfg, store) {
    this.cfg = cfg;
    this.store = store;
    this.tail = Promise.resolve();
    this.id = 0;
  }
  request(method, params = []) {
    const p = this.tail.then(() => this.send(method, params));
    this.tail = p.catch(() => {});
    return p;
  }
  async send(method, params) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const day = new Date().toISOString().slice(0, 10),
        key = 'rpc:' + day;
      const count = this.store.get(key, 0);
      if (count >= this.cfg.dailyCalls) throw new Error('RPC_DAILY_BUDGET');
      this.store.set(key, count + 1);
      await wait(this.cfg.rpcInterval);
      let response;
      try {
        response = await fetch(this.cfg.http, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        if (attempt === 2) throw new Error('RPC_NETWORK');
        await wait(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw new Error('RPC_HTTP_' + response.status);
        await wait(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new Error('RPC_HTTP_' + response.status);
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error('RPC_INVALID_JSON');
      }
      // Never log URLs or provider error bodies: they can contain API credentials.
      if (body.error) throw new Error('RPC_ERROR_' + body.error.code);
      if (body.result === undefined) throw new Error('RPC_MISSING_RESULT');
      return body.result;
    }
  }
  async read(address, abi, name, args = [], block = 'latest') {
    const data = encodeFunctionData({ abi, functionName: name, args });
    const result = await this.request('eth_call', [
      { to: address, data },
      typeof block === 'bigint' ? toHex(block) : block,
    ]);
    return decodeFunctionResult({ abi, functionName: name, data: result });
  }
  async multi(calls, block) {
    if (!calls.length) return [];
    const results = await this.read(
      MULTICALL,
      mcAbi,
      'aggregate3',
      [
        calls.map((c) => ({
          target: c.address,
          allowFailure: true,
          callData: encodeFunctionData({ abi: c.abi, functionName: c.name, args: c.args || [] }),
        })),
      ],
      block,
    );
    return results.map((r, i) => {
      if (!r.success) return null;
      try {
        return decodeFunctionResult({
          abi: calls[i].abi,
          functionName: calls[i].name,
          data: r.returnData,
        });
      } catch {
        return null;
      }
    });
  }
}
