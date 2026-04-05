import React, { useState } from "react";
import { Eye, EyeOff, Download, Upload, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@milly-maker/ui";
import { exportDatabase, importDatabase, resetDatabase } from "@/db/init.js";
import { useDb } from "@/db/hooks/useDb.js";
import { seedDatabase } from "@/db/seed.js";

export function SettingsPage() {
  const { conn } = useDb();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropicApiKey") ?? "");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  function handleSaveKey() {
    if (apiKey.trim()) {
      localStorage.setItem("anthropicApiKey", apiKey.trim());
    } else {
      localStorage.removeItem("anthropicApiKey");
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await exportDatabase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `milly-maker-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleSeed() {
    if (!conn) return;
    setSeeding(true);
    try {
      await seedDatabase(conn);
      setSeedDone(true);
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error("Seed failed:", err);
      setSeeding(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await resetDatabase();
      localStorage.removeItem("planningSettings");
      window.location.reload();
    } catch (err) {
      console.error("Reset failed:", err);
      setResetting(false);
      setResetConfirm(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      await importDatabase(file);
      window.location.reload();
    } catch (err) {
      setImportError("Import failed: " + String(err));
    }
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle>Anthropic API Key</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Required to use the Claude financial assistant. Your key is stored only in your browser's local storage and never sent anywhere except the Anthropic API.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 pr-10 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <Button size="sm" onClick={handleSaveKey} variant={saved ? "success" : "default"}>
              {saved ? "Saved!" : "Save"}
            </Button>
          </div>
          {apiKey && (
            <p className="text-xs text-[var(--color-success)]">
              ✓ API key is set
            </p>
          )}
        </CardContent>
      </Card>

      {/* Data management */}
      <Card>
        <CardHeader><CardTitle>Data Backup</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Your data lives in your browser's local storage (OPFS). Export a backup regularly — especially before clearing browser data.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> {exporting ? "Exporting…" : "Export .db backup"}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-raised)]">
              <Upload size={14} /> Import .db file
              <input type="file" accept=".db" onChange={handleImport} className="hidden" />
            </label>
          </div>
          {importError && (
            <p className="text-xs text-[var(--color-danger)]">{importError}</p>
          )}
          <p className="text-xs text-[var(--color-text-subtle)]">
            ⚠ Importing will overwrite all current data and reload the page.
          </p>
        </CardContent>
      </Card>

      {/* Demo data */}
      <Card>
        <CardHeader><CardTitle>Demo Data</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Populate the app with realistic sample data — checking, savings, subscriptions, debts, investments, and fantasy accounts — so you can explore all the tabs before entering your own numbers.
          </p>
          <ul className="text-xs text-[var(--color-text-subtle)] list-disc list-inside space-y-1">
            <li>6 months of paycheck + spending history in Checking</li>
            <li>Marcus HYSA with monthly deposits &amp; interest</li>
            <li>7 subscriptions (Netflix, Spotify, gym, etc.)</li>
            <li>Credit card + student loan debts</li>
            <li>401(k), Roth IRA, and brokerage investments</li>
            <li>DraftKings, FanDuel DFS, and a fantasy league season</li>
          </ul>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSeed()}
              disabled={seeding || seedDone}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors"
            >
              <Sparkles size={14} />
              {seedDone ? "Done — reloading…" : seeding ? "Generating…" : "Generate Seed Data"}
            </button>
          </div>
          <p className="text-xs text-[var(--color-danger)]/70">
            ⚠ This adds data on top of whatever already exists. Best used on a fresh database.
          </p>
        </CardContent>
      </Card>

      {/* Reset data */}
      <Card>
        <CardHeader><CardTitle>Reset Data</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Wipe all data and start fresh. This deletes the local database file and cannot be undone.
          </p>
          {!resetConfirm ? (
            <button
              onClick={() => setResetConfirm(true)}
              className="flex w-fit items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 px-4 py-2 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/8 transition-colors"
            >
              <Trash2 size={14} /> Reset all data…
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-[var(--color-danger)]">
                Are you sure? This will permanently delete all your transactions, accounts, and settings.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Trash2 size={14} />
                  {resetting ? "Resetting…" : "Yes, delete everything"}
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  disabled={resetting}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader><CardTitle>About</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--color-text-muted)]">
            Milly Maker is a local-only personal finance dashboard. All data is stored in your browser using DuckDB-WASM. No data is ever sent to any server (except Claude API calls when you use the assistant).
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Use Chrome or Edge for best experience (OPFS persistence).</p>
        </CardContent>
      </Card>
    </div>
  );
}
