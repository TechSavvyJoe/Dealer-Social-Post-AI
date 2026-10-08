import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (values: Record<string, unknown>) => ({
  id: String(values.id || "fixture"),
  getString: (key: string) => String(values[key] || ""),
  getBool: (key: string) => !!values[key],
});
function load(file: string, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  runInNewContext(readFileSync(file, "utf8"), { module, ...globals });
  return module.exports;
}

describe("private dealership invitation authority", () => {
  const invitations = load("pb_hooks/dealershipInvitations.js");
  it("preserves legacy access until required and rejects old bound sessions after rotation", () => {
    const current = "a".repeat(64);
    const dealer = record({ invitation_required: true, invitation_hash: current });
    expect(invitations.sessionAllowed(record({}), dealer)).toBe(false);
    expect(
      invitations.sessionAllowed(record({ invitation_fingerprint: current }), dealer),
    ).toBe(true);
    expect(
      invitations.sessionAllowed(
        record({ invitation_fingerprint: "b".repeat(64) }),
        dealer,
      ),
    ).toBe(false);
    expect(
      invitations.sessionAllowed(record({}), record({ invitation_required: false })),
    ).toBe(true);
    expect(
      invitations.sessionAllowed(record({ manager_account: "manager-auth" }), dealer),
    ).toBe(true);
    expect(invitations.sessionAllowed(record({ is_impersonation: true }), dealer)).toBe(
      true,
    );
  });

  it("accepts only an exact cookie name and binds the lookup to its hash", () => {
    const token = "a".repeat(64);
    const find = vi.fn(() => [record({ id: "store" })]);
    const api = load("pb_hooks/dealershipInvitations.js", {
      $security: { sha256 },
      $app: { dao: () => ({ findRecordsByFilter: find }) },
    });
    const context = (cookie: string) => ({
      request: () => ({ header: { get: () => cookie } }),
    });
    expect(api.deviceDealer(context("not_dealer_invitation=" + token))).toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(api.deviceDealer(context("another=x; dealer_invitation=" + token)).id).toBe(
      "store",
    );
    expect(find.mock.calls[0]).toEqual([
      "dealers",
      "invitation_hash = {:hash} && is_system = false",
      "id",
      2,
      0,
      { hash: sha256("dealer-social:invitation:v1:" + token) },
    ]);
    expect(
      api.deviceDealer(context("dealer_invitation=" + token + "extra")),
    ).toBeNull();
  });

  it("checks invitation rotation and session creation inside the same transaction", () => {
    let inside = false;
    let saved: any;
    const current = "a".repeat(64);
    const dealer = record({
      id: "store",
      invitation_required: true,
      invitation_hash: current,
    });
    const person = record({
      id: "person",
      dealer: "store",
      role: "salesperson",
      active: true,
      pin_hash: "b".repeat(64),
    });
    const tx = {
      findCollectionByNameOrId: () => ({ id: "sessions" }),
      findRecordById: (collection: string) => {
        expect(inside).toBe(true);
        return collection === "dealers" ? dealer : person;
      },
      saveRecord: (value: unknown) => {
        expect(inside).toBe(true);
        saved = value;
      },
    };
    const api = load("pb_hooks/helpers.js", {
      $app: {
        dao: () => ({
          runInTransaction: (fn: (dao: typeof tx) => void) => {
            inside = true;
            try {
              fn(tx);
            } finally {
              inside = false;
            }
          },
        }),
      },
      $security: { sha256, randomStringWithAlphabet: () => "c".repeat(64) },
      Record: class {
        id = "new-session";
        constructor(
          _collection: unknown,
          public values: unknown,
        ) {}
      },
    });
    const options = {
      personId: "person",
      expectedPersonPinFingerprint: api.personPinFingerprint(person),
    };
    expect(() => api.createSession("store", "salesperson", "", "", options)).toThrow(
      "Dealership invitation changed during sign-in",
    );
    expect(() =>
      api.createSession("store", "salesperson", "", "", {
        ...options,
        expectedInvitationFingerprint: "d".repeat(64),
      }),
    ).toThrow("Dealership invitation changed during sign-in");
    expect(saved).toBeUndefined();
    api.createSession("store", "salesperson", "", "", {
      ...options,
      expectedInvitationFingerprint: current,
    });
    expect(saved.values.invitation_fingerprint).toBe(current);
    expect(saved.values).not.toHaveProperty("token");
  });
});
