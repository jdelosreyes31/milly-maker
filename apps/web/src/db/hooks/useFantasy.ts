import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import {
  getAllFantasyAccounts,
  insertFantasyAccount,
  updateFantasyAccount,
  deleteFantasyAccount,
  getFantasyBalanceSummary,
  getFantasyTransactions,
  insertFantasyTransaction,
  deleteFantasyTransaction,
  getFantasyFutures,
  insertFantasyFuture,
  updateFutureStatus,
  deleteFantasyFuture,
} from "../queries/fantasy.js";
import type {
  FantasyAccount,
  FantasyPlatformType,
  FantasyTxType,
  FutureStatus,
  FantasyTransaction,
  FantasyFuture,
  FantasyBalanceSummary,
} from "../queries/fantasy.js";

export type { FantasyAccount, FantasyPlatformType, FantasyTxType, FutureStatus, FantasyTransaction, FantasyFuture, FantasyBalanceSummary };

// ── Accounts ──────────────────────────────────────────────────────────────────

export function useFantasyAccounts() {
  const { conn } = useDb();
  const [accounts, setAccounts] = useState<FantasyAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getAllFantasyAccounts(conn);
    setAccounts(data);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void reload(); }, [reload]);

  const addAccount = useCallback(async (data: {
    name: string;
    platform_type: FantasyPlatformType;
    starting_balance: number;
    starting_date: string;
  }) => {
    if (!conn) return;
    await insertFantasyAccount(conn, data);
    await reload();
  }, [conn, reload]);

  const editAccount = useCallback(async (id: string, data: Partial<{
    name: string;
    platform_type: FantasyPlatformType;
    starting_balance: number;
    starting_date: string;
  }>) => {
    if (!conn) return;
    await updateFantasyAccount(conn, id, data);
    await reload();
  }, [conn, reload]);

  const removeAccount = useCallback(async (id: string) => {
    if (!conn) return;
    await deleteFantasyAccount(conn, id);
    await reload();
  }, [conn, reload]);

  return { accounts, loading, addAccount, editAccount, removeAccount, reload };
}

// ── Page data (transactions + futures + balance) ───────────────────────────────

export function useFantasyData(accountId: string) {
  const { conn } = useDb();
  const [transactions, setTransactions] = useState<FantasyTransaction[]>([]);
  const [futures, setFutures] = useState<FantasyFuture[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<FantasyBalanceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const [txs, futs, summary] = await Promise.all([
      getFantasyTransactions(conn, accountId),
      getFantasyFutures(conn, accountId),
      getFantasyBalanceSummary(conn),
    ]);
    setTransactions(txs);
    setFutures(futs);
    setBalanceSummary(summary);
    setLoading(false);
  }, [conn, accountId]);

  useEffect(() => { void reload(); }, [reload]);

  const currentBalance = accountId === "ALL"
    ? balanceSummary.reduce((s, a) => s + a.current_balance, 0)
    : (balanceSummary.find((a) => a.account_id === accountId)?.current_balance ?? 0);

  const openFutures = futures.filter((f) => f.status === "open");
  const settledFutures = futures.filter((f) => f.status !== "open");
  const totalOpenStake = openFutures.reduce((s, f) => s + f.stake, 0);

  // Transactions
  const addTransaction = useCallback(async (data: Parameters<typeof insertFantasyTransaction>[1]) => {
    if (!conn) return;
    await insertFantasyTransaction(conn, data);
    await reload();
  }, [conn, reload]);

  const removeTransaction = useCallback(async (id: string) => {
    if (!conn) return;
    await deleteFantasyTransaction(conn, id);
    await reload();
  }, [conn, reload]);

  // Futures
  const addFuture = useCallback(async (data: Parameters<typeof insertFantasyFuture>[1]) => {
    if (!conn) return;
    await insertFantasyFuture(conn, data);
    await reload();
  }, [conn, reload]);

  const settleFuture = useCallback(async (id: string, status: FutureStatus) => {
    if (!conn) return;
    await updateFutureStatus(conn, id, status);
    await reload();
  }, [conn, reload]);

  const removeFuture = useCallback(async (id: string) => {
    if (!conn) return;
    await deleteFantasyFuture(conn, id);
    await reload();
  }, [conn, reload]);

  return {
    transactions,
    futures,
    openFutures,
    settledFutures,
    balanceSummary,
    loading,
    currentBalance,
    totalOpenStake,
    addTransaction,
    removeTransaction,
    addFuture,
    settleFuture,
    removeFuture,
    reload,
  };
}
