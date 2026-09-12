import { readFileSync } from 'node:fs';
import { encodeFunctionData, decodeFunctionResult, toHex, parseEther } from 'viem';
import { PROBE } from './config.js';
import { gasCost } from './math.js';
import { compile } from './compile.js';
export function artifact() {
  try {
    return JSON.parse(readFileSync(new URL('../artifacts/probe.json', import.meta.url), 'utf8'));
  } catch {
    return compile();
  }
}
export async function simulate(rpc, compiled, route, amount, block, cfg) {
  const leg = (p) => ({ router: p.router, fee: p.fee, v3: p.v3 });
  const data = encodeFunctionData({
    abi: compiled.abi,
    functionName: 'run',
    args: [route.buy.token, amount, leg(route.buy), leg(route.sell)],
  });
  const response = await rpc.request('eth_call', [
    { from: PROBE, to: PROBE, data, gas: toHex(2500000) },
    { blockHash: block.hash, requireCanonical: true },
    { [PROBE]: { code: compiled.code, balance: toHex(parseEther('100')) } },
  ]);
  const [output, gasUsed] = decodeFunctionResult({
    abi: compiled.abi,
    functionName: 'run',
    data: response,
  });
  const cost = gasCost(gasUsed, BigInt(block.baseFeePerGas), cfg.priority, cfg.gasMargin);
  return {
    block: Number(BigInt(block.number)),
    hash: block.hash,
    route: route.key,
    symbol: route.buy.symbol,
    buy: route.buy.address,
    sell: route.sell.address,
    input: amount.toString(),
    output: output.toString(),
    gasUsed: gasUsed.toString(),
    gasBudget: cost.toString(),
    net: (output - amount - cost).toString(),
  };
}
export async function checkOverrides(rpc) {
  // Return 42 from an otherwise empty address, ensuring state overrides really apply.
  const block = await rpc.request('eth_getBlockByNumber', ['latest', false]);
  const data = await rpc.request('eth_call', [
    { to: PROBE },
    { blockHash: block.hash, requireCanonical: true },
    { [PROBE]: { code: '0x602a60005260206000f3' } },
  ]);
  if (BigInt(data) !== 42n) throw new Error('STATE_OVERRIDES_UNSUPPORTED');
}
