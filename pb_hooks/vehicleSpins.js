// Immutable, private snapshots. Only these routes can read or write the locked
// collections; both publication and export re-evaluate the store policy.
function text(value, max, required) {
  if (typeof value !== "string") return required ? null : "";
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > max || /[\x00-\x1f\x7f]/.test(cleaned))
    return null;
  return cleaned;
}

function normalizeVehicle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    title: text(value.title, 120, true),
    vin: text(value.vin, 17, false),
    stock: text(value.stock, 40, false),
    mileage: text(value.mileage, 12, false),
    caption:
      typeof value.caption === "string"
        ? value.caption.replace(/\r\n?/g, "\n").trim()
        : "",
    highlights: [],
  };
  if (
    result.title === null ||
    result.vin === null ||
    result.stock === null ||
    result.mileage === null ||
    result.caption.length > 1600 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result.caption)
  )
    return null;
  result.vin = result.vin.toUpperCase();
  if (result.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(result.vin)) return null;
  if (result.mileage && !/^[0-9][0-9, ]{0,11}$/.test(result.mileage)) return null;
  if (!Array.isArray(value.highlights) || value.highlights.length > 4) return null;
  for (let i = 0; i < value.highlights.length; i++) {
    const item = text(value.highlights[i], 80, true);
    if (!item) return null;
    result.highlights.push(item);
  }
  return result;
}

