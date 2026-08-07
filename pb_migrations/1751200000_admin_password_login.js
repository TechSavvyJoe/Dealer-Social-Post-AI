/// <reference path="../pb_data/types.d.ts" />
/**
 * System-administrator username/password sign-in.
 *
 * Replaces the ADMIN_DEALER_CODE deployment-secret login. Password verifiers
 * live in a locked PocketBase auth collection (same pattern as
 * manager_accounts); built-in auth methods are disabled and credentials are
 * exchanged only through the rate-limited /api/app/session route. Admin
 * sessions bind to the account's token key, so a password change invalidates
 * existing administrator sessions.
 *
 * Also lowers the minimum password length for manager and admin logins from
 * 15 to 8 characters (rate limiting, Turnstile, and the hard lockout remain).
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    let adminAccounts = null;
    try {
      adminAccounts = dao.findCollectionByNameOrId("admin_accounts");
    } catch (_e) {}

    if (!adminAccounts) {
      adminAccounts = new Collection({
        name: "admin_accounts",
        type: "auth",
        system: false,
        schema: [],
        // Locked from the public Records API. The app exchanges credentials
        // only inside its custom route and never exposes a PocketBase JWT.
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        options: {
          manageRule: null,
          allowOAuth2Auth: false,
          allowUsernameAuth: false,
          allowEmailAuth: false,
          requireEmail: false,
          exceptEmailDomains: null,
          onlyVerified: false,
          onlyEmailDomains: null,
          minPasswordLength: 8,
        },
      });
      dao.saveCollection(adminAccounts);
    } else {
      if (adminAccounts.type !== "auth") {
        throw new Error("admin_accounts exists but is not an auth collection");
      }
      adminAccounts.system = false;
      adminAccounts.listRule = null;
      adminAccounts.viewRule = null;
      adminAccounts.createRule = null;
      adminAccounts.updateRule = null;
      adminAccounts.deleteRule = null;
      adminAccounts.setOptions({
        manageRule: null,
        allowOAuth2Auth: false,
        allowUsernameAuth: false,
        allowEmailAuth: false,
        requireEmail: false,
        exceptEmailDomains: null,
        onlyVerified: false,
        onlyEmailDomains: null,
        minPasswordLength: 8,
      });
      dao.saveCollection(adminAccounts);
    }

    const managerAccounts = dao.findCollectionByNameOrId("manager_accounts");
    managerAccounts.setOptions({
      manageRule: null,
      allowOAuth2Auth: false,
      allowUsernameAuth: false,
      allowEmailAuth: false,
      requireEmail: false,
      exceptEmailDomains: null,
      onlyVerified: false,
      onlyEmailDomains: null,
      minPasswordLength: 8,
    });
    dao.saveCollection(managerAccounts);
  },
  (_db) => {
    // Forward-only security migration. Downgrade must not recreate a state in
    // which password-backed sessions can outlive their credential verifier.
  },
);
