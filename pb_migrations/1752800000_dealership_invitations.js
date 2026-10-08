// Additive migration: existing stores remain accessible until their manager
// distributes an invitation and explicitly enables the invitation requirement.
migrate(
  (db) => {
    const dao = new Dao(db);
    const dealers = dao.findCollectionByNameOrId("dealers");
    dealers.schema.addField(
      new SchemaField({ name: "invitation_hash", type: "text", options: { max: 64 } }),
    );
    dealers.schema.addField(
      new SchemaField({ name: "invitation_required", type: "bool" }),
    );
    dealers.indexes = Array.from(dealers.indexes || []).concat([
      "CREATE UNIQUE INDEX idx_dealer_invitation ON dealers(invitation_hash) WHERE invitation_hash != ''",
    ]);
    dao.saveCollection(dealers);
    const sessions = dao.findCollectionByNameOrId("sessions");
    sessions.schema.addField(
      new SchemaField({
        name: "invitation_fingerprint",
        type: "text",
        options: { max: 64 },
      }),
    );
    dao.saveCollection(sessions);
  },
  (_db) => {
    // Forward-only: removing the policy would silently permit code-only access.
    // Roll back the compatible application image, keeping this additive schema.
  },
);
