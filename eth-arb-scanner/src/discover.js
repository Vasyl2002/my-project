import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, WETH, VENUES } from './config.js';
import { poolAbi } from './abi.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function selectPools(pairs, cfg) {
  const candidates = pairs
    .filter(
      (p) =>
        p.chainId === 'ethereum' &&
        /^0x[0-9a-fA-F]{40}$/.test(p.pairAddress) &&
        [p.baseToken.address.toLowerCase(), p.quoteToken.address.toLowerCase()].includes(WETH) &&
        Number(p.liquidity?.usd) >= cfg.minLiquidity &&
        Number(p.volume?.h24) >= cfg.minVolume,
    )
    .map((p) => {
      const version = (p.labels || []).includes('v3')
        ? 'v3'
        : (p.labels || []).includes('v4')
          ? 'v4'
          : 'v2';
      return { ...p, venue: p.dexId + '-' + version };
    })
    .filter((p) => VENUES[p.venue]);
  const groups = new Map();
  for (const p of candidates) {
    const token = p.baseToken.address.toLowerCase() === WETH ? p.quoteToken : p.baseToken;
    const key = token.address.toLowerCase();
    const rows = groups.get(key) || [];
    if (!rows.some((x) => x.address === p.pairAddress.toLowerCase()))
      rows.push({
        address: p.pairAddress.toLowerCase(),
        token: key,
        symbol: token.symbol.slice(0, 20),
        venue: p.venue,
        liquidityUsd: p.liquidity.usd,
        volume24h: p.volume.h24,
      });
    groups.set(key, rows);
  }
  const ranked = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => {
      g.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
      // Deep reference plus a second active venue/fee tier; cap per token for diversity.
      const anchor = g[0],
        others = g
          .slice(1)
          .sort((a, b) => b.volume24h / b.liquidityUsd - a.volume24h / a.liquidityUsd);
      return [anchor, ...others.slice(0, 2)];
    })
    .sort(
      (a, b) =>
        Math.max(...b.map((x) => x.volume24h / x.liquidityUsd)) -
        Math.max(...a.map((x) => x.volume24h / x.liquidityUsd)),
    );
  const selected = [];
  // Allocate pairs first so no singleton consumes the quota.
  for (const g of ranked) if (selected.length + 2 <= cfg.maxPools) selected.push(...g.slice(0, 2));
  for (const g of ranked)
    if (g[2] && selected.some((p) => p.token === g[0].token) && selected.length < cfg.maxPools)
      selected.push(g[2]);
  return selected;
}
export async function discover(cfg) {
  const tokens = JSON.parse(
    readFileSync(new URL('../config/tokens.json', import.meta.url), 'utf8'),
  );
  const pairs = [];
  const failures = [];
  for (const token of tokens) {
    try {
      const r = await fetch(
        'https://api.dexscreener.com/token-pairs/v1/ethereum/' + token.address,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!r.ok) throw new Error();
      const rows = await r.json();
      if (!Array.isArray(rows)) throw new Error();
      pairs.push(
        ...rows.filter((p) =>
          [p.baseToken?.address?.toLowerCase(), p.quoteToken?.address?.toLowerCase()].includes(
            token.address.toLowerCase(),
          ),
        ),
      );
    } catch {
      failures.push(token.symbol);
    }
    await sleep(250);
  }
  if (failures.length) console.warn('Discovery unavailable for:', failures.join(', '));
  const pools = selectPools(pairs, cfg);
  if (!pools.length) throw new Error('NO_ELIGIBLE_POOLS');
  return { updatedAt: new Date().toISOString(), failures, pools };
}
export async function validatePools(rpc, pools) {
  const block = await rpc.request('eth_blockNumber');
  const calls = pools.flatMap((p) =>
    ['token0', 'token1', 'factory', ...(VENUES[p.venue].v3 ? ['fee'] : [])].map((name) => ({
      address: p.address,
      abi: poolAbi,
      name,
    })),
  );
  const results = await rpc.multi(calls, block);
  let i = 0;
  const verified = [];
  for (const p of pools) {
    const venue = VENUES[p.venue];
    const token0 = results[i++]?.toLowerCase(),
      token1 = results[i++]?.toLowerCase(),
      factory = results[i++]?.toLowerCase();
    const fee = venue.v3 ? results[i++] : 3000;
    if (
      factory !== venue.factory ||
      !token0 ||
      !token1 ||
      ![token0, token1].includes(WETH) ||
      ![token0, token1].includes(p.token) ||
      !Number.isInteger(fee) ||
      fee <= 0 ||
      fee >= 1e6
    )
      continue;
    verified.push({ ...p, ...venue, token0, token1, fee });
  }
  const canonical = await rpc.multi(
    verified.map((p) => ({
      address: p.factory,
      abi: poolAbi,
      name: p.v3 ? 'getPool' : 'getPair',
      args: p.v3 ? [p.token0, p.token1, p.fee] : [p.token0, p.token1],
    })),
    block,
  );
  const accepted = verified.filter((p, j) => canonical[j]?.toLowerCase() === p.address);
  return accepted.filter((p) => accepted.filter((q) => q.token === p.token).length >= 2);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = config();
  const result = await discover(cfg);
  mkdirSync(cfg.data, { recursive: true });
  writeFileSync(join(cfg.data, 'discovered.json'), JSON.stringify(result, null, 2));
  console.table(
    result.pools.map((p) => ({
      token: p.symbol,
      venue: p.venue,
      liquidity: Math.round(p.liquidityUsd),
      volume: Math.round(p.volume24h),
      pool: p.address,
    })),
  );
  console.log('Discovery only; contracts are validated on-chain at scanner startup.');
}
