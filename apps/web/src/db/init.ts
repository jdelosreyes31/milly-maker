import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbMvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: duckdbEhWasm, mainWorker: ehWorker },
};

let _db: duckdb.AsyncDuckDB | null = null;
let _conn: duckdb.AsyncDuckDBConnection | null = null;

export const opfsSupported =
  typeof navigator !== "undefined" &&
  typeof navigator.storage?.getDirectory === "function";

export async function initDuckDB(): Promise<duckdb.AsyncDuckDBConnection> {
  if (_conn) return _conn;

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const dbPath = opfsSupported ? "opfs://milly-maker.db" : ":memory:";

  async function tryOpen(attemptCount = 0): Promise<duckdb.AsyncDuckDBConnection> {
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    try {
      await db.open({ path: dbPath, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
      const conn = await db.connect();
      _db = db;
      return conn;
    } catch (err) {
      // WAL replay failure: the write-ahead log is corrupted (e.g. tab killed mid-write).
      // Delete the .wal file and retry once — the main .db file is usually intact.
      const msg = String(err instanceof Error ? err.message : err);
      const isWalError =
        msg.includes("WAL") ||
        msg.includes("GetDefaultDatabase") ||
        msg.includes("replaying");

      if (isWalError && attemptCount === 0 && opfsSupported) {
        console.warn("[DB] Corrupted WAL detected — removing and retrying…", err);
        try {
          const root = await navigator.storage.getDirectory();
          // Remove WAL and SHM files; keep the main .db so data survives
          for (const name of ["milly-maker.db.wal", "milly-maker.db.shm"]) {
            try { await root.removeEntry(name); } catch { /* file may not exist */ }
          }
        } catch (fsErr) {
          console.error("[DB] Could not remove WAL file:", fsErr);
        }
        await db.terminate();
        return tryOpen(1);
      }

      // If WAL retry also failed, wipe everything and start fresh
      if (isWalError && attemptCount === 1 && opfsSupported) {
        console.warn("[DB] WAL retry failed — wiping OPFS and starting fresh…");
        try {
          const root = await navigator.storage.getDirectory();
          for (const name of ["milly-maker.db", "milly-maker.db.wal", "milly-maker.db.shm"]) {
            try { await root.removeEntry(name); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        await db.terminate();
        return tryOpen(2);
      }

      await db.terminate();
      throw err;
    }
  }

  _conn = await tryOpen();

  // ── WAL prevention ────────────────────────────────────────────────────────
  // The WAL corrupts when the browser kills the tab before DuckDB can checkpoint.
  // Fix: checkpoint aggressively so the WAL is always small / empty at close time.

  async function checkpoint() {
    if (!_conn) return;
    try { await _conn.query("CHECKPOINT"); } catch { /* ignore if already closing */ }
  }

  async function closeDb() {
    if (!_conn) return;
    try { await _conn.close(); } catch { /* ignore */ }
    if (_db) { try { await _db.terminate(); } catch { /* ignore */ } }
    _conn = null;
    _db = null;
  }

  // Checkpoint when tab goes to background (catches tab switches and most closes)
  function onVisibilityChange() {
    if (document.visibilityState === "hidden") void checkpoint();
  }
  // Close + checkpoint on actual page unload (back/forward, close, navigate away)
  function onPageHide() { void closeDb(); }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);

  // Periodic checkpoint every 30 s — keeps WAL tiny so crash window is small
  setInterval(() => void checkpoint(), 30_000);

  return _conn;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!_conn) throw new Error("DuckDB not initialized");
  return _conn;
}

export function getDb(): duckdb.AsyncDuckDB {
  if (!_db) throw new Error("DuckDB not initialized");
  return _db;
}

export async function resetDatabase(): Promise<void> {
  // Close connection and terminate worker so OPFS file lock is released
  if (_conn) { try { await _conn.close(); } catch { /* ignore */ } }
  if (_db)   { try { await _db.terminate(); } catch { /* ignore */ } }
  _conn = null;
  _db = null;

  // Delete all DB files from OPFS
  if (opfsSupported) {
    const root = await navigator.storage.getDirectory();
    for (const name of ["milly-maker.db", "milly-maker.db.wal", "milly-maker.db.shm"]) {
      try { await root.removeEntry(name); } catch { /* may not exist */ }
    }
  }
}
