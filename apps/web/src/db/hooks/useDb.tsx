import React, { createContext, useContext, useEffect, useState } from "react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { initDuckDB, opfsSupported, resetDatabase, importDatabase, applyPendingImport, getDb } from "../init.js";
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

    async function init() {
      const c = await initDuckDB();
      try {
        await runMigrations(c);
      } catch (migErr) {
        const msg = typeof migErr === "object" ? JSON.stringify(migErr) : String(migErr);
        const isWriteError = msg.includes("write mode") || msg.includes("Failed to commit");
        if (isWriteError) {
          // WAL-only wipe: keep the main DB intact, just clear stale lock files
          try {
            const root = await navigator.storage.getDirectory();
            for (const name of ["milly-maker.db.wal", "milly-maker.db.shm"]) {
              try { await root.removeEntry(name); } catch { /* may not exist */ }
            }
          } catch { /* ignore */ }
        }
        throw migErr;
      }

      // Apply any pending import (user restored a backup).
      // Runs after migrations so the schema exists; copies data via ATTACH
      // using DuckDB's own SQL engine — no direct OPFS writes needed.
      try {
        const imported = await applyPendingImport(getDb(), c);
        if (imported) {
          // Reload so all React state rebuilds fresh against the restored data
          location.reload();
          return c; // unreachable; reload fires above
        }
      } catch (importErr) {
        console.error("[DB] Import via ATTACH failed:", importErr);
        // Non-fatal: app still works, just without the restored data
      }

      return c;
    }

    init()
      .then((c) => { setConn(c); setStatus("ready"); })
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
      await resetDatabase();
      location.reload();
    }

    async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importDatabase(file);
        location.reload();
      } catch (err) {
        console.error("Import failed:", err);
        alert("Import failed: " + String(err));
      }
      e.target.value = "";
    }

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-background)] p-6">
        <div className="max-w-md rounded-[var(--radius)] border border-[var(--color-danger)]/40 bg-[var(--color-surface)] p-6 text-center">
          <p className="mb-2 text-base font-semibold text-[var(--color-danger)]">Database failed to load</p>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">{error}</p>
          <p className="text-xs text-[var(--color-text-subtle)]">
            Make sure you're using Chrome or Edge for full OPFS support.
          </p>

          {opfsSupported && (
            <div className="mt-5 flex flex-col gap-3 border-t border-[var(--color-border)] pt-5">

              {/* Restore from backup */}
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 text-left">
                <p className="mb-1 text-xs font-semibold text-[var(--color-text)]">Restore from backup</p>
                <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                  Have a <code className="font-mono">.db</code> backup file? Load it here to recover your data.
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20">
                  Choose backup file…
                  <input type="file" accept=".db" onChange={handleImport} className="hidden" />
                </label>
              </div>

              {/* Reset — last resort */}
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/30 p-3 text-left">
                <p className="mb-1 text-xs font-semibold text-[var(--color-danger)]">Start fresh</p>
                <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                  No backup? Wipe the database and start over.
                  <span className="block font-medium text-[var(--color-danger)]/80">All data will be permanently deleted.</span>
                </p>
                <button
                  onClick={handleReset}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/20"
                >
                  Reset database
                </button>
              </div>

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
