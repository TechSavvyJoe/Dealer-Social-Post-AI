import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPocketBaseModule } from "../test/loadPocketBaseModule";

const module = {
  exports: {} as {
    normalizeVehicle: (value: unknown) => Record<string, unknown> | null;
    stateAllowsDelivery: (state: string, policy: string) => boolean;
    storageHasRoom: (df: string, du: string, incoming: number) => boolean;
    owner: (context: unknown, record: unknown) => boolean;
  },
};
const storageModule = { exports: {} };
new Function("module", readFileSync("pb_hooks/mediaStorage.js", "utf8"))(storageModule);
new Function(
  "module",
  "require",
  "__hooks",
  readFileSync("pb_hooks/vehicleSpins.js", "utf8"),
)(module, () => storageModule.exports, "/hooks");
const { normalizeVehicle, stateAllowsDelivery, owner, storageHasRoom } = module.exports;
const vehicle = {
  title: "2024 Test Vehicle",
  vin: "",
  stock: "A123",
  mileage: "31,234",
  highlights: ["AWD"],
  caption: "See the vehicle. #Test",
};

describe("vehicle spin server boundary", () => {
  it("keeps verified facts and ignores caller ownership, policy and tokens", () => {
    expect(
      normalizeVehicle({
        ...vehicle,
        dealer: "attacker",
        state: "approved",
        linkToken: "chosen",
      }),
    ).toEqual(vehicle);
  });
  it.each([
    { title: "" },
    { title: "x".repeat(121) },
    { mileage: "low miles" },
    { highlights: ["a", "b", "c", "d", "e"] },
    { highlights: ["x".repeat(81)] },
    { vin: "IOQ12345678901234" },
    { caption: "hidden\u0000text" },
    { stock: "stock\nnew line" },
    { highlights: [""] },
  ])("rejects malformed metadata %s", (override) => {
    expect(normalizeVehicle({ ...vehicle, ...override })).toBeNull();
  });
  it("normalizes a VIN and caption line endings", () => {
    expect(
      normalizeVehicle({ ...vehicle, vin: "1hgcm82633a004352", caption: "one\r\ntwo" }),
    ).toMatchObject({ vin: "1HGCM82633A004352", caption: "one\ntwo" });
  });
  it("fails closed for every unapproved or unknown state", () => {
    for (const state of ["uploading", "pending", "rejected", "", "shared", "invalid"])
      for (const policy of ["n_a", "pending"])
        expect(stateAllowsDelivery(state, policy)).toBe(false);
    expect(stateAllowsDelivery("n_a", "pending")).toBe(false);
    expect(stateAllowsDelivery("n_a", "n_a")).toBe(true);
    expect(stateAllowsDelivery("approved", "pending")).toBe(true);
  });
  it("never grants cross-dealer access even to a manager", () => {
    const record = {
      getString: (key: string) =>
        ({ dealer: "dealer-a", person: "person-a" })[key as "dealer" | "person"],
    };
    expect(
      owner(
        {
          dealer: { id: "dealer-b" },
          person: { id: "person-a" },
          role: "dealer_admin",
        },
        record,
      ),
    ).toBe(false);
    expect(
      owner(
        { dealer: { id: "dealer-a" }, person: { id: "person-b" }, role: "salesperson" },
        record,
      ),
    ).toBe(false);
    expect(
      owner(
        { dealer: { id: "dealer-a" }, person: { id: "person-a" }, role: "salesperson" },
        record,
      ),
    ).toBe(true);
    expect(
      owner(
        {
          dealer: { id: "dealer-a" },
          person: { id: "person-b" },
          role: "dealer_admin",
        },
        record,
      ),
    ).toBe(true);
  });
  it("reserves room for backups and rejects unknown or exhausted disk capacity", () => {
    const df =
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda 1048576 102400 946176 10% /pb/pb_data";
    expect(storageHasRoom(df, "102400 /pb/pb_data", 24000000)).toBe(true);
    expect(storageHasRoom(df, "900000 /pb/pb_data", 24000000)).toBe(false);
    expect(storageHasRoom("unavailable", "0 /pb/pb_data", 500000)).toBe(false);
  });
  it("lets a first_n count above the old 1000-row cap unlock review", () => {
    const queries: string[] = [];
    const totals: Record<string, number> = { posts: 1001, vehicle_spins: 0 };
    const dao = {
      findRecordsByFilter: () => {
        throw new Error("review counts must not load a capped page of rows");
      },
      db: () => ({
        newQuery: (sql: string) => ({
          bind: (params: Record<string, string>) => ({
            one: (row: { total: number }) => {
              queries.push(sql);
              expect(params).toEqual({ dealer: "dealer-1", person: "person-1" });
              expect(sql).not.toContain("salesperson_id");
              if (sql.includes("FROM posts")) {
                expect(sql).toContain("attribution_authoritative = 1");
                expect(sql).toContain("owner_person_id = {:person}");
                row.total = totals.posts;
              } else if (sql.includes("FROM vehicle_spins")) {
                expect(sql).toContain("person = {:person}");
                expect(sql).toContain("state = 'approved'");
                row.total = totals.vehicle_spins;
              } else {
                throw new Error("unexpected count query " + sql);
              }
            },
          }),
        }),
      }),
    };
    const policies = loadPocketBaseModule("requestPolicies.js", {});
    const spins = loadPocketBaseModule<{
      policyState: (record: unknown, dealer: unknown) => string;
    }>("vehicleSpins.js", {
      __hooks: "/hooks",
      DynamicModel: function DynamicModel(shape: { total: number }) {
        return shape;
      },
      $app: { dao: () => dao },
      require: (path: string) => {
        if (String(path).endsWith("/requestPolicies.js")) return policies;
        throw new Error("unexpected require " + path);
      },
    });
    const dealer = {
      id: "dealer-1",
      getBool: (field: string) => field === "requires_approval",
      getString: (field: string) =>
        field === "approval_policy"
          ? JSON.stringify({ mode: "first_n", firstN: 1001 })
          : "",
    };
    const record = {
      getString: (field: string) => (field === "person" ? "person-1" : ""),
    };
    // The old page stopped at 1000, so 1001 approved posts stayed pending.
    expect(spins.policyState(record, dealer)).toBe("n_a");
    expect(queries.some((sql) => sql.includes("COUNT(*)"))).toBe(true);

    queries.length = 0;
    totals.posts = 1000;
    expect(spins.policyState(record, dealer)).toBe("pending");

    queries.length = 0;
    totals.posts = 600;
    totals.vehicle_spins = 401;
    expect(spins.policyState(record, dealer)).toBe("n_a");
  });
  it("locks both collections and their file assets, with bounded request bodies", () => {
    const migration = readFileSync("pb_migrations/1752600000_vehicle_spins.js", "utf8");
    expect(migration).toMatch(/listRule: null/);
    expect(migration).toMatch(/viewRule: null/);
    expect(migration).toMatch(/protected: true/);
    expect(migration).toMatch(/maxSize: 500000/);
    expect(migration).toMatch(/UNIQUE INDEX idx_vehicle_spin_angle/);
    const routes = readFileSync("pb_hooks/vehicleSpins.pb.js", "utf8");
    expect(routes).toMatch(/bodyLimit\(600000\)/);
    expect(routes).toMatch(/bodyLimit\(12000\)/);
  });
});
