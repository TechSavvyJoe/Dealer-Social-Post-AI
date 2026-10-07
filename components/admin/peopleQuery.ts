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
}

/**
 * The roster query, shared by the Admins and Users tabs and the setup board.
 * The board's "first active manager" lookup asks for exactly the page the
 * Admins tab shows for that store (no search, no filter, first page), so both
 * read and refresh one cache entry: deactivating a manager on the Admins tab
 * refetches the same page the board reads.
 */
export const peopleQueryKey = (params: PeopleQueryParams) =>
  [
    "people",
    params.role,
    params.dealerId || "all",
    params.search,
    params.codesToShare,
    params.cursor,
  ] as const;

export const fetchPeoplePage = (params: PeopleQueryParams): Promise<PeoplePage> =>
  listPeoplePage({
    includeInactive: true,
    role: params.role,
    dealerId: params.dealerId || undefined,
    q: params.search,
    codesToShare: params.codesToShare,
    cursor: params.cursor,
    limit: PEOPLE_PAGE_SIZE,
  });

/** The managers page the Admins tab shows for one store. */
export const storeManagersParams = (dealerId: string): PeopleQueryParams => ({
  role: "manager",
  dealerId,
  search: "",
  codesToShare: false,
  cursor: undefined,
});

/** The first manager on that page who can be opened as. */
export const firstActiveManager = (page: PeoplePage | undefined): Person | null =>
  page?.items.find((person) => person.role === "manager" && person.active) ?? null;
