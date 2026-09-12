import { config } from './config.js';
import { Rpc } from './rpc.js';
import { Store } from './store.js';
import { discover, validatePools } from './discover.js';
import { artifact, checkOverrides, simulate } from './simulate.js';
const cfg = config(),
  store = new Store(cfg.data);
try {
  if (!cfg.http) throw new Error('RPC_HTTP_URL_REQUIRED');
  const rpc = new Rpc(cfg, store);
  if (BigInt(await rpc.request('eth_chainId')) !== 1n) throw new Error('ETHEREUM_MAINNET_REQUIRED');
  await checkOverrides(rpc);
  const found = await discover(cfg);
  const pools = await validatePools(rpc, found.pools);
  if (pools.length < 2) throw new Error('NO_VALIDATED_POOLS');
  const block = await rpc.request('eth_getBlockByNumber', ['latest', false]);
  const compiled = artifact(),
    results = [],
    types = new Set();
  for (const buy of pools)
    for (const sell of pools) {
      if (buy.token !== sell.token || buy.address === sell.address) continue;
      const type = `${buy.venue}>${sell.venue}`;
      if (types.has(type)) continue;
      types.add(type);
      results.push(
        await simulate(
          rpc,
          compiled,
          { buy, sell, key: buy.address + '>' + sell.address },
          cfg.sizes[0],
          block,
          cfg,
        ),
      );
    }
  console.log(
    JSON.stringify(
      {
        chainId: 1,
        validatedPools: pools.length,
        routeTypes: [...types],
        roundTripSimulations: results,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : 'CHECK_FAILED');
  process.exitCode = 1;
} finally {
  store.close();
}
