/// <reference path="../pb_data/types.d.ts" />
/**
 * Lock down collection rules. After this migration:
 *   - dealers, posts, photo_releases: only superuser can directly hit the
 *     PocketBase REST API. Frontend reaches them through session-gated
 *     /api/app/* endpoints defined in pb_hooks/main.pb.js.
 *
 * Pre-fix state had `listRule: ""` / `viewRule: ""` which meant any browser
 * could enumerate dealer codes, customer signatures, and post history.
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    const lock = (name) => {
      let col = null; try { col = dao.findCollectionByNameOrId(name); } catch(e) {}
      if (!col) return;
      col.listRule = null;
      col.viewRule = null;
      col.createRule = null;
      col.updateRule = null;
      col.deleteRule = null;
      dao.saveCollection(col);
      console.log(`[migration] Locked ${name} collection rules`);
    };

    lock("dealers");
    lock("posts");
    lock("photo_releases");
  },
  (db) => {
    // Down: restore the pre-fix open rules on dealers (the original posture)
    // and the create-only posture on posts / photo_releases.
    const dao = new Dao(db);

    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (dealers) {
      dealers.listRule = "";
      dealers.viewRule = "";
      dealers.createRule = "";
      dealers.updateRule = "";
      dealers.deleteRule = "";
      dao.saveCollection(dealers);
    }

    const opener = (name) => {
      let col = null; try { col = dao.findCollectionByNameOrId(name); } catch(e) {}
      if (!col) return;
      col.listRule = "";
      col.viewRule = "";
      col.createRule = "";
      dao.saveCollection(col);
    };
    opener("posts");
    opener("photo_releases");
  }
);
