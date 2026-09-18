import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'scanner.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_time ON events(ts);
 CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,block INTEGER NOT NULL,hash TEXT NOT NULL,route TEXT NOT NULL,input TEXT NOT NULL,net TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(hash,route,input));
 CREATE TABLE IF NOT EXISTS simulation_results(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,hash TEXT NOT NULL,route TEXT NOT NULL,input TEXT NOT NULL,source TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,UNIQUE(hash,route,input,source));
 CREATE INDEX IF NOT EXISTS simulation_results_time ON simulation_results(ts);`);
    if (
      !this.db
        .prepare('PRAGMA table_info(signals)')
        .all()
        .some((c) => c.name === 'valid')
    )
      this.db.exec('ALTER TABLE signals ADD COLUMN valid INTEGER NOT NULL DEFAULT 1');
  }
  get(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db
      .prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }
  event(kind, data = {}) {
    this.db
      .prepare('INSERT INTO events(ts,kind,data) VALUES(?,?,?)')
      .run(Date.now(), kind, JSON.stringify(data));
  }
  signal(s) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO signals(ts,block,hash,route,input,net,data) VALUES(?,?,?,?,?,?,?)',
      )
      .run(Date.now(), Number(s.block), s.hash, s.route, s.input, s.net, JSON.stringify(s));
  }
  prune() {
    const cutoff = Date.now() - 30 * 86400000;
    this.db.prepare('DELETE FROM events WHERE ts<?').run(cutoff);
    this.db.prepare('DELETE FROM signals WHERE ts<?').run(cutoff);
    this.db.prepare('DELETE FROM simulation_results WHERE ts<?').run(cutoff);
  }
  simulation(s, source, minProfit) {
    const gross = BigInt(s.output) - BigInt(s.input);
    const net = gross - BigInt(s.gasBudget);
    if (net !== BigInt(s.net)) throw new Error('INCONSISTENT_SIMULATION_RESULT');
    const data = { ...s, gross: gross.toString(), source, minProfit: minProfit.toString() };
    this.db
      .prepare(
        'INSERT OR IGNORE INTO simulation_results(ts,hash,route,input,source,data) VALUES(?,?,?,?,?,?)',
      )
      .run(Date.now(), s.hash, s.route, s.input, source, JSON.stringify(data));
  }
  close() {
    this.db.close();
  }
}
