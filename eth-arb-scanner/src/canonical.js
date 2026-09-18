import { toHex } from 'viem';
// -1 means awaiting verification, 0 confirmed mismatch, 1 accepted canonical history.
export function beginAudit(store, hash) {
  store.db.exec('BEGIN');
  try {
    store.db.exec(
      'UPDATE simulation_results SET valid=-1 WHERE valid=1; UPDATE signals SET valid=-1 WHERE valid=1',
    );
    rejectHash(store, hash);
    store.set('historyAudit', true);
    store.db.exec('COMMIT');
  } catch (e) {
    store.db.exec('ROLLBACK');
    throw e;
  }
}
function rejectHash(store, hash) {
  store.db
    .prepare(
      "UPDATE simulation_results SET valid=0 WHERE hash=? OR json_extract(data,'$.origin.hash')=?",
    )
    .run(hash, hash);
  store.db.prepare('UPDATE signals SET valid=0 WHERE hash=?').run(hash);
}
export async function auditHistory(store, rpc, limit = 8) {
  if (!store.get('historyAudit', false)) return true;
  for (let i = 0; i < limit; i++) {
    const row = store.db
      .prepare(
        `SELECT hash,block FROM (
      SELECT hash,CAST(json_extract(data,'$.block') AS INTEGER) AS block FROM simulation_results WHERE valid=-1
      UNION SELECT hash,block FROM signals WHERE valid=-1
    ) ORDER BY block DESC LIMIT 1`,
      )
      .get();
    if (!row) {
      store.set('historyAudit', false);
      return true;
    }
    const block = await rpc.request('eth_getBlockByNumber', [toHex(row.block), false]);
    if (!block?.hash) return false;
    if (block.hash !== row.hash) {
      rejectHash(store, row.hash);
      continue;
    }
    // A common canonical ancestor confirms its earlier history. Competing hashes at
    // the same height still need explicit rejection, not restoration.
    store.db
      .prepare(
        "UPDATE simulation_results SET valid=1 WHERE valid=-1 AND (CAST(json_extract(data,'$.block') AS INTEGER)<? OR hash=?)",
      )
      .run(row.block, row.hash);
    store.db
      .prepare('UPDATE signals SET valid=1 WHERE valid=-1 AND (block<? OR hash=?)')
      .run(row.block, row.hash);
  }
  return false;
}
export function priorityDecision({
  now,
  lastAttempt,
  pending,
  remaining,
  spent,
  dailyCalls,
  simulations = 4,
}) {
  const reserve = Math.min(300, Math.floor(dailyCalls / 10));
  const maxCalls = 3 * (8 + 3 + simulations); // Audit, headers and simulations, including RPC retries.
  return {
    reserve,
    due:
      pending && now - lastAttempt >= 3000 && remaining >= maxCalls && reserve - spent >= maxCalls,
  };
}
