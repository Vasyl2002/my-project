import { config } from './config.js';
import { Store } from './store.js';
const cfg = config(),
  store = new Store(cfg.data);
try {
  console.log(
    JSON.stringify(
      {
        lastBlock: store.get('lastBlock'),
        discoveryAt: store.get('discoveryAt'),
        pools: store.get('pools', []),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
