/** One safe projection for list, detail and search. Never search raw customer copy. */
function projectRecords(page, dealer, helpers, policies, dao) {
  const allowedPlatformIds = helpers.allowedPostPlatformIds();
  const expectedAspectByFormat = {
    feed_portrait: "4:5",
    feed_square: "1:1",
    story_vertical: "9:16",
    marketplace: "16:9",
    gbp: "4:3",
  };
  const websitePublications = require(__hooks + "/websitePublications.js");
  const currentModelPolicy = policies.geminiModelPolicySnapshot();
  const websitePublicationByPost = websitePublications.publicationSummariesForPosts(
    dao,
    dealer.id,
    page.map((record) => record.id),
  );
  // Derived "Shared · Facebook" summary per post from post_share_events.
  // The route that writes them keeps at most 20 per post, so this read is
  // bounded by the page size. Ids are bound one placeholder each (dbx
  // rejects a JS array inside IN()), in chunks well under SQLite's limit.
  // A failed read leaves every summary null rather than failing the list.
  const shareSummaryByPost = {};
  try {
    const pagePostIds = page.map((r) => r.id);
    for (let start = 0; start < pagePostIds.length; start += 200) {
      const chunk = pagePostIds.slice(start, start + 200);
      const shareParams = { dealer: dealer.id };
      const placeholders = chunk.map((id, index) => {
        shareParams["post" + index] = id;
        return "{:post" + index + "}";
      });
      const shareRows = arrayOf(
        new DynamicModel({ post: "", channel: "", via: "", created: "" }),
      );
      dao
        .db()
        .newQuery(
          "SELECT post, channel, via, created FROM post_share_events " +
            "WHERE dealer = {:dealer} AND post IN (" +
            placeholders.join(", ") +
            ") ORDER BY created DESC, id DESC",
        )
        .bind(shareParams)
        .all(shareRows);
      for (let i = 0; i < shareRows.length; i++) {
        const postId = (shareRows[i].post || "").toString();
        const shareChannel = (shareRows[i].channel || "").toString();
        if (!postId || !shareChannel) continue;
        let summary = shareSummaryByPost[postId];
        if (!summary) {
          // Rows arrive newest first, so the first row seen is the latest.
          summary = {
            count: 0,
            last_shared_at: (shareRows[i].created || "").toString(),
            last_channel: shareChannel,
            last_via: (shareRows[i].via || "").toString(),
            channels: [],
            // Only a completed share sheet may be labelled "Shared"; a
            // download or a copied caption is not one. Kept apart from the
            // latest event so a later copy cannot hide an earlier share.
            sheet_count: 0,
            last_sheet_channel: "",
            last_sheet_at: "",
          };
          shareSummaryByPost[postId] = summary;
        }
        summary.count += 1;
        if (summary.channels.indexOf(shareChannel) === -1) {
          summary.channels.push(shareChannel);
        }
        if ((shareRows[i].via || "").toString() === "share_sheet") {
          if (summary.sheet_count === 0) {
            summary.last_sheet_channel = shareChannel;
            summary.last_sheet_at = (shareRows[i].created || "").toString();
          }
          summary.sheet_count += 1;
        }
      }
    }
  } catch (err) {
    console.error("[/api/app/posts] share summary error", err);
  }
  const items = page.map((r) => {
    let platformIds = [];
    const storedPlatformIdsRaw = r.getString("platform_ids");
    try {
      const parsed = JSON.parse(storedPlatformIdsRaw || "[]");
      if (Array.isArray(parsed)) {
        platformIds = parsed.filter(
          (id, index) =>
            typeof id === "string" &&
            allowedPlatformIds.indexOf(id) !== -1 &&
            parsed.indexOf(id) === index,
        );
      }
    } catch (_e) {}
    const parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
      r.getString("platform_captions"),
      allowedPlatformIds,
      platformIds,
    );
    const storedPrimaryFormatId = r.getString("primary_format_id");
    const storedImageAspectRatio = r.getString("image_aspect_ratio");
    const hasValidOutputProfile =
      !!storedPrimaryFormatId &&
      expectedAspectByFormat[storedPrimaryFormatId] === storedImageAspectRatio;
    const primaryFormatId = hasValidOutputProfile ? storedPrimaryFormatId : "";
    const imageAspectRatio = hasValidOutputProfile ? storedImageAspectRatio : "";
    const storedWebsiteDraft = websitePublications.parseWebsiteDraft(
      r.getString("website_draft"),
    );
    const protectedCustomerName = r.getString("customer_name");
    const publicCustomerName =
      websitePublications.publicCustomerLabel(protectedCustomerName);
    const rawPlatformCaptions = parsedPlatformCaptions.ok
      ? parsedPlatformCaptions.value
      : {};
    const platformCaptionIds = Object.keys(rawPlatformCaptions);
    const rawWebsiteDraft =
      storedWebsiteDraft.ok &&
      storedWebsiteDraft.value &&
      storedWebsiteDraft.value.enabled
        ? storedWebsiteDraft.value
        : null;
    const allowedIdentityPhrases = [
      websitePublications.groundedIdentityPhrase(dealer.getString("name")),
      websitePublications.groundedIdentityPhrase(dealer.getString("oem_affiliation")),
      r.getString("salesperson_name"),
      websitePublications.publicCustomerLabel(r.getString("salesperson_name")),
      websitePublications.groundedIdentityPhrase(
        rawWebsiteDraft
          ? websitePublications.groundedVehicleIdentityPhrase(
              rawWebsiteDraft.vehicleDescription || "",
            )
          : "",
      ),
    ];
    const reviewValue = function (value) {
      return policies.reviewCustomerIdentityExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
        protectedCustomerName,
        [(value || "").toString()],
        allowedIdentityPhrases,
        (r.getBool ? r.getBool("release_required") : !!r.get("release_required")) &&
          !publicCustomerName,
      );
    };
    let identityReviewRequired = false;
    const captionReview = reviewValue(r.getString("caption"));
    if (captionReview.reviewRequired) identityReviewRequired = true;
    const publicCaption = captionReview.unexpectedIdentity
      ? "Caption held for customer-name review."
      : captionReview.projectedValues[0] || "";
    const disclosureReview = reviewValue(r.getString("disclosures"));
    if (disclosureReview.reviewRequired) identityReviewRequired = true;
    const publicDisclosures = disclosureReview.unexpectedIdentity
      ? "Disclosure held for customer-name review."
      : disclosureReview.projectedValues[0] || "";
    const publicPlatformCaptions = {};
    for (let i = 0; i < platformCaptionIds.length; i++) {
      const platformReview = reviewValue(rawPlatformCaptions[platformCaptionIds[i]]);
      if (platformReview.reviewRequired) {
        identityReviewRequired = true;
      }
      if (platformReview.unexpectedIdentity) {
        continue;
      }
      publicPlatformCaptions[platformCaptionIds[i]] =
        platformReview.projectedValues[0] || "";
    }
    let publicWebsiteDraft = null;
    if (rawWebsiteDraft) {
      const normalizedWebsiteLabel = (rawWebsiteDraft.customerDisplayName || "")
        .toString()
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      const normalizedProtectedName = protectedCustomerName
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      const websiteLabelSafe = rawWebsiteDraft.customerDisplayName
        ? websitePublications.releaseAuthorizesPublicCustomerLabel(
            protectedCustomerName,
            rawWebsiteDraft.customerDisplayName,
          ) ||
          (!!protectedCustomerName &&
            normalizedWebsiteLabel === normalizedProtectedName)
        : rawWebsiteDraft.kind !== "customer_story" || !!publicCustomerName;
      const websiteLabelNeedsProjection =
        !!rawWebsiteDraft.customerDisplayName &&
        !!protectedCustomerName &&
        normalizedWebsiteLabel === normalizedProtectedName &&
        normalizedWebsiteLabel !== publicCustomerName.toLowerCase();
      const titleReview = reviewValue(rawWebsiteDraft.title);
      const bodyReview = reviewValue(rawWebsiteDraft.body);
      const altReview = reviewValue(rawWebsiteDraft.altText);
      if (
        !websiteLabelSafe ||
        websiteLabelNeedsProjection ||
        titleReview.reviewRequired ||
        bodyReview.reviewRequired ||
        altReview.reviewRequired ||
        titleReview.unexpectedIdentity ||
        bodyReview.unexpectedIdentity ||
        altReview.unexpectedIdentity
      ) {
        identityReviewRequired = true;
      } else {
        publicWebsiteDraft = Object.assign({}, rawWebsiteDraft, {
          title: titleReview.projectedValues[0] || "",
          body: bodyReview.projectedValues[0] || "",
          altText: altReview.projectedValues[0] || "",
        });
        if (rawWebsiteDraft.kind === "customer_story" && publicCustomerName) {
          publicWebsiteDraft.customerDisplayName = publicCustomerName;
        } else {
          delete publicWebsiteDraft.customerDisplayName;
        }
      }
    }
    const imageReviewRequired = policies.postImageReviewRequired(r, currentModelPolicy);
    const websitePublication = websitePublicationByPost[r.id]
      ? websitePublicationByPost[r.id]
      : websitePublications.publicationSummaryForPost(r, null);
    if (imageReviewRequired) {
      websitePublication.reviewUrl = "";
      websitePublication.lastError = "image_review_required";
    }
    return {
      id: r.id,
      dealer: r.getString("dealer"),
      salesperson_name: r.getString("salesperson_name"),
      salesperson_id: r.getString("salesperson_id"),
      owner_person_id: r.getString("owner_person_id"),
      attribution_authoritative: r.getBool
        ? r.getBool("attribution_authoritative")
        : !!r.get("attribution_authoritative"),
      generated_at: r.getString("generated_at"),
      // The compare-and-set token a reopened post must send with its next
      // draft save or share receipt; without it the editor is read-only.
      updated: r.getString("updated"),
      style: r.getString("style"),
      tone: r.getString("tone"),
      customer_name: publicCustomerName,
      scenario_id: r.getString("scenario_id"),
      vin: r.getString("vin"),
      has_release: r.getBool ? r.getBool("has_release") : !!r.get("has_release"),
      release_required: r.getBool
        ? r.getBool("release_required")
        : !!r.get("release_required"),
      release_status: r.getString("release_status"),
      has_video: r.getBool ? r.getBool("has_video") : !!r.get("has_video"),
      approval_status: r.getString("approval_status"),
      approved_by: r.getString("approved_by"),
      rejection_reason: r.getString("rejection_reason"),
      approved_at: r.getString("approved_at"),
      caption: publicCaption,
      caption_source:
        ["ai", "custom", "basic_fallback"].indexOf(r.getString("caption_source")) !== -1
          ? r.getString("caption_source")
          : null,
      disclosures: publicDisclosures,
      // Blank is a legacy unknown selection; explicit stored `[]` is the
      // intentional Website-only choice and must survive History restore.
      platform_ids: storedPlatformIdsRaw.trim() ? platformIds : undefined,
      media_output_mode:
        ["photo", "video", "both"].indexOf(r.getString("media_output_mode")) !== -1
          ? r.getString("media_output_mode")
          : "photo",
      platform_captions: publicPlatformCaptions,
      primary_format_id: primaryFormatId,
      image_aspect_ratio: imageAspectRatio,
      scheduled_for: r.getString("scheduled_for"),
      creative_image_url: r.getString("creative_image")
        ? `/api/app/posts/${r.id}/creative-image`
        : "",
      website_draft: publicWebsiteDraft,
      identity_review_required: identityReviewRequired || undefined,
      image_review_required: imageReviewRequired || undefined,
      website_publication: websitePublication,
      share_summary: shareSummaryByPost[r.id] || null,
    };
  });

  return items;
}
module.exports = { projectRecords };
