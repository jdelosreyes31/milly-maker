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
  getFantasySeasons,
  insertFantasySeason,
  updateSeasonStatus,
  deleteFantasySeason,
} from "../queries/fantasy.js";
import type {
  FantasyAccount,
  FantasyPlatformType,
  FantasyTxType,
  FutureStatus,
  SeasonStatus,
  FantasyTransaction,
  FantasyFuture,
  FantasySeason,
  FantasyBalanceSummary,
} from "../queries/fantasy.js";

export type {
  FantasyAccount, FantasyPlatformType, FantasyTxType,
  FutureStatus, SeasonStatus,
  FantasyTransaction, FantasyFuture, FantasySeason, FantasyBalanceSummary,
};

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

  const addAccount = useCallback(async (data: Parameters<typeof insertFantasyAccount>[1]) => {
    if (!conn) return;
    await insertFantasyAccount(conn, data);
    await reload();
  }, [conn, reload]);

  const editAccount = useCallback(async (id: string, data: Parameters<typeof updateFantasyAccount>[2]) => {
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

// ── Page data ──────────────────────────────────────────────────────────────────

export function useFantasyData(accountId: string) {
  const { conn } = useDb();
  const [transactions, setTransactions] = useState<FantasyTransaction[]>([]);
  const [futures, setFutures] = useState<FantasyFuture[]>([]);
  const [seasons, setSeasons] = useState<FantasySeason[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<FantasyBalanceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const [txs, futs, seas, summary] = await Promise.all([
      getFantasyTransactions(conn, accountId),
      getFantasyFutures(conn, accountId),
      getFantasySeasons(conn, accountId),
      getFantasyBalanceSummary(conn),
    ]);
    setTransactions(txs);
    setFutures(futs);
    setSeasons(seas);
    setBalanceSummary(summary);
    setLoading(false);
  }, [conn, accountId]);

  useEffect(() => { void reload(); }, [reload]);

  // Combined balance excludes fantasy_league accounts (buy-ins are sunk costs, not tracked balance)
  const currentBalance = accountId === "ALL"
    ? balanceSummary
        .filter((a) => a.platform_type !== "fantasy_league")
        .reduce((s, a) => s + a.current_balance, 0)
    : (balanceSummary.find((a) => a.account_id === accountId)?.current_balance ?? 0);

  const openFutures = futures.filter((f) => f.status === "open");
  const settledFutures = futures.filter((f) => f.status !== "open");
  const totalOpenStake = openFutures.reduce((s, f) => s + f.stake, 0);

  const activeSeasons = seasons.filter((s) => s.status === "active");
  const settledSeasons = seasons.filter((s) => s.status !== "active");

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

  // Seasons
  const addSeason = useCallback(async (data: Parameters<typeof insertFantasySeason>[1]) => {
    if (!conn) return;
    await insertFantasySeason(conn, data);
    await reload();
  }, [conn, reload]);

  const settleSeason = useCallback(async (id: string, status: SeasonStatus, placement?: string) => {
    if (!conn) return;
    await updateSeasonStatus(conn, id, status, placement);
    await reload();
  }, [conn, reload]);

  const removeSeason = useCallback(async (id: string) => {
    if (!conn) return;
    await deleteFantasySeason(conn, id);
    await reload();
  }, [conn, reload]);

  return {
    transactions, futures, seasons,
    openFutures, settledFutures,
    activeSeasons, settledSeasons,
    balanceSummary,
    loading,
    currentBalance,
    totalOpenStake,
    addTransaction, removeTransaction,
    addFuture, settleFuture, removeFuture,
    addSeason, settleSeason, removeSeason,
    reload,
  };
}
