import { useState, useEffect, useCallback } from "react";
import { useDb } from "./useDb.js";
import {
  getAllSubscriptions,
  getCancelledSubscriptions,
  insertSubscription,
  updateSubscription,
  cancelSubscription,
  restoreSubscription,
  hardDeleteSubscription,
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
  const [cancelledSubscriptions, setCancelledSubscriptions] = useState<Subscription[]>([]);

  const reload = useCallback(async () => {
    if (!conn) return;
    const [active, cancelled] = await Promise.all([
      getAllSubscriptions(conn),
      getCancelledSubscriptions(conn),
    ]);
    setSubscriptions(active);
    setCancelledSubscriptions(cancelled);
  }, [conn]);

  useEffect(() => { void reload(); }, [reload]);

  const totalMonthly = subscriptions.reduce(
    (sum, s) => sum + toMonthly(s.amount, s.billing_cycle),
    0
  );

  async function addSubscription(data: Parameters<typeof insertSubscription>[1]) {
    if (!conn) return;
    await insertSubscription(conn, data);
    await reload();
  }

  async function editSubscription(id: string, data: Parameters<typeof updateSubscription>[2]) {
    if (!conn) return;
    await updateSubscription(conn, id, data);
    await reload();
  }

  async function removeSubscription(id: string) {
    if (!conn) return;
    await cancelSubscription(conn, id);
    await reload();
  }

  async function restoreSubscriptionById(id: string) {
    if (!conn) return;
    await restoreSubscription(conn, id);
    await reload();
  }

  async function permanentlyDelete(id: string) {
    if (!conn) return;
    await hardDeleteSubscription(conn, id);
    await reload();
  }

  return {
    subscriptions,
    cancelledSubscriptions,
    totalMonthly,
    addSubscription,
    editSubscription,
    removeSubscription,
    restoreSubscription: restoreSubscriptionById,
    permanentlyDelete,
    reload,
  };
}
