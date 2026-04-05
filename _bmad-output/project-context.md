---
project_name: 'milly-maker'
user_name: 'Jeff'
date: '2026-04-05'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Monorepo
- Package manager: pnpm 10.33.0 (workspace:* for internal packages)
- Build orchestration: Turborepo ^2.5.3

### App: @milly-maker/web (apps/web)
- React 19.1.0
- TypeScript 5.8.3 / 5.9.3
- Vite 6.3.5 + @vitejs/plugin-react 4.5.2
- Tailwind CSS 4.1.7 (via @tailwindcss/vite plugin — NOT PostCSS)
- TanStack Router 1.114.22
- Zustand 5.0.5
- DuckDB-WASM 1.29.0
- Recharts 2.15.3
- Lucide React 0.511.0
- @anthropic-ai/sdk 0.52.0

### Workspace Packages
- @milly-maker/finance-engine — pure TS financial calculation library
- @milly-maker/ui — shared React component library
- @milly-maker/typescript-config — shared tsconfig base

---

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript
- Strict mode fully enabled: `strict`, `strictNullChecks`, `noUncheckedIndexedAccess` — no bypassing with `!` non-null assertions unless unavoidable
- All internal imports must use `.js` extension even for `.ts` source files (ESM interop requirement)
  - ✅ `import { nanoid } from "../../lib/nanoid.js"`
  - ❌ `import { nanoid } from "../../lib/nanoid"`
- Path alias `@/` maps to `apps/web/src/` — use for all non-relative imports within the app
- `moduleDetection: "force"` — every file is treated as a module; no implicit globals
- When casting DuckDB query results: use `result.toArray() as unknown as T[]` (double cast required)
- Avoid `@ts-ignore`; use `@ts-expect-error` with a comment when suppression is truly needed

### Framework-Specific Rules

#### React
- React 19 — use the new JSX transform; no need to `import React` in every file unless using React APIs directly
- Wrap `void` around fire-and-forget async calls in event handlers and `useEffect` bodies: `void someAsyncFn()`
- All pages live in `apps/web/src/features/<feature>/<FeatureName>Page.tsx`
- Routes are defined centrally in `apps/web/src/router/index.tsx` — add new routes there, not via file-based routing

#### TanStack Router
- Router is code-based (not file-based) — register all new routes in `router/index.tsx` and add to `routeTree`
- Declare the router type in the `Register` module augmentation at the bottom of `router/index.tsx`

#### Zustand
- Global UI state lives in `apps/web/src/store/ui.store.ts`
- Feature-specific data state is managed locally in hooks (`db/hooks/`), not in Zustand
- Do NOT put DuckDB connection or query results in Zustand

#### DuckDB-WASM Data Layer (Critical)
- **Query layer** (`db/queries/*.ts`): raw SQL functions that accept `AsyncDuckDBConnection` as first arg, return typed results
- **Hook layer** (`db/hooks/use*.ts`): React wrappers that call `useDb()` for connection, manage local state with `useState`, expose `refresh` + CRUD methods
- Always call `refresh()` after mutating operations (insert/update/delete) — there is no reactive subscription
- SQL strings use a local `esc()` helper (`s.replace(/'/g, "''")`) for string escaping — always escape user-provided strings through it
- Date formatting in SQL: use DuckDB's `strftime(column, '%Y-%m')` syntax (not `strftime('%Y-%m', column)` like SQLite)
- IDs are generated with the local `nanoid()` from `apps/web/src/lib/nanoid.ts` — never use `crypto.randomUUID()` or an npm nanoid

#### CSS / Tailwind
- Use CSS custom properties for all colors and radii: `var(--color-background)`, `var(--color-surface)`, `var(--color-text)`, `var(--color-text-muted)`, `var(--color-border)`, `var(--color-primary)`, `var(--color-danger)`, `var(--color-warning)`, `var(--radius)`, `var(--radius-sm)`
- Do NOT use raw Tailwind color classes (e.g., `bg-blue-500`) in feature components — always use the CSS variable tokens
- Tailwind 4 is configured via the Vite plugin (`@tailwindcss/vite`), not PostCSS — no `tailwind.config.js`

### Testing Rules

- Tests exist only in `packages/finance-engine/src/__tests__/` — no tests in `apps/web` yet
- Test files follow the pattern `<domain>.test.ts` (e.g., `debt.test.ts`, `investments.test.ts`, `budget.test.ts`)
- finance-engine is pure TypeScript with no DOM/browser dependencies — tests can run in Node without mocking DuckDB
- When adding tests to finance-engine, place them in `packages/finance-engine/src/__tests__/`
- Do NOT attempt to unit test DuckDB query functions directly — they require a live AsyncDuckDBConnection (browser WASM environment)

