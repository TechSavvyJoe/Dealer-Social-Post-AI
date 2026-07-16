# Super Admin Hub Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Personal 4-digit codes for managers/users, super-admin impersonation, Dealers/Admins/Users hub, and hours picker — seamless front-to-back.

**Architecture:** Keep `salespeople` collection with `role` field; login resolves unique 4-digit pins; sessions support impersonation link; AdminDashboard tabs filter people by dealer.

**Tech Stack:** PocketBase 0.22 hooks, React 19 + Vite, Zustand, TanStack Query, Vitest.

## File map

| File | Responsibility |
|---|---|
| `pb_migrations/1750400000_people_roles_impersonation.js` | role on salespeople; session person/impersonation fields; relax dealers.code |
| `pb_hooks/helpers.js` | createSession options, pin helpers, person lookup |
| `pb_hooks/main.pb.js` | login by pin, people CRUD, impersonate/exit, dealer create without codes |
| `utils/hoursFormat.ts` | parse/serialize business hours |
| `components/HoursPicker.tsx` | day/time UI |
| `services/salespeople.ts` | role + dealer query + impersonate client |
| `stores/appStore.ts` | person + impersonation state, applySession helper |
| `components/LoginScreen.tsx` | unified 4-digit personal code entry |
| `components/AdminDashboard.tsx` | Dealers / Admins / Users hub |
| `components/ImpersonationBanner.tsx` | exit impersonation chrome |
| `components/DealerAdminDashboard.tsx` | hours picker; team = salespeople only |
| `App.tsx` / `Header.tsx` | banner wiring |
| `types.ts` | PersonRole, session payload fields |

## Tasks

### Task 1: Migration
- [ ] Add role, session fields, optional dealer code

### Task 2: Backend helpers + routes
- [ ] Pin login, people API, impersonate, dealer create

### Task 3: Hours util + component
- [ ] Format helpers + HoursPicker

### Task 4: Client session + login
- [ ] appStore + LoginScreen + services

### Task 5: Admin hub UI
- [ ] Full AdminDashboard restructure

### Task 6: Dealer admin polish
- [ ] Hours + team role constraints

### Task 7: Verify
- [ ] typecheck + tests

---

Execute inline in one session with professional UI consistency.
