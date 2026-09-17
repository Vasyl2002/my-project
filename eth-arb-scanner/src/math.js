import { WETH } from './config.js';
export function budgetDelay(now, remainingCalls, callsPerScan) {
  if (remainingCalls <= 0) return Infinity;
  const midnight = Math.floor(now / 86400000) * 86400000 + 86400000;
  return Math.ceil(((midnight - now) * callsPerScan * 1.05) / remainingCalls);
}
export function v2Out(amount, reserveIn, reserveOut, fee = 3000) {
  if (amount <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const effective = amount * BigInt(1000000 - fee);
  return (effective * reserveOut) / (reserveIn * 1000000n + effective);
}
// Spot ratios are ONLY a cheap prefilter, never reported as executable profit.
export function tokenPerWeth(pool, state) {
  let ratio;
  if (pool.v3) {
    const sqrt = state[0];
    ratio = Number(sqrt * sqrt) / 2 ** 192;
  } else {
    if (state[0] === 0n || state[1] === 0n) return 0;
    ratio = Number(state[1]) / Number(state[0]);
  }
  return pool.token0 === WETH ? ratio : 1 / ratio;
}
export function rankedRoutes(pools, states) {
  const out = [];
  for (const a of pools)
    for (const b of pools) {
      if (a.address === b.address || a.token !== b.token) continue;
      const sa = states.get(a.address),
        sb = states.get(b.address);
      if (!sa || !sb) continue;
      const pa = tokenPerWeth(a, sa),
        pb = tokenPerWeth(b, sb);
      if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) continue;
      const rawBps = (pa / pb - 1) * 10000;
      const ratio = (pa / pb) * (1 - a.fee / 1e6) * (1 - b.fee / 1e6);
      const bps = (ratio - 1) * 10000;
      if (Number.isFinite(bps))
        out.push({ buy: a, sell: b, rawBps, bps, key: a.address + '>' + b.address });
    }
  return out.sort((a, b) => b.bps - a.bps);
}
export function routes(pools, states, minBps) {
  return rankedRoutes(pools, states).filter((r) => r.bps > minBps);
}
export function gasCost(gasUsed, baseFee, priority, marginBps) {
  const units = ((gasUsed + 50000n) * (10000n + marginBps)) / 10000n;
  return units * (baseFee * 2n + priority);
}
// The probe measures internal execution only. The fixed overhead remains an estimate.
export function gasDetails(gasUsed, baseFee, priority, marginBps, gross) {
  const estimatedGasUnits = gasUsed + 50000n;
  const estimatedGasCost = estimatedGasUnits * (baseFee + priority);
  return Object.fromEntries(
    Object.entries({
      baseFee,
      priorityFee: priority,
      gasMarginBps: marginBps,
      estimatedGasUnits,
      estimatedGasCost,
      estimatedNet: gross - estimatedGasCost,
      breakEvenGasPrice: gross > 0n ? gross / estimatedGasUnits : null,
    }).map(([key, value]) => [key, value === null ? null : value.toString()]),
  );
}
