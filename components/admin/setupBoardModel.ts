import type { Dealer } from "../../types";
import {
  DEFAULT_SIGNATURE_LOOK,
  isSignatureLook,
  LOOK_DEFINITIONS,
} from "../../services/creativeSystem";
import {
  dealerSetupStatus,
  describeApprovalShort,
  type DealerSetupStatus,
  type SetupRowId,
} from "../../utils/dealerSetupStatus";

/**
 * Pure helpers for the system administrator's setup board. Every word here is
 * read from `utils/dealerSetupStatus.ts` (what a store has set up) and
 * `services/creativeSystem.ts` (what the creative system does), so the board
 * can never disagree with the manager's settings rail.
 */

/**
 * The creative fields (signature look, approval policy, disclosure, creative
 * system) travel together; `creative_system_v2` arriving as a boolean is the
 * signal that the dealer list reports them (see dealerSetupStatus).
 */
export const creativeFieldsReported = (dealer: Dealer): boolean =>
  typeof dealer.creative_system_v2 === "boolean";

/** The setup notes field is reported only by a server that stores it. */
export const setupNotesReported = (dealer: Dealer): boolean =>
  typeof dealer.setup_notes === "string";

const SHORT_HEADERS: Partial<Record<SetupRowId, string>> = {
  profile: "Profile",
  brand: "Brand",
  facebook: "Facebook",
  instagram: "Instagram",
  voice: "Voice",
  look: "Look",
};

export interface BoardColumn {
  id: SetupRowId;
  /** The model's label, used in accessible names ("Brand voice is missing"). */
  label: string;
  /** The short column header ("Voice"). */
  header: string;
}

/**
 * One column per counted row, in the model's order. The reference is a store
 * whose list reports every field, so the model itself says which rows count
 * when nothing is hidden; each loaded store adds any counted row of its own.
 * A store whose list does not report a column's field shows "not reported" in
 * that column instead of losing it.
 */
export const boardColumns = (statuses: readonly DealerSetupStatus[]): BoardColumn[] => {
  const reference = dealerSetupStatus({
    id: "",
    name: "",
    creative_system_v2: false,
    employee_disclosure_disabled: false,
  });
  const order = reference.rows.map((row) => row.id);
  const columns = new Map<SetupRowId, BoardColumn>();
  for (const status of [reference, ...statuses]) {
    for (const row of status.rows) {
      if (!row.counts || columns.has(row.id)) continue;
      columns.set(row.id, {
        id: row.id,
        label: row.label,
        header: SHORT_HEADERS[row.id] ?? row.label,
      });
    }
  }
  const rank = (id: SetupRowId) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return [...columns.values()].sort((a, b) => rank(a.id) - rank(b.id));
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The board's one-sentence count. A list that does not report the creative
 * fields cannot say how much is missing (the signature look is not counted),
 * so it says only how many dealerships there are.
 */
export const boardSummary = (dealers: readonly Dealer[]): string => {
  const count = dealers.length;
  if (count === 0) return "";
  const lead = `${plural(count, "dealership", "dealerships")}.`;
  if (!dealers.every(creativeFieldsReported)) return lead;
  const statuses = dealers.map(dealerSetupStatus);
  const missing = statuses.reduce((sum, status) => sum + status.missing.length, 0);
  const stores = statuses.filter((status) => status.missing.length > 0).length;
  if (missing === 0) {
    return count === 1
      ? `${lead} It is fully set up.`
      : `${lead} Every one is fully set up.`;
  }
  const items = `${plural(missing, "setup item", "setup items")} ${missing === 1 ? "is" : "are"} missing`;
  return count === 1
    ? `${lead} ${items}.`
    : `${lead} ${items} across ${stores} of them.`;
};

/**
 * The Approval column. When the list does not report the approval policy,
 * an "on" switch cannot be narrowed to a rule, so it reads only "On".
 */
export const approvalCell = (dealer: Dealer): { text: string; off: boolean } => {
  const on = dealer.requires_approval === true;
  if (on && !creativeFieldsReported(dealer)) return { text: "On", off: false };
  return { text: describeApprovalShort(on, dealer.approval_policy), off: !on };
};

/**
 * The store's Looks in words, under its sample photo. With the creative system
 * off, posts use the classic style list and no Look is applied
 * (services/creativeSystem.ts resolveCreative; services/storeDefaults.ts offers
 * the signature and second Look only when it is on), so the sentence says so.
 * With it on and no Look chosen, the house default (Showroom) is used.
 *
 * The second Look is compared with the Look posts resolve to, not the raw
 * saved one: storeDefaults offers [resolved, alternate] de-duplicated, so a
 * second Look equal to the house default is not a second Look on any post.
 */
export const looksInWords = (dealer: Dealer): string => {
  if (!creativeFieldsReported(dealer)) {
    return "This server's dealer list doesn't report the store's Looks yet.";
  }
  const signature = isSignatureLook(dealer.signature_look)
    ? dealer.signature_look
    : null;
  const resolved = signature ?? DEFAULT_SIGNATURE_LOOK;
  const second =
    isSignatureLook(dealer.alternate_look) && dealer.alternate_look !== resolved
      ? dealer.alternate_look
      : null;
  const parts: string[] = [
    signature
      ? `${LOOK_DEFINITIONS[signature].label} Look.`
      : "No signature Look chosen yet.",
  ];
  if (second) parts.push(`Second Look: ${LOOK_DEFINITIONS[second].label}.`);
  if (dealer.creative_system_v2 !== true) {
    parts.push("Posts use the classic styles while the creative system is off.");
  } else if (!signature) {
    parts.push("Posts use the Showroom Look until one is chosen.");
  }
  return parts.join(" ");
};

/**
 * The phone list's one line: "4 of 6 set up, 2 missing", or null when nothing
 * counted is missing.
 */
export const missingLine = (status: DealerSetupStatus): string | null =>
  status.missing.length
    ? `${status.ready} of ${status.total} set up, ${status.missing.length} missing`
    : null;
