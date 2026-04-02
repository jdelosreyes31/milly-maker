import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import {
  getAllSubscriptions,
  insertSubscription,
  updateSubscription,
  deleteSubscription,
  toMonthly,
  type Subscription,
  type BillingCycle,
  type SubscriptionSourceType,
} from "../queries/subscriptions.js";

export type { Subscription, BillingCycle, SubscriptionSourceType };
export { toMonthly };

export function useSubscriptions() {
  const { conn } = useDb();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  const reload = useCallback(async () => {
    if (!conn) return;
    setSubscriptions(await getAllSubscriptions(conn));
  }, [conn]);

  useEffect(() => { void reload(); }, [reload]);

  const totalMonthly = subscriptions.reduce(
    (sum, s) => sum + toMonthly(s.amount, s.billing_cycle),
    0
  );

  async function addSubscription(
    data: Parameters<typeof insertSubscription>[1]
  ) {
    if (!conn) return;
    await insertSubscription(conn, data);
    await reload();
  }

  async function editSubscription(
    id: string,
    data: Parameters<typeof updateSubscription>[2]
  ) {
    if (!conn) return;
    await updateSubscription(conn, id, data);
    await reload();
  }

  async function removeSubscription(id: string) {
    if (!conn) return;
    await deleteSubscription(conn, id);
    await reload();
  }

  return {
    subscriptions,
    totalMonthly,
    addSubscription,
    editSubscription,
    removeSubscription,
    reload,
  };
}
