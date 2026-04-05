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
let _worker: Worker | null = null; // raw worker ref for synchronous termination on pagehide

export const opfsSupported =
  typeof navigator !== "undefined" &&
  typeof navigator.storage?.getDirectory === "function";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── IndexedDB staging ─────────────────────────────────────────────────────────
// The import buffer is stored in IndexedDB so it survives the page reload that
// happens between "user picks file" and "DuckDB applies the import".

const IDB_DB_NAME = "milly-maker-import";
const IDB_STORE   = "pending";
const IDB_KEY     = "db-file";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function savePendingImport(buffer: ArrayBuffer): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, "readwrite");
    const put = tx.objectStore(IDB_STORE).put(buffer, IDB_KEY);
    put.onsuccess = () => { db.close(); resolve(); };
    put.onerror   = () => reject(put.error);
  });
}

export async function loadPendingImport(): Promise<ArrayBuffer | null> {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, "readonly");
      const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
      get.onsuccess = () => { db.close(); resolve((get.result as ArrayBuffer) ?? null); };
      get.onerror   = () => reject(get.error);
    });
  } catch { return null; }
}

export async function clearPendingImport(): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); };
    });
  } catch { /* best-effort */ }
}

// ── OPFS helpers ──────────────────────────────────────────────────────────────

async function wipeOpfs() {
  try {
    const root = await navigator.storage.getDirectory();
    // @ts-expect-error — entries() is available in all modern browsers
    for await (const [name] of root.entries()) {
      try { await root.removeEntry(name, { recursive: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ── Import via dual DuckDB instance ──────────────────────────────────────────
//
// registerFileBuffer + ATTACH does not work for DuckDB files (ATTACH bypasses
// the virtual FS and hits the real filesystem).  Instead we spin up a SECOND
// DuckDB worker, open the backup file in it (in-memory via registerFileBuffer +
// db.open), query each table as an Arrow result, and insertArrowTable into the
// main DB.  No raw OPFS writes, no SAH conflicts.
//
// Returns true if an import was applied, false if no pending import.

export async function applyPendingImport(
  mainDb: duckdb.AsyncDuckDB,
  mainConn: duckdb.AsyncDuckDBConnection,
): Promise<boolean> {
  const buffer = await loadPendingImport();
  if (!buffer) return false;

  console.log("[DB] Pending import — opening backup in second DuckDB instance…");

  // Clear before starting so a mid-import crash doesn't loop on next reload
  await clearPendingImport();

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const bkWorker = new Worker(bundle.mainWorker!);
  const bkDb = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    bkWorker,
  );

  try {
    await bkDb.instantiate(bundle.mainModule, bundle.pthreadWorker);
    // Register the backup bytes as a virtual file, then open it as the DB
    await bkDb.registerFileBuffer("_bk.db", new Uint8Array(buffer));
    await bkDb.open({ path: "_bk.db" });
    const bkConn = await bkDb.connect();

    try {
      // Tables present in the backup
      const bkTables = new Set(
        (await bkConn.query("SHOW TABLES"))
          .toArray()
          .map((r: Record<string, unknown>) => String(r.name)),
      );

      // Tables in the freshly-migrated main DB (skip __migrations)
      const mainTables = (await mainConn.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
          AND table_name != '__migrations'
      `))
        .toArray()
        .map((r: Record<string, unknown>) => String(r.table_name));

      for (const t of mainTables) {
        if (!bkTables.has(t)) {
          console.log(`[DB] Skipping ${t} (not in backup)`);
          continue;
        }

        // Columns present in the main (migrated) schema
        const mainCols = new Set(
          (await mainConn.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'main' AND table_name = '${t}'
          `))
            .toArray()
            .map((r: Record<string, unknown>) => String(r.column_name)),
        );

        // Columns in the backup table (DESCRIBE returns column_name)
        const bkCols = (await bkConn.query(`DESCRIBE "${t}"`))
          .toArray()
          .map((r: Record<string, unknown>) => String(r.column_name))
          .filter((c) => mainCols.has(c));

        if (!bkCols.length) continue;

        const colSelect = bkCols.map((c) => `"${c}"`).join(", ");
        // Query backup rows as Arrow.
        // insertArrowTable maps positionally, so we stage into a temp table
        // first, then do an explicit named-column INSERT into main.  This
        // handles schema drift (e.g. backup missing a column added by a later
        // migration — the missing column will be NULL in main).
        const arrowData = await bkConn.query(`SELECT ${colSelect} FROM "${t}"`);
        const tmpName = `_import_tmp_${t}`;
        await mainConn.query(`DROP TABLE IF EXISTS "${tmpName}"`);
        await mainConn.insertArrowTable(arrowData, {
          name: tmpName,
          schema: "main",
          create: true,
        });
        await mainConn.query(`DELETE FROM "${t}"`);
        await mainConn.query(
          `INSERT INTO "${t}" (${colSelect}) SELECT ${colSelect} FROM "${tmpName}"`,
        );
        await mainConn.query(`DROP TABLE IF EXISTS "${tmpName}"`);

        console.log(`[DB] ✓ ${t} (${arrowData.numRows} rows)`);
      }

      try { await mainConn.query("CHECKPOINT"); } catch { /* ignore */ }
      console.log("[DB] Import complete.");
      return true;
    } finally {
      try { await bkConn.close(); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[DB] Import failed:", err);
    throw err;
  } finally {
    try { await bkDb.terminate(); } catch { /* ignore */ }
  }
}

// ── DuckDB init ───────────────────────────────────────────────────────────────

export async function initDuckDB(): Promise<duckdb.AsyncDuckDBConnection> {
  if (_conn) return _conn;

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const dbPath = opfsSupported ? "opfs://milly-maker.db" : ":memory:";

  // ── Coordinate OPFS access with the previous page instance ───────────────
  // The old page holds an exclusive Web Lock for its entire lifetime.
  // Browsers release Web Locks AFTER destroying the page's workers and their
  // OPFS SyncAccessHandles, so waiting here guarantees the old SAH is free
  // before tryOpen() runs — no polling or retries needed.
  if (opfsSupported && typeof navigator.locks !== "undefined") {
    await new Promise<void>((resolveOnLockAcquired) => {
      void navigator.locks.request(
        "milly-maker-db-opfs",
        { mode: "exclusive" },
        () => {
          resolveOnLockAcquired();
          // Hold the lock for the lifetime of this page. The browser releases
          // it automatically on page unload — no manual release needed.
          return new Promise<void>(() => {});
        },
      );
    });
  }

  async function tryOpen(attemptCount = 0): Promise<duckdb.AsyncDuckDBConnection> {
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    try {
      await db.open({ path: dbPath, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
      const conn = await db.connect();
      _db = db;
      _worker = worker; // keep raw ref for synchronous pagehide termination
      return conn;
    } catch (err) {
      // DuckDB throws plain objects {exception_type, exception_message}, not Error instances.
      const msg = err instanceof Error
        ? err.message
        : (typeof err === "object" ? JSON.stringify(err) : String(err));

      const isWalError =
        msg.includes("WAL") ||
        msg.includes("GetDefaultDatabase") ||
        msg.includes("replaying");

      const isWriteError =
        msg.includes("write mode") ||
        msg.includes("Failed to commit");

      // Previous tab/worker still holds the OPFS SyncAccessHandle — happens
      // when the page is refreshed before pagehide fully terminates the worker.
      const isSahConflict =
        msg.includes("Access Handle") ||
        msg.includes("createSyncAccessHandle");

      await db.terminate();

      if (opfsSupported) {
        // SAH conflict: just wait longer for the OS to release the handle
        if (isSahConflict && attemptCount < 3) {
          const delay = 400 * (attemptCount + 1); // 400ms, 800ms, 1200ms
          console.warn(`[DB] SAH conflict (attempt ${attemptCount + 1}) — retrying in ${delay}ms…`);
          await sleep(delay);
          return tryOpen(attemptCount + 1);
        }

        if (isWalError && attemptCount === 0) {
          console.warn("[DB] Corrupted WAL — removing WAL files and retrying…");
          try {
            const root = await navigator.storage.getDirectory();
            for (const name of ["milly-maker.db.wal", "milly-maker.db.shm"]) {
              try { await root.removeEntry(name); } catch { /* may not exist */ }
            }
          } catch { /* ignore */ }
          await sleep(200);
          return tryOpen(1);
        }

        if (isWriteError && attemptCount === 0) {
          console.warn("[DB] Write-mode error — wiping OPFS and starting fresh…");
          await wipeOpfs();
          await sleep(400);
          return tryOpen(1);
        }

        if ((isWalError || isWriteError) && attemptCount === 1) {
          console.warn("[DB] Second attempt failed — full OPFS wipe…");
          await wipeOpfs();
          await sleep(500);
          return tryOpen(2);
        }
      }

      throw err;
    }
  }

  _conn = await tryOpen();

  // ── WAL prevention ────────────────────────────────────────────────────────

  async function checkpoint() {
    if (!_conn) return;
    try { await _conn.query("CHECKPOINT"); } catch { /* ignore if already closing */ }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void checkpoint();
  });

  // pagehide: terminate the worker SYNCHRONOUSLY so the OPFS SyncAccessHandle
  // is released before the new page load starts.  Async close/terminate won't
  // work here — the event loop stops while the page is unloading, so awaited
  // promises never resolve and worker.terminate() is never reached.
  window.addEventListener("pagehide", () => {
    try { _worker?.terminate(); } catch { /* ignore */ }
    _worker = null;
    _conn = null;
    _db = null;
  });

  // Periodic checkpoint every 30 s
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

export async function exportDatabase(): Promise<Blob> {
  if (_conn) {
    try { await _conn.query("CHECKPOINT"); } catch { /* ignore */ }
  }
  if (!_db) throw new Error("Database not initialized");
  const buffer = await _db.copyFileToBuffer("opfs://milly-maker.db");
  return new Blob([buffer.buffer as ArrayBuffer], { type: "application/octet-stream" });
}

export async function importDatabase(file: File): Promise<void> {
  // Stage the buffer in IndexedDB, wipe OPFS (so the next load starts fresh),
  // and reload.  applyPendingImport() in useDb runs after migrations to copy
  // the data in via ATTACH — no direct OPFS writes, no SAH conflicts.

  const buffer = await file.arrayBuffer();

  try { _worker?.terminate(); } catch { /* ignore */ }
  if (_conn) { try { await _conn.close(); } catch { /* ignore */ } }
  if (_db)   { try { await _db.terminate(); } catch { /* ignore */ } }
  _conn = null;
  _db = null;
  _worker = null;

  await sleep(300);

  if (opfsSupported) await wipeOpfs();

  await savePendingImport(buffer);

  location.reload();
}

export async function resetDatabase(): Promise<void> {
  try { _worker?.terminate(); } catch { /* ignore */ }
  if (_conn) { try { await _conn.close(); } catch { /* ignore */ } }
  if (_db)   { try { await _db.terminate(); } catch { /* ignore */ } }
  _conn = null;
  _db = null;
  _worker = null;

  await sleep(300);

  if (opfsSupported) {
    await wipeOpfs();
  }

  await sleep(200);
}
