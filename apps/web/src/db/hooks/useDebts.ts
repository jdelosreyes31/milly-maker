import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { Debt } from "../queries/debts.js";
import {
  getAllDebts,
  insertDebt,
  updateDebt,
  deleteDebt,
  insertDebtPayment,
} from "../queries/debts.js";

export function useDebts() {
  const { conn } = useDb();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getAllDebts(conn);
    setDebts(data);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(
    async (data: Parameters<typeof insertDebt>[1]) => {
      if (!conn) return;
      await insertDebt(conn, data);
      await refresh();
    },
    [conn, refresh]
  );

  const edit = useCallback(
    async (id: string, data: Parameters<typeof updateDebt>[2]) => {
      if (!conn) return;
      await updateDebt(conn, id, data);
      await refresh();
    },
    [conn, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!conn) return;
      await deleteDebt(conn, id);
      await refresh();
    },
    [conn, refresh]
  );

  const addPayment = useCallback(
    async (data: Parameters<typeof insertDebtPayment>[1]) => {
      if (!conn) return;
      await insertDebtPayment(conn, data);
      await refresh();
    },
    [conn, refresh]
  );

  const totalDebt = debts.reduce((s, d) => s + d.current_balance, 0);
  const totalMinPayment = debts.reduce((s, d) => s + d.minimum_payment, 0);

  return { debts, loading, refresh, add, edit, remove, addPayment, totalDebt, totalMinPayment };
}
