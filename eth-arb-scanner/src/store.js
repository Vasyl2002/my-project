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
 CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,block INTEGER NOT NULL,hash TEXT NOT NULL,route TEXT NOT NULL,input TEXT NOT NULL,net TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(hash,route,input));`);
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
  }
  close() {
    this.db.close();
  }
}
