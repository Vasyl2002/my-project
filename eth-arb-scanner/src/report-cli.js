import { config } from './config.js';
import { Store } from './store.js';
import { reportText, sendTelegram } from './report.js';
const cfg = config(),
  store = new Store(cfg.data);
try {
  const text = reportText(store, cfg);
  if (process.argv.includes('--send')) {
    await sendTelegram(cfg, text);
    console.log('Report sent');
  } else console.log(text);
} finally {
  store.close();
}
