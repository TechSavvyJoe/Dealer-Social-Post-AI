import {
  listPeoplePage,
  type PeoplePage,
  type Person,
  type PersonRole,
} from "../../services/salespeople";

/** One roster page on the hub's Admins and Users tabs. */
export const PEOPLE_PAGE_SIZE = 50;

export interface PeopleQueryParams {
  role: PersonRole;
  /** Empty means every dealership. */
  dealerId: string;
  search: string;
  codesToShare: boolean;
  cursor?: string;
  includeInactive?: boolean;
}

/** Roster pages and active-only setup-board lookups have distinct cache keys. */
export const peopleQueryKey = (params: PeopleQueryParams) =>
  [
    "people",
    params.role,
    params.dealerId || "all",
    params.search,
    params.codesToShare,
    params.cursor,
    params.includeInactive ?? true,
  ] as const;

export const fetchPeoplePage = (params: PeopleQueryParams): Promise<PeoplePage> =>
  listPeoplePage({
    includeInactive: params.includeInactive ?? true,
    role: params.role,
    dealerId: params.dealerId || undefined,
    q: params.search,
    codesToShare: params.codesToShare,
    cursor: params.cursor,
    limit: PEOPLE_PAGE_SIZE,
  });

/** Active managers for the setup board, excluding retired accounts server-side. */
export const storeManagersParams = (dealerId: string): PeopleQueryParams => ({
  role: "manager",
  dealerId,
  search: "",
  codesToShare: false,
  cursor: undefined,
  includeInactive: false,
});

/** The first manager on that page who can be opened as. */
export const firstActiveManager = (page: PeoplePage | undefined): Person | null =>
  page?.items.find((person) => person.role === "manager" && person.active) ?? null;
