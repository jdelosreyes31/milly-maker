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
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  _db = new duckdb.AsyncDuckDB(logger, worker);
  await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const dbPath = opfsSupported ? "opfs://milly-maker.db" : ":memory:";
  await _db.open({
    path: dbPath,
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
  });

  _conn = await _db.connect();
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
