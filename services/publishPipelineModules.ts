// Implementation barrel for the lazily loaded publish/compliance pipeline.
// Everything re-exported here is deliberately kept OUT of the boot-critical
// entry chunk; load it through loadPublishPipeline() in
// services/publishPipeline.ts (memoized, reset-on-failure) rather than
// importing this module statically from anything the login screen boots.
export { logPost } from "./posts";
export {
  analyzeCaptionSetForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";
export { linkReleaseToPost, runWithPersistedPhotoRelease } from "./photoReleases";
export {
  parsePlatformCaptionPack,
  platformsToCaptionPackBrief,
  resolvePrimaryImageProfile,
  shouldGenerateCaptionPack,
} from "./platformCopy";
export { EXPORT_FORMATS, renderFormat } from "../utils/multiFormatExport";
export { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";
export { toPublicCustomerLabel } from "../utils/customerIdentity";
export {
  buildFallbackWebsiteDraft,
  buildFinalWebsiteDraftFallback,
  buildFinalWebsiteDraftPrompt,
  buildWebsiteDraftPrompt,
  parseFinalWebsiteDraftResponse,
  parseWebsiteDraftResponse,
} from "./websitePublishing";
