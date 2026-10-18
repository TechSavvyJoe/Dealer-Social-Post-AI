/** Dealer-scoped filing metadata. Never changes posts.updated or stores media. */
const STATUSES = ["n_a", "pending", "approved", "rejected"];
const WEBSITE_STATUSES = [
  "not_requested",
  "waiting_approval",
  "queued",
  "delivering",
  "draft_ready",
  "retrying",
  "failed",
  "published",
  "withdrawn",
];
const SORTS = {
  newest_created: { field: "generated_at", descending: true, db: "-generated_at,-id" },
  newest_updated: { field: "updated", descending: true, db: "-updated,-id" },
  oldest_created: { field: "generated_at", descending: false, db: "+generated_at,+id" },
};
function failure(code, status, message) {
  const error = new Error(message || code);
  error.workspaceCode = code;
  error.workspaceStatus = status;
  return error;
}
function respond(c, error) {
  if (!error || !error.workspaceCode) return false;
  c.json(error.workspaceStatus, { error: error.message, code: error.workspaceCode });
  return true;
}
function manager(context) {
  return context.role === "dealer_admin" || context.role === "super_admin";
}
function authorized(context, post) {
  return (
    !!context.dealer &&
    post.getString("dealer") === context.dealer.id &&
    (manager(context) ||
      (!!context.person &&
        post.getBool("attribution_authoritative") &&
        post.getString("owner_person_id") === context.person.id))
  );
}
function ownedPost(dao, context, id) {
  let post;
  try {
    post = dao.findRecordById("posts", id);
  } catch (_error) {
    throw failure("POST_NOT_FOUND", 404, "Post not found");
  }
  if (!authorized(context, post))
    throw failure("POST_NOT_FOUND", 404, "Post not found");
  return post;
}
function stateForPost(dao, postId) {
  // Empty result is a real active legacy post. Database errors fail closed.
  const rows = dao.findRecordsByFilter(
    "post_workspace_state",
    "post = {:post}",
    "",
    1,
    0,
    { post: postId },
  );
  return rows.length ? rows[0] : null;
}
function fields(state) {
  return {
    archived: !!state && state.getBool("archived"),
    workspace_revision: state ? Number(state.get("revision")) : 0,
    archived_at: state ? state.getString("archived_at") : "",
    archived_by: state ? state.getString("archived_by") : "",
  };
}
function assertActive(dao, postId) {
  const state = stateForPost(dao, postId);
  if (state && state.getBool("archived"))
    throw failure(
      "POST_ARCHIVED",
      409,
      "Restore this post before changing or sending it.",
    );
}
function statesForPosts(dao, dealerId, records) {
  const result = {};
  if (!records.length) return result;
  const params = { dealer: dealerId };
  const ids = records.map(function (record, i) {
    params["id" + i] = record.id;
    return "post = {:id" + i + "}";
  });
  const rows = dao.findRecordsByFilter(
    "post_workspace_state",
    "dealer = {:dealer} && (" + ids.join(" || ") + ")",
    "",
    records.length,
    0,
    params,
  );
  rows.forEach(function (row) {
    result[row.getString("post")] = row;
  });
  return result;
}
function project(records, context, dao) {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const states = statesForPosts(dao, context.dealer.id, records);
  return require(__hooks + "/postProjection.js")
    .projectRecords(records, context.dealer, helpers, policies, dao)
    .map(function (item) {
      return Object.assign(item, fields(states[item.id]), {
        video_availability: item.has_video ? "unavailable" : "not_generated",
      });
    });
}
function parseQuery(query) {
  const helpers = require(__hooks + "/helpers.js");
  function choice(name, values, fallback) {
    const value = String(query[name] || fallback || "").trim();
    if (value && values.indexOf(value) === -1)
      throw failure("INVALID_POST_FILTER", 400, "Invalid " + name);
    return value;
  }
  function timestamp(name) {
    const value = String(query[name] || "").trim();
    if (!value) return "";
    if (
      !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?)?$/.test(value) ||
      !Number.isFinite(Date.parse(value.replace(" ", "T"))) ||
      new Date(value.replace(" ", "T")).toISOString().slice(0, 10) !==
        value.slice(0, 10)
    )
      throw failure("INVALID_POST_FILTER", 400, "Invalid " + name);
    return helpers.databaseTimestamp(
      value.length === 10
        ? value + (name === "until" ? "T23:59:59.999Z" : "T00:00:00.000Z")
        : value,
    );
  }

  const q = String(query.q || "")
    .trim()
    .toLowerCase();
  const owner = String(query.owner_person_id || "").trim();
  if (q.length > 120 || (owner && !/^[A-Za-z0-9_-]{1,64}$/.test(owner)))
    throw failure("INVALID_POST_FILTER", 400, "Invalid search or owner filter");
  const limitRaw = String(query.limit || "200");
  if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 1000)
    throw failure("INVALID_POST_FILTER", 400, "Limit must be between 1 and 1000");
  const options = {
    q: q,
    owner: owner,
    since: timestamp("since"),
    until: timestamp("until"),
    status: choice("approval_status", STATUSES, ""),
    archived: choice("archived", ["active", "archived", "all"], "active"),
    media: choice("media", ["any", "image", "video_generated"], "any"),
    website: choice("website_status", WEBSITE_STATUSES, ""),
    sort: choice("sort", Object.keys(SORTS), "newest_created"),
    limit: Number(limitRaw),
    cursor: null,
  };
  if (
    options.since &&
    options.until &&
    timestampKey(options.since) > timestampKey(options.until)
  )
    throw failure("INVALID_POST_FILTER", 400, "Date range is reversed");
  const cursor = String(query.cursor || "");
  if (cursor) {
    const parts = cursor.split("|");
    // Keep old generated_at|id cursors usable with the old default sort.
    if (parts.length === 2 && options.sort === "newest_created")
      parts.unshift("newest_created");
    if (
      parts.length !== 3 ||
      parts[0] !== options.sort ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(parts[2])
    )
      throw failure("INVALID_POST_CURSOR", 400, "Invalid post cursor");
    if (
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/.test(parts[1]) ||
      !Number.isFinite(Date.parse(parts[1].replace(" ", "T")))
    )
      throw failure("INVALID_POST_CURSOR", 400, "Invalid post cursor");
    const time = helpers.databaseTimestamp(parts[1]);
    if (!time) throw failure("INVALID_POST_CURSOR", 400, "Invalid post cursor");
    options.cursor = { time: time, id: parts[2] };
  }
  return options;
}
function searchableText(item) {
  const values = [
    item.salesperson_name,
    item.vin,
    item.style,
    item.tone,
    item.scenario_id,
    item.approved_by,
  ];
  // Review-held copy is not a discovery/count oracle for concealed identities.
  if (!item.identity_review_required && !item.image_review_required) {
    values.push(item.customer_name, item.caption, item.disclosures);
    Object.keys(item.platform_captions || {}).forEach(function (key) {
      values.push(item.platform_captions[key]);
    });
    if (item.website_draft)
      values.push(
        item.website_draft.title,
        item.website_draft.body,
        item.website_draft.altText,
      );
  }
  return values.filter(Boolean).join(" ").toLowerCase();
}
function matches(item, options) {
  if (options.archived !== "all" && item.archived !== (options.archived === "archived"))
    return false;
  if (options.status && item.approval_status !== options.status) return false;
  if (options.owner && item.owner_person_id !== options.owner) return false;
  // Mixed PocketBase spellings ("T" vs space, ".000Z" vs "Z") do not sort
  // as instants. The same timestampKey the cursor uses keeps a post inside
  // the UTC day it was created.
  if (options.since && timestampKey(item.generated_at) < timestampKey(options.since))
    return false;
  if (options.until && timestampKey(item.generated_at) > timestampKey(options.until))
    return false;
  if (options.media === "image" && !item.creative_image_url) return false;
  if (options.media === "video_generated" && !item.has_video) return false;
  if (
    options.website &&
    (!item.website_publication || item.website_publication.status !== options.website)
  )
    return false;
  return !options.q || searchableText(item).indexOf(options.q) !== -1;
}
function timestampKey(value) {
  // PB saves use a space while approval SQL historically saved ISO with T.
  // Compare instants without rewriting the raw creative CAS token in the DTO.
  // Date.parse keeps millisecond precision and truncates any further digits,
  // so 10:00:00.000900000Z would compare equal to 10:00:00.000Z and an
  // earlier post would pass a since filter. Round the fraction to the nearest
  // millisecond here, once, for filters, cursors, and sort keys.
  const raw = String(value || "")
    .trim()
    .replace(" ", "T");
  const extra = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{4,})(Z?)$/.exec(raw);
  if (!extra) {
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : 0;
  }
  let milliseconds = Number(extra[2].slice(0, 3));
  let carry = 0;
  if (Number(extra[2][3]) >= 5) milliseconds += 1;
  if (milliseconds >= 1000) {
    milliseconds = 0;
    carry = 1000;
  }
  const time = Date.parse(
    extra[1] + "." + String(milliseconds).padStart(3, "0") + (extra[3] || ""),
  );
  return Number.isFinite(time) ? time + carry : 0;
}
function compareKeys(time, id, otherTime, otherId, descending) {
  const compared =
    time === otherTime
      ? id === otherId
        ? 0
        : id < otherId
          ? -1
          : 1
      : time < otherTime
        ? -1
        : 1;
  return descending ? -compared : compared;
}
function compareItems(item, other, options) {
  const config = SORTS[options.sort];
  return compareKeys(
    timestampKey(item[config.field]),
    item.id,
    timestampKey(other[config.field]),
    other.id,
    config.descending,
  );
}
function afterCursor(item, options) {
  if (!options.cursor) return true;
  const config = SORTS[options.sort];
  return (
    compareKeys(
      timestampKey(item[config.field]),
      item.id,
      timestampKey(options.cursor.time),
      options.cursor.id,
      config.descending,
    ) > 0
  );
}
function retainPageItem(items, item, options) {
  // Scan order in the DB may differ for mixed timestamp spellings. Keep only
  // the first limit+1 matching rows in the same instant/id order as the cursor.
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareItems(items[middle], item, options) < 0) low = middle + 1;
    else high = middle;
  }
  if (low > options.limit) return;
  items.splice(low, 0, item);
  if (items.length > options.limit + 1) items.pop();
}
function list(c, context) {
  try {
    if (!context.dealer || (!manager(context) && !context.person))
      throw failure("PERSONAL_SESSION_REQUIRED", 403, "Personal session required");
    const options = parseQuery($apis.requestInfo(c).query || {});
    const filterParts = ["dealer = {:dealer}"];
    const params = { dealer: context.dealer.id };
    if (!manager(context)) {
      filterParts.push(
        "attribution_authoritative = true",
        "owner_person_id = {:person}",
      );
      params.person = context.person.id;
    }
    const dao = $app.dao();
    const items = [];
    const counts = { n_a: 0, pending: 0, approved: 0, rejected: 0 };
    let total = 0;
    // All authorized rows are examined in bounded batches. Searching projected
    // values avoids raw SQL LIKE leaking held captions through matches/counts.
    // There is no former 50/1000-history ceiling; response size stays bounded.
    const batchSize = 500;
    for (let offset = 0; ; offset += batchSize) {
      const records = dao.findRecordsByFilter(
        "posts",
        filterParts.join(" && "),
        SORTS[options.sort].db,
        batchSize,
        offset,
        params,
      );
      project(records, context, dao).forEach(function (item) {
        if (!matches(item, options)) return;
        total += 1;
        if (Object.prototype.hasOwnProperty.call(counts, item.approval_status))
          counts[item.approval_status] += 1;
        if (afterCursor(item, options)) retainPageItem(items, item, options);
      });
      if (records.length < batchSize) break;
    }
    const hasMore = items.length > options.limit;
    const page = items.slice(0, options.limit);
    // Counts include every selected filter, including approval_status, and
    // exclude cursor. They are matching-result counts, not status facets.
    const payload = { items: page, total: total, counts: counts };
    if (hasMore && page.length) {
      const last = page[page.length - 1];
      payload.nextCursor =
        options.sort + "|" + last[SORTS[options.sort].field] + "|" + last.id;
    }
    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, payload);
  } catch (error) {
    if (respond(c, error)) return;
    console.error("[post-workspace] list failed");
    return c.json(500, { error: "Failed to list posts" });
  }
}
function detail(c) {
  const context = require(__hooks + "/helpers.js").sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  try {
    const dao = $app.dao();
    const post = ownedPost(dao, context, c.pathParam("id"));
    const item = project([post], context, dao)[0];
    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, item);
  } catch (error) {
    if (respond(c, error)) return;
    return c.json(500, { error: "Failed to load post" });
  }
}
function parseRequest(body) {
  const revision =
    typeof body.expected_post_revision === "string"
      ? body.expected_post_revision.trim()
      : "";
  const workspace = body.expected_workspace_revision;
  if (
    !revision ||
    revision.length > 80 ||
    typeof workspace !== "number" ||
    !Number.isSafeInteger(workspace) ||
    workspace < 0
  )
    throw failure(
      "POST_WORKSPACE_REVISION_REQUIRED",
      400,
      "Current creative and workspace revisions are required",
    );
  return { revision: revision, workspace: workspace };
}
function change(dao, context, id, body, archived) {
  const expected = parseRequest(body);
  let receipt;
  dao.runInTransaction(function (tx) {
    // Serialize against creative edits, share sends and website claim fences.
    const fence = tx
      .db()
      .newQuery(
        "UPDATE posts SET updated = updated WHERE id = {:post} AND dealer = {:dealer}",
      )
      .bind({ post: id, dealer: context.dealer.id })
      .execute();
    if (!fence || fence.rowsAffected() !== 1)
      throw failure("POST_NOT_FOUND", 404, "Post not found");
    const post = ownedPost(tx, context, id);
    const state = stateForPost(tx, id);
    const previous = fields(state);
    if (
      post.getString("updated") !== expected.revision ||
      previous.workspace_revision !== expected.workspace
    )
      throw failure(
        "POST_WORKSPACE_REVISION_CONFLICT",
        409,
        "This post changed. Reload it before trying again.",
      );
    if (previous.archived === archived) {
      receipt = Object.assign(
        { id: id, post_revision: post.getString("updated") },
        previous,
      );
      return;
    }
    const time = new Date().toISOString();
    const actor = context.person ? context.person.getString("name") : "System Admin";
    const record =
      state || new Record(tx.findCollectionByNameOrId("post_workspace_state"));
    record.set("post", id);
    record.set("dealer", context.dealer.id);
    record.set("archived", archived);
    record.set("revision", previous.workspace_revision + 1);
    record.set("archived_at", archived ? time : "");
    record.set("archived_by", archived ? actor : "");
    tx.saveRecord(record);
    const event = new Record(tx.findCollectionByNameOrId("post_workspace_events"));
    event.set("post", id);
    event.set("dealer", context.dealer.id);
    event.set("action", archived ? "archive" : "restore");
    event.set("actor_person_id", context.person ? context.person.id : "");
    event.set("actor_name", actor);
    event.set("post_revision", expected.revision);
    event.set("workspace_revision", previous.workspace_revision + 1);
    tx.saveRecord(event);
    receipt = Object.assign(
      { id: id, post_revision: post.getString("updated") },
      fields(record),
    );
  });
  return receipt;
}
function mutate(c, archived, bulk) {
  const context = require(__hooks + "/helpers.js").sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  try {
    if (!context.dealer || (!manager(context) && !context.person))
      throw failure("PERSONAL_SESSION_REQUIRED", 403, "Personal session required");
    const body = $apis.requestInfo(c).data || {};
    c.response().header().set("Cache-Control", "private, no-store");
    if (!bulk)
      return c.json(
        200,
        change($app.dao(), context, c.pathParam("id"), body, archived),
      );
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50)
      throw failure(
        "INVALID_POST_WORKSPACE_BATCH",
        400,
        "Select between 1 and 50 posts",
      );
    const seen = {};
    body.items.forEach(function (item) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) ||
        seen[item.id]
      )
        throw failure(
          "INVALID_POST_WORKSPACE_BATCH",
          400,
          "Batch IDs must be unique post IDs",
        );
      seen[item.id] = true;
      parseRequest(item);
    });
    const results = body.items.map(function (item) {
      try {
        return {
          id: item.id,
          ok: true,
          receipt: change($app.dao(), context, item.id, item, archived),
        };
      } catch (error) {
        return {
          id: item.id,
          ok: false,
          status: error.workspaceStatus || 500,
          code: error.workspaceCode || "POST_WORKSPACE_WRITE_FAILED",
          message: error.workspaceCode ? error.message : "Failed to update post",
        };
      }
    });
    return c.json(200, { results: results });
  } catch (error) {
    if (respond(c, error)) return;
    return c.json(500, { error: "Failed to update post" });
  }
}
module.exports = {
  failure,
  respond,
  authorized,
  ownedPost,
  stateForPost,
  fields,
  assertActive,
  project,
  parseQuery,
  searchableText,
  matches,
  afterCursor,
  list,
  detail,
  parseRequest,
  change,
  mutate,
};