function vehicleOf(record) {
  try {
    return normalizeVehicle(JSON.parse(record.getString("vehicle")));
  } catch (_e) {
    return null;
  }
}
function manager(context) {
  return context.role === "dealer_admin" || context.role === "super_admin";
}
function owner(context, record) {
  return (
    record.getString("dealer") === context.dealer.id &&
    (manager(context) ||
      (context.person && record.getString("person") === context.person.id))
  );
}
function stateAllowsDelivery(state, policyState) {
  return state === "approved" || (state === "n_a" && policyState === "n_a");
}
function policyState(record, dealer) {
  const policies = require(__hooks + "/requestPolicies.js");
  return policies.initialApprovalStatus(dealer, {
    category: "inventory",
    involvesCustomer: false,
    countApprovedPosts: function () {
      const parameters = { dealer: dealer.id, person: record.getString("person") };
      const posts = $app
        .dao()
        .findRecordsByFilter(
          "posts",
          "dealer = {:dealer} && owner_person_id = {:person} && attribution_authoritative = true && approval_status = 'approved'",
          "",
          1000,
          0,
          parameters,
        );
      const spins = $app
        .dao()
        .findRecordsByFilter(
          "vehicle_spins",
          "dealer = {:dealer} && person = {:person} && state = 'approved'",
          "",
          1000,
          0,
          parameters,
        );
      return posts.length + spins.length;
    },
  });
}
function compliance(record, dealer) {
  const vehicle = vehicleOf(record);
  if (!vehicle) return false;
  const policies = require(__hooks + "/requestPolicies.js");
  const result = policies.validatePostComplianceSet(
    [vehicle.title, vehicle.caption].concat(vehicle.highlights),
    "",
    dealer.getString("banned_phrases"),
  );
  return result.ok;
}
function deliverable(record, dealer) {
  const state = record.getString("state");
  if (state !== "approved" && state !== "n_a") return false;
  return (
    (state === "approved" || policyState(record, dealer) === "n_a") &&
    compliance(record, dealer)
  );
}
function headers(c) {
  c.response().header().set("Cache-Control", "private, no-store");
  c.response().header().set("X-Content-Type-Options", "nosniff");
  c.response().header().set("X-Robots-Tag", "noindex, nofollow");
}
function auth(c, helpers) {
  headers(c);
  const context = helpers.sessionContext(c);
  if (!context || !context.person || context.dealer.getBool("is_system")) {
    c.json(401, { error: "Open a dealership personal session to use Vehicle Spin." });
    return null;
  }
  const rate = helpers.checkProxyRateLimit(
    "vehicle-spin:" + context.dealer.id + ":" + context.person.id,
    300,
    60000,
  );
  if (!rate.ok) {
    c.json(429, { error: "Too many requests. Try again shortly." });
    return null;
  }
  return context;
}
function findOwned(c, context, dao) {
  const record = dao.findRecordById("vehicle_spins", c.pathParam("id"));
  if (!owner(context, record)) throw new Error("NOT_FOUND");
  return record;
}
function frameRecords(dao, record) {
  return dao.findRecordsByFilter(
    "vehicle_spin_frames",
    "spin = {:spin}",
    "+angle",
    72,
    0,
    { spin: record.id },
  );
}
function serialize(record, dealer, includePrivate) {
  const result = {
    id: record.id,
    vehicle: vehicleOf(record),
    frameCount: record.getInt("frame_count"),
    background: record.getString("background"),
    dealerName: dealer.getString("name"),
    state: record.getString("state"),
    canDeliver: deliverable(record, dealer),
  };
  if (includePrivate) {
    result.created = record.getString("created");
    result.reviewNote = record.getString("review_note");
    result.linkToken = result.canDeliver ? record.getString("link_token") : "";
    result.uploadedAngles = frameRecords($app.dao(), record).map(function (frame) {
      return frame.getInt("angle");
    });
  }
  return result;
}
function lock(dao, id) {
  dao
    .db()
    .newQuery("UPDATE vehicle_spins SET updated = updated WHERE id = {:id}")
    .bind({ id: id })
    .execute();
}
function sendFrame(c, record, angle) {
  if (!Number.isInteger(angle) || angle < 0 || angle >= record.getInt("frame_count"))
    return c.json(404, { error: "Angle not found" });
  const frame = $app
    .dao()
    .findFirstRecordByFilter(
      "vehicle_spin_frames",
      "spin = {:spin} && angle = {:angle}",
      { spin: record.id, angle: angle },
    );
  const filename = frame.getString("image");
  const fs = $app.newFilesystem();
  try {
    fs.serve(
      c.response(),
      c.request(),
      frame.baseFilesPath() + "/" + filename,
      filename,
    );
  } finally {
    fs.close();
  }
}
function storageHasRoom(dfOutput, duOutput, incomingBytes) {
  return require(__hooks + "/mediaStorage.js").storageHasRoom(
    dfOutput,
    duOutput,
    incomingBytes,
  );
}
function ensureStorageRoom(incomingBytes) {
  require(__hooks + "/mediaStorage.js").ensureStorageRoom(incomingBytes);
}
// 25-dealership launch envelope: each store retains its own 30-spin ceiling.
// The filesystem guard still reserves backup room before every upload.
const SPIN_LIMITS = { person: 10, dealer: 30, total: 750 };
function capacity(dao, dealerId, personId) {
  const row = new DynamicModel({ total: 0, dealer: 0, person: 0 });
  dao
    .db()
    .newQuery(
      "SELECT COUNT(*) AS total, COALESCE(SUM(dealer = {:dealer}), 0) AS dealer, " +
        "COALESCE(SUM(dealer = {:dealer} AND person = {:person}), 0) AS person FROM vehicle_spins",
    )
    .bind({ dealer: dealerId, person: personId })
    .one(row);
  const reason =
    row.person >= SPIN_LIMITS.person
      ? "PERSON_QUOTA"
      : row.dealer >= SPIN_LIMITS.dealer
        ? "DEALER_QUOTA"
        : row.total >= SPIN_LIMITS.total
          ? "FLEET_QUOTA"
          : "";
  let storageAvailable = true;
  try {
    ensureStorageRoom(72 * 500000);
  } catch (_e) {
    storageAvailable = false;
  }
  return {
    personalUsed: Number(row.person),
    personalLimit: SPIN_LIMITS.person,
    dealershipUsed: Number(row.dealer),
    dealershipLimit: SPIN_LIMITS.dealer,
    canCreate: !reason && storageAvailable,
    storageAvailable: storageAvailable,
    reason: reason || (storageAvailable ? "" : "STORAGE"),
  };
}
function adminCapacity() {
  const row = new DynamicModel({ total: 0 });
  $app.dao().db().newQuery("SELECT COUNT(*) AS total FROM vehicle_spins").one(row);
  let storage = "available";
  try {
    ensureStorageRoom(72 * 500000);
  } catch (_e) {
    storage = "limited_or_unavailable";
  }
  return {
    savedSpins: Number(row.total),
    totalLimit: SPIN_LIMITS.total,
    dealershipLimit: SPIN_LIMITS.dealer,
    personalLimit: SPIN_LIMITS.person,
    storage: storage,
  };
}
function handle(c, action) {
  const helpers = require(__hooks + "/helpers.js");
  const context = auth(c, helpers);
  if (!context) return;
  const dao = $app.dao();
  try {
    if (action === "list") {
      const records = dao.findRecordsByFilter(
        "vehicle_spins",
        manager(context)
          ? "dealer = {:dealer}"
          : "dealer = {:dealer} && person = {:person}",
        "-created",
        30,
        0,
        { dealer: context.dealer.id, person: context.person.id },
      );
      return c.json(200, {
        items: records.map(function (r) {
          return serialize(r, context.dealer, true);
        }),
        canReview: manager(context),
        capacity: capacity(dao, context.dealer.id, context.person.id),
      });
    }
    if (action === "create") {
      const body = $apis.requestInfo(c).data;
      const vehicle = normalizeVehicle(body.vehicle);
      if (vehicle && !context.dealer.getBool("employee_disclosure_disabled")) {
        const template =
          context.dealer.getString("employee_disclosure_text").trim() ||
          "Posted by a {dealer} team member.";
        const disclosure = template
          .replace(/\{dealer\}/gi, context.dealer.getString("name") || "our dealership")
          .trim();
        if (vehicle.caption.toLowerCase().indexOf(disclosure.toLowerCase()) < 0)
          vehicle.caption =
            disclosure + (vehicle.caption ? "\n\n" + vehicle.caption : "");
      }
      if (vehicle && vehicle.caption.length > 1600)
        return c.json(400, {
          error: "Shorten the caption to leave room for the dealership disclosure.",
        });
      const count = Number(body.frameCount);
      if (
        !vehicle ||
        !Number.isInteger(count) ||
        count < 24 ||
        count > 72 ||
        ["original", "graphite", "pearl", "custom"].indexOf(body.background) < 0 ||
        body.reviewedAllAngles !== true ||
        body.vehicleOnly !== true
      ) {
        return c.json(400, {
          error:
            "Review every angle and vehicle fact, and confirm this is a vehicle-only recording.",
        });
      }
      const policies = require(__hooks + "/requestPolicies.js");
      if (
        !policies.validatePostComplianceSet(
          [vehicle.title, vehicle.caption].concat(vehicle.highlights),
          "",
          context.dealer.getString("banned_phrases"),
        ).ok
      )
        return c.json(400, {
          error:
            "Use verified vehicle facts here. Offers requiring disclosures belong in the standard post flow.",
        });
      let record;
      dao.runInTransaction(function (tx) {
        // Obtain a write lock before counting, so concurrent creates cannot
        // exceed persisted storage quotas across process restarts.
        tx.db()
          .newQuery("UPDATE dealers SET updated = updated WHERE id = {:id}")
          .bind({ id: context.dealer.id })
          .execute();
        ensureStorageRoom(count * 500000);
        const space = capacity(tx, context.dealer.id, context.person.id);
        if (!space.canCreate) throw new Error(space.reason);
        record = new Record(tx.findCollectionByNameOrId("vehicle_spins"), {
          dealer: context.dealer.id,
          person: context.person.id,
          vehicle: vehicle,
          state: "uploading",
          frame_count: count,
          background: body.background,
        });
        tx.saveRecord(record);
      });
      return c.json(201, serialize(record, context.dealer, true));
    }
    const record = findOwned(c, context, dao);
    if (action === "get") return c.json(200, serialize(record, context.dealer, true));
    if (action === "frame") return sendFrame(c, record, Number(c.pathParam("angle")));
    if (action === "upload") {
      const angle = Number(c.pathParam("angle"));
      if (
        !Number.isInteger(angle) ||
        angle < 0 ||
        angle >= record.getInt("frame_count")
      )
        return c.json(400, { error: "Invalid angle" });
      const file = $filesystem.fileFromMultipart(c.formFile("image"));
      dao.runInTransaction(function (tx) {
        lock(tx, record.id);
        const current = findOwned(c, context, tx);
        if (current.getString("state") !== "uploading") throw new Error("IMMUTABLE");
        ensureStorageRoom(500000);
        const frame = new Record(tx.findCollectionByNameOrId("vehicle_spin_frames"), {
          spin: record.id,
          angle: angle,
        });
        const form = new RecordUpsertForm($app, frame);
        form.setDao(tx);
        form.addFiles("image", file);
        form.submit();
      });
      return c.json(200, { saved: true });
    }
    if (action === "delete") {
      dao.deleteRecord(record);
      return c.json(200, { deleted: true });
    }
    let token = "";
    dao.runInTransaction(function (tx) {
      lock(tx, record.id);
      const current = findOwned(c, context, tx);
      const dealer = tx.findRecordById("dealers", context.dealer.id);
      if (action === "finish") {
        if (current.getString("state") !== "uploading") throw new Error("IMMUTABLE");
        const frames = frameRecords(tx, current);
        if (
          frames.length !== current.getInt("frame_count") ||
          frames.some(function (r, i) {
            return r.getInt("angle") !== i || !r.getString("image");
          })
        )
          throw new Error("INCOMPLETE");
        current.set("state", policyState(current, dealer));
      } else if (action === "review") {
        if (!manager(context)) throw new Error("MANAGER");
        const body = $apis.requestInfo(c).data;
        if (
          ["pending", "n_a"].indexOf(current.getString("state")) < 0 ||
          ["approved", "rejected"].indexOf(body.decision) < 0 ||
          body.reviewedAllAngles !== true
        )
          throw new Error("REVIEW");
        const note = text(body.note || "", 400, false);
        if (note === null || (body.decision === "rejected" && !note))
          throw new Error("REVIEW");
        if (body.decision === "approved" && !compliance(current, dealer))
          throw new Error("COMPLIANCE");
        current.set("state", body.decision);
        current.set("reviewed_by", context.person.id);
        current.set("review_note", note);
      } else if (action === "share" || action === "export") {
        if (!deliverable(current, dealer)) throw new Error("APPROVAL");
        if (action === "share") {
          token =
            current.getString("link_token") ||
            helpers.secureRandomString(48, "0123456789abcdef");
          current.set("link_token", token);
        }
      } else if (action === "revoke") current.set("link_token", "");
      else throw new Error("UNKNOWN_ACTION");
      tx.saveRecord(current);
    });
    return c.json(
      200,
      serialize(dao.findRecordById("vehicle_spins", record.id), context.dealer, true),
    );
  } catch (error) {
    if (require(__hooks + "/mediaStorage.js").respondIfLimited(c, error)) return;
    const message = (error && error.message) || "";
    const messages = {
      STORAGE:
        "Storage is nearly full. Delete an older spin or ask your administrator to add space before retrying.",
      PERSON_QUOTA:
        "You have 10 saved spins. Delete an older spin before saving another.",
      DEALER_QUOTA:
        "Your dealership has 30 saved spins. Ask a manager to remove an older vehicle view.",
      FLEET_QUOTA:
        "The vehicle-view service has reached its storage allowance. Contact your administrator before saving another.",
      IMMUTABLE:
        "This spin is already submitted. Create a new spin to change its frames or facts.",
      INCOMPLETE: "Some angles are missing. Finish uploading before submitting.",
      MANAGER: "A dealership manager must review this spin.",
      REVIEW:
        "Review all angles and choose an approval decision. Rejections need a reason.",
      APPROVAL: "This spin needs manager approval before sharing or exporting.",
      COMPLIANCE: "Vehicle text no longer meets dealership posting rules.",
    };
    if (message === "NOT_FOUND") return c.json(404, { error: "Spin not found" });
    if (messages[message])
      return c.json(message === "MANAGER" || message === "APPROVAL" ? 403 : 409, {
        error: messages[message],
      });
    return c.json(action === "upload" || action === "create" ? 400 : 404, {
      error:
        action === "upload"
          ? "This angle could not be saved. Use a JPEG below 500 KB; existing angles cannot be replaced."
          : "Spin not available. Refresh and try again.",
    });
  }
}