### Code Quality & Style Rules

#### Formatting
- Prettier 3.5.3 is configured at the monorepo root — all files formatted on save
- No ESLint config found in the project root or app — do not add ESLint rules without confirming setup first

#### File & Folder Naming
- Feature pages: `PascalCase` (e.g., `DashboardPage.tsx`, `FantasyPage.tsx`)
- Hooks: `camelCase` prefixed with `use` (e.g., `useExpenses.ts`, `useDb.tsx`)
- Query files: `camelCase` domain name (e.g., `expenses.ts`, `checking.ts`)
- SQL migrations: `NNN_snake_case_description.sql` (e.g., `014_bet_session_open.sql`) — zero-padded 3-digit number
- Components in `@milly-maker/ui`: `PascalCase` component names, lowercase filenames (e.g., `card.tsx`)

#### Component Patterns
- UI primitives live in `packages/ui/src/components/` — use `cn()` from `packages/ui/src/lib/utils.ts` for className merging
- Feature components are self-contained in `apps/web/src/features/<feature>/`
- No barrel `index.ts` re-exports within feature folders — import directly from the file
- `packages/ui/src/index.ts` is the single public export for the UI package

#### No Comments Rule
- Do not add JSDoc or inline comments to code unless the logic is genuinely non-obvious
- Existing code has minimal comments by design

### Development Workflow Rules

#### Monorepo Commands (run from root)
- `pnpm dev` — start all apps via Turborepo
- `pnpm build` — build all packages and apps
- `pnpm type-check` — run `tsc --noEmit` across all packages
- `pnpm lint` — lint all packages
- `pnpm clean` — remove all build artifacts and node_modules

#### Adding a New Feature
1. Create query functions in `apps/web/src/db/queries/<feature>.ts`
2. Create a hook in `apps/web/src/db/hooks/use<Feature>.ts`
3. Create the page component in `apps/web/src/features/<feature>/<Feature>Page.tsx`
4. Register the route in `apps/web/src/router/index.tsx`
5. Add nav link in `apps/web/src/components/AppShell.tsx`

#### Adding a New Database Table/Column
1. Create a new migration file: `apps/web/src/db/migrations/NNN_description.sql`
2. Import and register it in `apps/web/src/db/migrations/runner.ts` — append to the `MIGRATIONS` array
3. Migrations are append-only — never edit an existing migration file

### Critical Don't-Miss Rules

#### DuckDB-WASM Gotchas
- DuckDB-WASM **must not** be pre-bundled by esbuild — it's excluded in `vite.config.ts` via `optimizeDeps.exclude`; do not remove this
- The app **requires** COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) for SharedArrayBuffer — the `coopCoepPlugin` in `vite.config.ts` provides these in dev; production deployment must also set them
- Web Workers must use `format: "es"` (set in `vite.config.ts` `worker.format`) — do not change this
- OPFS persistence only works in Chrome/Edge — the app degrades gracefully to `:memory:` in other browsers; do not assume OPFS is always available
- Never import `@duckdb/duckdb-wasm` WASM/worker assets as anything other than `?url` — Vite handles them specially

#### SQL Patterns
- Always use the `esc()` helper for any user-supplied string in SQL — it's defined locally per query file
- Cast numeric aggregates explicitly: `SUM(amount)::DOUBLE` — DuckDB may return non-JS-numeric types otherwise
- `result.toArray()` returns Apache Arrow records, not plain JS objects — always cast: `result.toArray() as unknown as T[]`

#### Migration Rules
- Never modify an existing `.sql` migration file — it may already be applied to users' OPFS databases
- Always increment the migration number sequentially; gaps will cause confusion
- The `__migrations` table is bootstrapped by `runner.ts` before any migration runs — do not create it in migration 001 without the `IF NOT EXISTS` guard

#### Import Anti-Patterns
- ❌ Do not import from `@duckdb/duckdb-wasm` sub-paths not already used — the bundle is fragile
- ❌ Do not use `react-router-dom` — this project uses TanStack Router exclusively
- ❌ Do not install `nanoid` from npm — the project uses a local `nanoid()` implementation in `lib/nanoid.ts`
- ❌ Do not add new Zustand stores for feature data — keep feature state local in hooks

#### Security
- The `esc()` helper is intentionally minimal (single-quote escaping only) — it is sufficient for DuckDB's use case but is not a general-purpose SQL sanitizer; never use it for external/user-facing APIs

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-04-05
