import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { ExpenseWithCategory } from "../queries/expenses.js";
import {
  getExpensesByMonth,
  insertExpense,
  updateExpense,
  deleteExpense,
} from "../queries/expenses.js";

export function useExpenses(year: number, month: number) {
  const { conn } = useDb();
  const [expenses, setExpenses] = useState<ExpenseWithCategory[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getExpensesByMonth(conn, year, month);
    setExpenses(data);
    setLoading(false);
  }, [conn, year, month]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(
    async (data: Parameters<typeof insertExpense>[1]) => {
      if (!conn) return;
      await insertExpense(conn, data);
      await refresh();
    },
    [conn, refresh]
  );

  const edit = useCallback(
    async (id: string, data: Parameters<typeof updateExpense>[2]) => {
      if (!conn) return;
      await updateExpense(conn, id, data);
      await refresh();
    },
    [conn, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!conn) return;
      await deleteExpense(conn, id);
      await refresh();
    },
    [conn, refresh]
  );

  return { expenses, loading, refresh, add, edit, remove };
}
