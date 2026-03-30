import React, { useState } from "react";
import { Eye, EyeOff, Download, Upload } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@milly-maker/ui";
import { getDb } from "@/db/init.js";

export function SettingsPage() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropicApiKey") ?? "");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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
      const db = getDb();
      const buffer = await db.copyFileToBuffer("opfs://milly-maker.db");
      const blob = new Blob([buffer.buffer as ArrayBuffer], { type: "application/octet-stream" });
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

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      const db = getDb();
      await db.registerFileBuffer("opfs://milly-maker.db", new Uint8Array(buffer));
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
