/// <reference path="../pb_data/types.d.ts" />
/**
 * Adds `custom_scenarios` JSON field to dealers. Holds an array of GSM-
 * defined post scenarios that augment the built-in catalog.
 *
 * Shape (JSON):
 *   [
 *     {
 *       id: "spring_clearance_f150",        // unique within this dealer
 *       label: "Spring Clearance — F-150",
 *       blurb: "F-150 push, Apr 1-30",
 *       emoji: "🌸",
 *       category: "promo",
 *       defaultStyle: "Modern & Bold",
 *       defaultTone: "Promotional",
 *       requiresCustomer: false,
 *       requiresVehicle: true,
 *       promptAdditions: "Scenario: ... clearance event for the F-150 line. Emphasize trim levels available, financing approved through any major lender.",
 *       suggestedHashtags: ["#F150", "#SpringEvent", "#TruckMonth"],
 *       starterCaption: ""
 *     },
 *     ...
 *   ]
 *
 * Stored as a text field (PB doesn't have first-class JSON), parsed/
 * stringified on the way in/out. Validation happens client-side.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;
    if (!(function(s, n){ for(let i=0;i<s.length;i++){ if(s[i].name === n) return s[i]; } return null; })(dealers.schema, "custom_scenarios")) {
      dealers.schema.addField(new SchemaField({
        name: "custom_scenarios",
        type: "text",
        required: false,
        // Generous ceiling — 32KB lets a dealer keep ~30-50 custom scenarios.
        options: { max: 32000 },
      }));
      dao.saveCollection(dealers);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;
    dealers.schema = Array.from(dealers.schema).filter(
      (f) => f.name !== "custom_scenarios"
    );
    dao.saveCollection(dealers);
  }
);