function publicRead(c, frame) {
  headers(c);
  const helpers = require(__hooks + "/helpers.js");
  const limit = helpers.checkProxyRateLimit(
    "vehicle-spin-public:" + helpers.clientIP(c),
    300,
    60000,
    { ipKeyed: true },
  );
  if (!limit.ok)
    return c.json(429, { error: "Please wait before reopening this view." });
  // A header keeps capability tokens out of HTTP paths, access logs and referrers.
  const token = c.request().header.get("X-Vehicle-Spin");
  if (!/^[a-f0-9]{48}$/.test(token || ""))
    return c.json(404, { error: "This vehicle view is unavailable." });
  try {
    const record = $app
      .dao()
      .findFirstRecordByFilter("vehicle_spins", "link_token = {:token}", {
        token: token,
      });
    const dealer = $app.dao().findRecordById("dealers", record.getString("dealer"));
    if (!deliverable(record, dealer))
      return c.json(404, { error: "This vehicle view is unavailable." });
    if (frame) return sendFrame(c, record, Number(c.pathParam("angle")));
    return c.json(200, serialize(record, dealer, false));
  } catch (_e) {
    return c.json(404, { error: "This vehicle view is unavailable." });
  }
}

module.exports = {
  handle,
  publicRead,
  normalizeVehicle,
  stateAllowsDelivery,
  owner,
  storageHasRoom,
  capacity,
  adminCapacity,
};
