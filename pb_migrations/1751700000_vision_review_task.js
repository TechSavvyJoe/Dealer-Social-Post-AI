/// <reference path="../pb_data/types.d.ts" />
/**
 * Vision-QC review becomes its own generation task (Gemini integration
 * upgrade plan, P0-2).
 *
 * The image quality-control review used to ride on `caption_regenerate`, so
 * it inherited that task's cheap `thinkingLevel` and was recorded in the
 * usage ledger as a caption. It now declares `vision_review`, the one text
 * task pinned to `thinkingLevel: "medium"`. `generation_events.task` is a
 * select field, so the new value has to exist in the schema before the proxy
 * can record a single review — without this migration every QC review would
 * fail validation on write and the event would be lost.
 *
 * Additive and idempotent: existing rows keep their stored task, and the
 * rollback removes the value only when no row still uses it (dropping a
 * select option that live rows reference would leave the collection
 * invalid).
 */
const TASK_FIELD = "task";
const NEW_TASK_VALUE = "vision_review";

const readSelectValues = (field) => {
  const options = (field && field.options) || {};
  return Array.isArray(options.values) ? options.values.slice() : [];
};

const writeSelectValues = (field, values) => {
  const options = (field && field.options) || {};
  options.values = values;
  field.options = options;
};

migrate(
  (db) => {
    const dao = new Dao(db);

    let events = null;
    try {
      events = dao.findCollectionByNameOrId("generation_events");
    } catch (_error) {}
    if (!events) return;

    const field = events.schema.getFieldByName(TASK_FIELD);
    if (!field) return;

    const values = readSelectValues(field);
    if (values.indexOf(NEW_TASK_VALUE) !== -1) return;

    // Append rather than rewrite: the stored order is part of the collection
    // definition other migrations and the admin UI already read.
    values.push(NEW_TASK_VALUE);
    writeSelectValues(field, values);
    dao.saveCollection(events);
  },
  (db) => {
    const dao = new Dao(db);

    let events = null;
    try {
      events = dao.findCollectionByNameOrId("generation_events");
    } catch (_error) {}
    if (!events) return;

    const field = events.schema.getFieldByName(TASK_FIELD);
    if (!field) return;

    const values = readSelectValues(field);
    const index = values.indexOf(NEW_TASK_VALUE);
    if (index === -1) return;

    // Rows recorded while the value existed are real usage history. Leave the
    // option in place rather than orphaning them; the forward migration is
    // idempotent, so re-applying is safe either way.
    try {
      const stillInUse = dao.findRecordsByFilter(
        "generation_events",
        "task = {:task}",
        "",
        1,
        0,
        { task: NEW_TASK_VALUE },
      );
      if (stillInUse && stillInUse.length) return;
    } catch (_error) {
      return;
    }

    values.splice(index, 1);
    writeSelectValues(field, values);
    dao.saveCollection(events);
  },
);
