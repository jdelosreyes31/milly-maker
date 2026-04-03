import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import type { Investment, InvestmentHolding, InvestmentContribution } from "../queries/investments.js";
import {
  getAllInvestments,
  getAllHoldings,
  getContributions,
  insertInvestment,
  updateInvestment,
  deleteInvestment,
  upsertHolding,
  deleteHolding,
  insertContribution,
  deleteContribution,
  upsertNetWorthSnapshot,
} from "../queries/investments.js";

export function useInvestments() {
  const { conn } = useDb();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  const [contributions, setContributions] = useState<InvestmentContribution[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    const [invs, holds, contribs] = await Promise.all([
      getAllInvestments(conn),
      getAllHoldings(conn),
      getContributions(conn),
    ]);
    setInvestments(invs);
    setHoldings(holds);
    setContributions(contribs);
    setLoading(false);
  }, [conn]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Holdings grouped by investment id
  const holdingsByAccount = useCallback(
    (investmentId: string) => holdings.filter((h) => h.investment_id === investmentId),
    [holdings]
  );

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

  const addOrEditHolding = useCallback(
    async (data: Parameters<typeof upsertHolding>[1]) => {
      if (!conn) return;
      await upsertHolding(conn, data);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const removeHolding = useCallback(
    async (id: string, investmentId: string) => {
      if (!conn) return;
      await deleteHolding(conn, id, investmentId);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const addContribution = useCallback(
    async (data: Parameters<typeof insertContribution>[1]) => {
      if (!conn) return;
      await insertContribution(conn, data);
      await upsertNetWorthSnapshot(conn);
      await refresh();
    },
    [conn, refresh]
  );

  const removeContribution = useCallback(
    async (id: string) => {
      if (!conn) return;
      await deleteContribution(conn, id);
      await refresh();
    },
    [conn, refresh]
  );

  const totalValue = investments.reduce((s, i) => s + i.current_value, 0);
  const totalMonthlyContribution = investments.reduce((s, i) => s + i.monthly_contribution, 0);
  const totalHoldings = holdings.length;

  return {
    investments, holdings, contributions, loading, refresh,
    holdingsByAccount,
    add, edit, remove,
    addOrEditHolding, removeHolding,
    addContribution, removeContribution,
    totalValue, totalMonthlyContribution, totalHoldings,
  };
}
