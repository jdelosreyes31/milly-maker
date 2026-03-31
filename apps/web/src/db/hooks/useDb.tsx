import React, { createContext, useContext, useEffect, useState } from "react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { initDuckDB, opfsSupported } from "../init.js";
import { runMigrations } from "../migrations/runner.js";

type DbStatus = "idle" | "initializing" | "ready" | "error";

interface DbContextValue {
  conn: AsyncDuckDBConnection | null;
  status: DbStatus;
  error: string | null;
}

const DbContext = createContext<DbContextValue>({
  conn: null,
  status: "idle",
  error: null,
});

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null);
  const [status, setStatus] = useState<DbStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("initializing");
    initDuckDB()
      .then(async (c) => {
        await runMigrations(c);
        setConn(c);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("[DB] Init failed:", err);
        setError(String(err));
        setStatus("error");
      });
  }, []);

  if (status === "initializing" || status === "idle") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-background)]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-primary)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading database…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    async function handleReset() {
      try {
        const root = await navigator.storage.getDirectory();
        for (const name of ["milly-maker.db", "milly-maker.db.wal", "milly-maker.db.shm"]) {
          try { await root.removeEntry(name); } catch { /* file may not exist */ }
        }
      } catch { /* ignore */ }
      location.reload();
    }

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-background)] p-6">
        <div className="max-w-md rounded-[var(--radius)] border border-[var(--color-danger)]/40 bg-[var(--color-surface)] p-6 text-center">
          <p className="mb-2 text-base font-semibold text-[var(--color-danger)]">Database failed to load</p>
          <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            Make sure you're using Chrome or Edge for full OPFS support.
          </p>
          {opfsSupported && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-5">
              <p className="mb-3 text-xs text-[var(--color-text-subtle)]">
                If the database is corrupted, you can wipe it and start fresh.
                <span className="block mt-1 font-medium text-[var(--color-danger)]/80">
                  This will permanently delete all your data.
                </span>
              </p>
              <button
                onClick={handleReset}
                className="rounded-[var(--radius)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/20"
              >
                Reset Database
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <DbContext.Provider value={{ conn, status, error }}>
      {!opfsSupported && (
        <div className="flex items-center justify-center gap-2 bg-[var(--color-warning)]/10 px-4 py-2 text-xs text-[var(--color-warning)]">
          ⚠ Your browser doesn't support persistent storage. Data will be lost on refresh. Use Chrome or Edge.
        </div>
      )}
      {children}
    </DbContext.Provider>
  );
}

export function useDb(): DbContextValue {
  return useContext(DbContext);
}
