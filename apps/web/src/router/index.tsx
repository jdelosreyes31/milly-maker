import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { DbProvider } from "@/db/hooks/useDb.js";
import { AppShell } from "@/components/AppShell.js";
import { DashboardPage } from "@/features/dashboard/DashboardPage.js";
import { ExpensesPage } from "@/features/expenses/ExpensesPage.js";
import { DebtsPage } from "@/features/debts/DebtsPage.js";
import { InvestmentsPage } from "@/features/investments/InvestmentsPage.js";
import { ForecastPage } from "@/features/forecast/ForecastPage.js";
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
const expensesRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/expenses", component: ExpensesPage });
const debtsRoute     = createRoute({ getParentRoute: () => rootRoute, path: "/debts", component: DebtsPage });
const investmentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/investments", component: InvestmentsPage });
const forecastRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/forecast", component: ForecastPage });
const settingsRoute  = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  expensesRoute,
  debtsRoute,
  investmentsRoute,
  forecastRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
