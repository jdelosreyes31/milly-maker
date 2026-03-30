import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { Investment } from "../queries/investments.js";
import {
  getAllInvestments,
  insertInvestment,
  updateInvestment,
  deleteInvestment,
  upsertNetWorthSnapshot,
} from "../queries/investments.js";

export function useInvestments() {
  const { conn } = useDb();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const data = await getAllInvestments(conn);
    setInvestments(data);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(
    async (data: Parameters<typeof insertInvestment>[1]) => {
      if (!conn) return;
      await insertInvestment(conn, data);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const edit = useCallback(
    async (id: string, data: Parameters<typeof updateInvestment>[2]) => {
      if (!conn) return;
      await updateInvestment(conn, id, data);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!conn) return;
      await deleteInvestment(conn, id);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const totalValue = investments.reduce((s, i) => s + i.current_value, 0);
  const totalMonthlyContribution = investments.reduce((s, i) => s + i.monthly_contribution, 0);

  return { investments, loading, refresh, add, edit, remove, totalValue, totalMonthlyContribution };
}
