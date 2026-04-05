import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { Debt, DebtLogEntry } from "../queries/debts.js";
import {
  getAllDebts,
  getAllDebtLog,
  insertDebt,
  updateDebt,
  deleteDebt,
  insertDebtPayment,
  insertDebtCharge,
} from "../queries/debts.js";

export function useDebts() {
  const { conn } = useDb();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtLog, setDebtLog] = useState<DebtLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const [data, log] = await Promise.all([getAllDebts(conn), getAllDebtLog(conn)]);
    setDebts(data);
    setDebtLog(log);
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

  const addCharge = useCallback(
    async (data: Parameters<typeof insertDebtCharge>[1]) => {
      if (!conn) return;
      await insertDebtCharge(conn, data);
      await refresh();
    },
    [conn, refresh]
  );

  const totalDebt = debts.reduce((s, d) => s + d.current_balance, 0);
  const totalMinPayment = debts.reduce((s, d) => s + d.minimum_payment, 0);

  return { debts, debtLog, loading, refresh, add, edit, remove, addPayment, addCharge, totalDebt, totalMinPayment };
}
