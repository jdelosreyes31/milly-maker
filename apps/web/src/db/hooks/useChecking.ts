import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { CheckingAccount, TransactionWithBalance } from "../queries/checking.js";
import {
  getAllCheckingAccounts,
  getTransactionsForAccount,
  insertCheckingAccount,
  updateCheckingAccount,
  deleteCheckingAccount,
  insertTransaction,
  updateTransaction,
  deleteTransaction,
  getCheckingBalanceSummary,
} from "../queries/checking.js";

export function useCheckingAccounts() {
  const { conn } = useDb();
  const [accounts, setAccounts] = useState<CheckingAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getAllCheckingAccounts(conn);
    setAccounts(data);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addAccount = useCallback(
    async (data: Parameters<typeof insertCheckingAccount>[1]) => {
      if (!conn) return;
      await insertCheckingAccount(conn, data);
      await refresh();
    },
    [conn, refresh]
  );

  const editAccount = useCallback(
    async (id: string, data: Parameters<typeof updateCheckingAccount>[2]) => {
      if (!conn) return;
      await updateCheckingAccount(conn, id, data);
      await refresh();
    },
    [conn, refresh]
  );

  const removeAccount = useCallback(
    async (id: string) => {
      if (!conn) return;
      await deleteCheckingAccount(conn, id);
      await refresh();
    },
    [conn, refresh]
  );

  return { accounts, loading, refresh, addAccount, editAccount, removeAccount };
}

export function useCheckingTransactions(selectedAccountId: string) {
  const { conn } = useDb();
  const [transactions, setTransactions] = useState<TransactionWithBalance[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<
    { account_id: string; account_name: string; current_balance: number }[]
  >([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn || !selectedAccountId) return;
    setLoading(true);
    const [txns, summary] = await Promise.all([
      getTransactionsForAccount(conn, selectedAccountId),
      getCheckingBalanceSummary(conn),
    ]);
    setTransactions(txns);
    setBalanceSummary(summary);
    setLoading(false);
  }, [conn, selectedAccountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addTransaction = useCallback(
    async (data: Parameters<typeof insertTransaction>[1]): Promise<string | undefined> => {
      if (!conn) return;
      const id = await insertTransaction(conn, data);
      await refresh();
      return id;
    },
    [conn, refresh]
  );

  const editTransaction = useCallback(
    async (id: string, data: Parameters<typeof updateTransaction>[2]) => {
      if (!conn) return;
      await updateTransaction(conn, id, data);
      await refresh();
    },
    [conn, refresh]
  );

  const removeTransaction = useCallback(
    async (id: string, transferPairId: string | null) => {
      if (!conn) return;
      await deleteTransaction(conn, id, transferPairId);
      await refresh();
    },
    [conn, refresh]
  );

  // Compute current balance for selected account(s)
  const currentBalance =
    selectedAccountId === "ALL"
      ? balanceSummary.reduce((s, a) => s + a.current_balance, 0)
      : balanceSummary.find((a) => a.account_id === selectedAccountId)?.current_balance ?? 0;

  return { transactions, balanceSummary, loading, refresh, addTransaction, editTransaction, removeTransaction, currentBalance };
}
