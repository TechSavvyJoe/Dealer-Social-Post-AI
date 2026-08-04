/// <reference path="../pb_data/types.d.ts" />
/**
 * Dealer-scoped manager username/password sign-in.
 *
 * Password verifiers live in a locked PocketBase auth collection so the app
 * never implements or stores password hashes itself. The collection's built-in
 * auth methods are disabled; credentials are exchanged only through the
 * rate-limited /api/app/session route, which continues to mint the app's
 * revocable HttpOnly session cookie.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const people = dao.findCollectionByNameOrId("salespeople");

    let managerAccounts = null;
    try {
      managerAccounts = dao.findCollectionByNameOrId("manager_accounts");
    } catch (_e) {}

    if (!managerAccounts) {
      managerAccounts = new Collection({
        name: "manager_accounts",
        type: "auth",
        system: false,
        schema: [
          {
            name: "person",
            type: "relation",
            required: true,
            options: {
              collectionId: people.id,
              cascadeDelete: true,
              maxSelect: 1,
              minSelect: 1,
            },
          },
        ],
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
          minPasswordLength: 15,
        },
        indexes: [
          "CREATE UNIQUE INDEX `idx_manager_accounts_person` ON `manager_accounts` (`person`)",
        ],
      });
      dao.saveCollection(managerAccounts);
    } else {
      // A partially applied/manual collection must never be trusted as-is.
      // Reconcile every security-sensitive option, or fail the migration if
      // the name points at a non-auth collection that cannot safely hold PB
      // password verifiers.
      if (managerAccounts.type !== "auth") {
        throw new Error("manager_accounts exists but is not an auth collection");
      }
      managerAccounts.system = false;
      managerAccounts.listRule = null;
      managerAccounts.viewRule = null;
      managerAccounts.createRule = null;
      managerAccounts.updateRule = null;
      managerAccounts.deleteRule = null;
      managerAccounts.setOptions({
        manageRule: null,
        allowOAuth2Auth: false,
        allowUsernameAuth: false,
        allowEmailAuth: false,
        requireEmail: false,
        exceptEmailDomains: null,
        onlyVerified: false,
        onlyEmailDomains: null,
        minPasswordLength: 15,
      });

      let personField = managerAccounts.schema.getFieldByName("person");
      if (!personField) {
        managerAccounts.schema.addField(
          new SchemaField({
            name: "person",
            type: "relation",
            required: true,
            options: {
              collectionId: people.id,
              cascadeDelete: true,
              maxSelect: 1,
              minSelect: 1,
            },
          }),
        );
      } else {
        if (personField.type !== "relation") {
          throw new Error("manager_accounts.person is not a relation field");
        }
        personField.required = true;
        personField.options = {
          collectionId: people.id,
          cascadeDelete: true,
          maxSelect: 1,
          minSelect: 1,
        };
      }
      managerAccounts.indexes = Array.from(managerAccounts.indexes || []).filter(
        (index) => String(index).indexOf("idx_manager_accounts_person") === -1,
      );
      managerAccounts.indexes.push(
        "CREATE UNIQUE INDEX `idx_manager_accounts_person` ON `manager_accounts` (`person`)",
      );
      dao.saveCollection(managerAccounts);
    }

    let managerUsernameField = people.schema.getFieldByName("manager_username");
    if (!managerUsernameField) {
      people.schema.addField(
        new SchemaField({
          name: "manager_username",
          type: "text",
          required: false,
          options: {
            min: 3,
            max: 32,
            pattern: "^[a-z][a-z0-9._-]{2,31}$",
          },
        }),
      );
    } else {
      if (managerUsernameField.type !== "text") {
        throw new Error("salespeople.manager_username is not a text field");
      }
      managerUsernameField.required = false;
      managerUsernameField.options = {
        min: 3,
        max: 32,
        pattern: "^[a-z][a-z0-9._-]{2,31}$",
      };
    }
    people.indexes = Array.from(people.indexes || []).filter(
      (index) => String(index).indexOf("idx_salespeople_manager_username") === -1,
    );
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_manager_username` ON `salespeople` (`manager_username`) WHERE `manager_username` != ''",
    );
    dao.saveCollection(people);

    const sessions = dao.findCollectionByNameOrId("sessions");
    let managerAccountField = sessions.schema.getFieldByName("manager_account");
    if (!managerAccountField) {
      sessions.schema.addField(
        new SchemaField({
          name: "manager_account",
          type: "relation",
          required: false,
          options: {
            collectionId: managerAccounts.id,
            cascadeDelete: true,
            maxSelect: 1,
            minSelect: 0,
          },
        }),
      );
    } else {
      if (managerAccountField.type !== "relation") {
        throw new Error("sessions.manager_account is not a relation field");
      }
      managerAccountField.required = false;
      managerAccountField.options = {
        collectionId: managerAccounts.id,
        cascadeDelete: true,
        maxSelect: 1,
        minSelect: 0,
      };
    }
    let managerFingerprintField = sessions.schema.getFieldByName(
      "manager_auth_fingerprint",
    );
    if (!managerFingerprintField) {
      sessions.schema.addField(
        new SchemaField({
          name: "manager_auth_fingerprint",
          type: "text",
          required: false,
          options: {
            min: 64,
            max: 64,
            pattern: "^[a-f0-9]{64}$",
          },
        }),
      );
    } else {
      if (managerFingerprintField.type !== "text") {
        throw new Error("sessions.manager_auth_fingerprint is not a text field");
      }
      managerFingerprintField.required = false;
      managerFingerprintField.options = {
        min: 64,
        max: 64,
        pattern: "^[a-f0-9]{64}$",
      };
    }
    const sessionIndexes = Array.from(sessions.indexes || []);
    if (
      !sessionIndexes.some(
        (index) => String(index).indexOf("idx_sessions_manager_account") !== -1,
      )
    ) {
      sessionIndexes.push(
        "CREATE INDEX `idx_sessions_manager_account` ON `sessions` (`manager_account`)",
      );
    }
    sessions.indexes = sessionIndexes;
    dao.saveCollection(sessions);

    let events = null;
    try {
      events = dao.findCollectionByNameOrId("auth_events");
    } catch (_e) {}
    if (events) {
      const kind = events.schema.getFieldByName("kind");
      if (kind) {
        kind.options = kind.options || {};
        const values = Array.from(kind.options.values || []);
        [
          "manager_login_configured",
          "manager_login_disabled",
          "manager_password_changed",
        ].forEach((value) => {
          if (values.indexOf(value) === -1) values.push(value);
        });
        kind.options.maxSelect = 1;
        kind.options.values = values;
        dao.saveCollection(events);
      }
    }
  },
  (_db) => {
    // Forward-only security migration. Downgrade must not recreate a state in
    // which password-backed sessions can outlive their credential verifier.
  },
);
