import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import {
  getAllSavingsAccounts,
  insertSavingsAccount,
  updateSavingsAccount,
  deleteSavingsAccount,
  getSavingsTransactionsForAccount,
  getSavingsBalanceSummary,
  insertSavingsTransaction,
  deleteSavingsTransaction,
} from "../queries/savings.js";
import type {
  SavingsAccount,
  SavingsAccountType,
  SavingsTransactionWithBalance,
} from "../queries/savings.js";

export function useSavingsAccounts() {
  const { conn } = useDb();
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getAllSavingsAccounts(conn);
    setAccounts(data);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void reload(); }, [reload]);

  const addAccount = useCallback(async (data: {
    name: string;
    account_type: SavingsAccountType;
    starting_balance: number;
    starting_date: string;
    apr: number;
  }) => {
    if (!conn) return;
    await insertSavingsAccount(conn, data);
    await reload();
  }, [conn, reload]);

  const editAccount = useCallback(async (id: string, data: Partial<{
    name: string;
    account_type: SavingsAccountType;
    starting_balance: number;
    starting_date: string;
    apr: number;
  }>) => {
    if (!conn) return;
    await updateSavingsAccount(conn, id, data);
    await reload();
  }, [conn, reload]);

  const removeAccount = useCallback(async (id: string) => {
    if (!conn) return;
    await deleteSavingsAccount(conn, id);
    await reload();
  }, [conn, reload]);

  return { accounts, loading, addAccount, editAccount, removeAccount, reload };
}

export function useSavingsTransactions(accountId: string) {
  const { conn } = useDb();
  const [transactions, setTransactions] = useState<SavingsTransactionWithBalance[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<{
    account_id: string;
    account_name: string;
    account_type: SavingsAccountType;
    apr: number;
    current_balance: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const [txs, summary] = await Promise.all([
      getSavingsTransactionsForAccount(conn, accountId),
      getSavingsBalanceSummary(conn),
    ]);
    setTransactions(txs);
    setBalanceSummary(summary);
    setLoading(false);
  }, [conn, accountId]);

  useEffect(() => { void reload(); }, [reload]);

  const currentBalance = accountId === "ALL"
    ? balanceSummary.reduce((s, a) => s + a.current_balance, 0)
    : (balanceSummary.find((a) => a.account_id === accountId)?.current_balance ?? 0);

  const addTransaction = useCallback(async (data: {
    account_id: string;
    type: "deposit" | "withdrawal" | "interest";
    amount: number;
    description: string;
    transaction_date: string;
    notes?: string;
  }) => {
    if (!conn) return;
    await insertSavingsTransaction(conn, data);
    await reload();
  }, [conn, reload]);

  const removeTransaction = useCallback(async (id: string, transferPairId: string | null) => {
    if (!conn) return;
    await deleteSavingsTransaction(conn, id, transferPairId);
    await reload();
  }, [conn, reload]);

  return {
    transactions,
    balanceSummary,
    loading,
    currentBalance,
    addTransaction,
    removeTransaction,
    reload,
  };
}
