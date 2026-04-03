import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { DbProvider } from "@/db/hooks/useDb.js";
import { AppShell } from "@/components/AppShell.js";
import { DashboardPage } from "@/features/dashboard/DashboardPage.js";
import { CheckingPage } from "@/features/checking/CheckingPage.js";
import { DebtsPage } from "@/features/debts/DebtsPage.js";
import { InvestmentsPage } from "@/features/investments/InvestmentsPage.js";
import { ForecastPage } from "@/features/forecast/ForecastPage.js";
import { SavingsPage } from "@/features/savings/SavingsPage.js";
import { FantasyPage } from "@/features/fantasy/FantasyPage.js";
import { PlanningPage } from "@/features/planning/PlanningPage.js";
import { ReportsPage } from "@/features/reports/ReportsPage.js";
import { SubscriptionsPage } from "@/features/subscriptions/SubscriptionsPage.js";
import { SettingsPage } from "@/features/settings/SettingsPage.js";

const rootRoute = createRootRoute({
  component: () => (
    <DbProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </DbProvider>
  ),
});

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const checkingRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/checking", component: CheckingPage });
const debtsRoute     = createRoute({ getParentRoute: () => rootRoute, path: "/debts", component: DebtsPage });
const investmentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/investments", component: InvestmentsPage });
const forecastRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/forecast", component: ForecastPage });
const savingsRoute   = createRoute({ getParentRoute: () => rootRoute, path: "/savings",  component: SavingsPage });
const fantasyRoute   = createRoute({ getParentRoute: () => rootRoute, path: "/fantasy",  component: FantasyPage });
const planningRoute       = createRoute({ getParentRoute: () => rootRoute, path: "/planning",       component: PlanningPage });
const subscriptionsRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/subscriptions",  component: SubscriptionsPage });
const reportsRoute        = createRoute({ getParentRoute: () => rootRoute, path: "/reports",        component: ReportsPage });
const settingsRoute       = createRoute({ getParentRoute: () => rootRoute, path: "/settings",       component: SettingsPage });

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  checkingRoute,
  savingsRoute,
  subscriptionsRoute,
  fantasyRoute,
  debtsRoute,
  investmentsRoute,
  forecastRoute,
  planningRoute,
  reportsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
