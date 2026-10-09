const FIELDS = [
  "salesperson_name",
  "salesperson_id",
  "style",
  "tone",
  "customer_name",
  "scenario_id",
  "vin",
  "has_release",
  "has_video",
  "caption_source",
  "generation_tier",
  "generation_model",
  "generation_fallback_count",
  "generation_last_success_at",
  "model_policy_version",
  "caption_attempt_id",
  "image_attempt_id",
  "platform_ids",
  "media_output_mode",
  "platform_captions",
  "primary_format_id",
  "image_aspect_ratio",
  "scheduled_for",
  "website_draft",
  "caption",
  "disclosures",
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const result = {};
    Object.keys(value)
      .sort()
      .forEach(function (key) {
        result[key] = canonical(value[key]);
      });
    return result;
  }
  return value;
}
function requestText(body) {
  return FIELDS.map(function (name) {
    let value = body[name] == null ? "" : String(body[name]);
    if (
      ["platform_ids", "platform_captions", "website_draft"].indexOf(name) !== -1 &&
      value
    ) {
      try {
        value = JSON.stringify(canonical(JSON.parse(value)));
      } catch (_e) {}
    }
    return [name, value];
  });
}
function validOperation(value) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(String(value || ""));
}
function failure(code, status, message) {
  const error = new Error(message);
  error.postSaveCode = code;
  error.postSaveStatus = status;
  return error;
}
function fingerprint(body, creativeFile, creativeMime) {
  let media = "";
  if (creativeFile) {
    let reader = null;
    try {
      reader = creativeFile.reader.open();
      media = require(__hooks + "/websitePublications.js").base64EncodeReader(
        reader,
        Number(creativeFile.size),
      );
    } finally {
      if (reader) reader.close();
    }
  }
  return $security.sha256(
    JSON.stringify([
      requestText(body),
      $security.sha256(media),
      creativeFile
        ? [String(creativeFile.originalName), String(creativeMime || "")]
        : null,
    ]),
  );
}
function withFence(dao, dealerId, callback) {
  let result;
  dao.runInTransaction(function (tx) {
    const fence = tx
      .db()
      .newQuery("UPDATE dealers SET updated = updated WHERE id = {:dealer}")
      .bind({ dealer: dealerId })
      .execute();
    if (!fence || fence.rowsAffected() !== 1)
      throw new Error("post_save_dealer_missing");
    result = callback(tx);
  });
  return result;
}
function lookup(dao, dealerId, owner, operation, digest) {
  const row = new DynamicModel({ post_id: "", payload_digest: "", result_digest: "" });
  dao
    .db()
    .newQuery(
      "SELECT post_id, payload_digest, result_digest FROM _post_save_operations " +
        "WHERE dealer = {:dealer} AND owner_session_hash = {:owner} AND operation_id = {:operation}",
    )
    .bind({ dealer: dealerId, owner: owner, operation: operation })
    .one(row);
  if (row.payload_digest !== digest)
    throw failure(
      "POST_SAVE_PAYLOAD_CONFLICT",
      409,
      "This save operation belongs to a different generated result.",
    );
  const record = dao.findRecordById("posts", row.post_id);
  if (
    record.getString("dealer") !== dealerId ||
    record.getString("owner_session_hash") !== owner
  )
    throw failure(
      "POST_SAVE_OWNER_CONFLICT",
      409,
      "This saved result is unavailable in this workspace.",
    );
  if (!row.result_digest || row.result_digest !== resultDigest(record))
    throw failure(
      "POST_SAVE_RESULT_CHANGED",
      409,
      "This saved post changed after it was created. Open it from My work to load the current caption and image.",
    );
  return record;
}
function resultDigest(record) {
  return $security.sha256(
    JSON.stringify(
      [
        "caption",
        "disclosures",
        "platform_captions",
        "platform_ids",
        "media_output_mode",
        "primary_format_id",
        "image_aspect_ratio",
        "creative_image",
        "website_draft",
        "customer_name",
        "scenario_id",
        "vin",
      ].map(function (field) {
        return [field, record.getString(field)];
      }),
    ),
  );
}
function complete(dao, dealerId, owner, operation, record) {
  const result = dao
    .db()
    .newQuery(
      "UPDATE _post_save_operations SET result_digest = {:digest} " +
        "WHERE dealer = {:dealer} AND owner_session_hash = {:owner} AND operation_id = {:operation} AND post_id = {:post}",
    )
    .bind({
      digest: resultDigest(record),
      dealer: dealerId,
      owner: owner,
      operation: operation,
      post: record.id,
    })
    .execute();
  if (!result || result.rowsAffected() !== 1)
    throw new Error("post_save_completion_missing");
}
function find(dao, dealerId, owner, operation, digest) {
  // An absent operation is normal. Database errors must never become permission
  // to create another copy: only an explicitly empty query result is a miss.
  const rows = arrayOf(new DynamicModel({ post_id: "", payload_digest: "" }));
  dao
    .db()
    .newQuery(
      "SELECT post_id, payload_digest FROM _post_save_operations " +
        "WHERE dealer = {:dealer} AND owner_session_hash = {:owner} AND operation_id = {:operation}",
    )
    .bind({ dealer: dealerId, owner: owner, operation: operation })
    .all(rows);
  if (!rows.length) return null;
  return lookup(dao, dealerId, owner, operation, digest);
}
function reserve(dao, dealerId, owner, operation, digest, postId) {
  dao
    .db()
    .newQuery(
      "INSERT INTO _post_save_operations (dealer, owner_session_hash, operation_id, payload_digest, post_id) " +
        "VALUES ({:dealer}, {:owner}, {:operation}, {:digest}, {:post})",
    )
    .bind({
      dealer: dealerId,
      owner: owner,
      operation: operation,
      digest: digest,
      post: postId,
    })
    .execute();
}
function response(record, dealer) {
  const website = require(__hooks + "/websitePublications.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const parse = function (field, fallback) {
    try {
      return JSON.parse(record.getString(field) || "");
    } catch (_e) {
      return fallback;
    }
  };
  return {
    id: record.id,
    dealer: dealer.id,
    updated: record.getString("updated"),
    generated_at: record.getString("generated_at"),
    customer_name: website.publicCustomerLabel(record.getString("customer_name")),
    approval_status: record.getString("approval_status"),
    release_required: record.getBool("release_required"),
    release_status: record.getString("release_status"),
    platform_ids: parse("platform_ids", []),
    media_output_mode: record.getString("media_output_mode"),
    platform_captions: parse("platform_captions", {}),
    primary_format_id: record.getString("primary_format_id"),
    image_aspect_ratio: record.getString("image_aspect_ratio"),
    image_review_required:
      policies.postImageReviewRequired(record, policies.geminiModelPolicySnapshot()) ||
      undefined,
    website_draft: website.publicWebsiteDraftForPost(
      record,
      dealer.getString("name"),
      dealer.getString("oem_affiliation"),
    ).websiteDraft,
    website_publication: website.publicationSummaryForPost(
      record,
      website.findPublicationForPost(record.id),
    ),
  };
}
module.exports = {
  FIELDS,
  requestText,
  fingerprint,
  validOperation,
  failure,
  withFence,
  find,
  reserve,
  complete,
  response,
};
