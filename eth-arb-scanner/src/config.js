import { parseEther, parseGwei } from 'viem';
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
export const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
export const PROBE = '0x00000000000000000000000000000000aabbccdd';
export const VENUES = {
  'uniswap-v2': {
    v3: false,
    fee: 3000,
    factory: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
    router: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  },
  'sushiswap-v2': {
    v3: false,
    fee: 3000,
    factory: '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac',
    router: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',
  },
  'uniswap-v3': {
    v3: true,
    factory: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    router: '0xe592427a0aece92de3edee1f18e0157c05861564',
  },
};
export function config(env = process.env) {
  const num = (key, def, min, max) => {
    const n = Number(env[key] || def);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const time = env.REPORT_TIME || '21:00',
    zone = env.REPORT_TIMEZONE || 'Europe/Berlin';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid REPORT_TIME');
  new Intl.DateTimeFormat('en', { timeZone: zone }).format();
  const sizes = (env.TRADE_SIZES_ETH || '0.005,0.02,0.1,0.5')
    .split(',')
    .map((x) => parseEther(x.trim()));
  if (!sizes.length || sizes.length > 10 || sizes.some((x) => x <= 0n || x > 10n ** 19n))
    throw new Error('Invalid TRADE_SIZES_ETH');
  const http = env.RPC_HTTP_URL || '';
  const ws = env.RPC_WS_URL || '';
  if (http && !/^https?:\/\//.test(http)) throw new Error('Invalid RPC_HTTP_URL');
  if (ws && !/^wss?:\/\//.test(ws)) throw new Error('Invalid RPC_WS_URL');
  if (Boolean(env.TELEGRAM_BOT_TOKEN) !== Boolean(env.TELEGRAM_CHAT_ID))
    throw new Error('Set both Telegram variables or neither');
  const minProfit = parseEther(env.MIN_NET_PROFIT_ETH || '0.0005'),
    priority = parseGwei(env.PRIORITY_FEE_GWEI || '1');
  if (minProfit <= 0n || priority < 0n)
    throw new Error('Profit must be positive and priority fee nonnegative');
  return {
    http,
    ws,
    time,
    zone,
    sizes,
    data: env.DATA_DIR || './data',
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    chat: env.TELEGRAM_CHAT_ID || '',
    maxPools: Math.floor(num('MAX_POOLS', 24, 2, 100)),
    minLiquidity: num('MIN_LIQUIDITY_USD', 20000, 1000, 1e9),
    minVolume: num('MIN_VOLUME_24H_USD', 500, 0, 1e12),
    simulations: Math.floor(num('MAX_SIMULATIONS_PER_BLOCK', 4, 1, 20)),
    dailyCalls: Math.floor(num('MAX_RPC_CALLS_PER_DAY', 15000, 100, 1e7)),
    rpcInterval: num('RPC_INTERVAL_MS', 180, 100, 10000),
    pollMs: num('POLL_INTERVAL_MS', 30000, 12000, 600000),
    minProfit,
    spreadBps: num('MIN_SPREAD_BPS', 20, 0, 10000),
    gasMargin: BigInt(Math.floor(num('GAS_MARGIN_BPS', 2500, 0, 100000))),
    priority,
  };
}
