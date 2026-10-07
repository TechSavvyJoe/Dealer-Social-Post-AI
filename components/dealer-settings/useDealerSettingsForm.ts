import React, { useEffect, useMemo, useState } from "react";
import * as db from "../../services/database";
import { toUiMessage } from "../../utils/errorMessages";
import { serializeHours, type WeekHours } from "../../utils/hoursFormat";
import {
  type BrandCategoryId,
  type CategoryDestinations,
  type Dealer,
  type FeaturePermissions,
  type ImageQualityTier,
  type LogoCorner,
  type LogoPlacement,
  type MotionAspect,
  type MotionAudio,
  type MotionSignature,
  type SignatureLook,
} from "../../types";
import { styles as motionStyleOptions } from "../video-director/constants";
import {
  BRAND_VOICE_MAX_CHARS,
  BRAND_VOICE_MAX_ITEMS,
  DEFAULT_MOTION_ASPECTS,
  DEFAULT_MOTION_AUDIO,
  HEX_RE,
  LOGO_SCALE_DEFAULT,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  MOTION_STYLE_MAX_CHARS,
  SIGNATURE_LOOK_OPTIONS,
  deriveEnabledStyles,
  deriveHoursWeek,
  dirtySections,
  draftDealer,
  isLogoCorner,
  isMotionAspect,
  isMotionAudio,
  isSignatureLook,
  orderCategories,
  readReviewChoice,
  savedFormValues,
  storedTextValues,
  toApprovalPolicy,
  type ReviewChoice,
  type SettingsFormValues,
} from "./settingsModel";

export type SettingsSave = (
  fields: Record<string, string | boolean>,
) => Promise<unknown>;

/**
 * All of the Dealership settings form's state, its dirty check per section,
 * the live draft the sample post reads, and Save. One form, one save: the
 * sections are views over this one state.
 *
 * The state, the validation and `handleSave` are the settings card's own,
 * moved here unchanged, so the PATCH body for a given set of edits is
 * byte-for-byte what it was.
 */
export const useDealerSettingsForm = (dealer: Dealer, onSaved: SettingsSave) => {
  // Voice / brand
  const [voice, setVoice] = useState(dealer.brand_voice || "");
  const [voiceDo, setVoiceDo] = useState<string[]>(() =>
    (dealer.brand_voice_do || []).slice(0, BRAND_VOICE_MAX_ITEMS),
  );
  const [voiceDont, setVoiceDont] = useState<string[]>(() =>
    (dealer.brand_voice_dont || []).slice(0, BRAND_VOICE_MAX_ITEMS),
  );

  // Brand kit (spec §4.1–§4.3)
  const [signatureLook, setSignatureLook] = useState<SignatureLook | "">(() =>
    isSignatureLook(dealer.signature_look) ? dealer.signature_look : "",
  );
  const [alternateLook, setAlternateLook] = useState<SignatureLook | "">(() =>
    isSignatureLook(dealer.alternate_look) ? dealer.alternate_look : "",
  );
  const [hashtagsLocked, setHashtagsLocked] = useState(
    !!dealer.required_hashtags_locked,
  );
  const [playfulStyle, setPlayfulStyle] = useState(dealer.playful_style || "");
  const [motionStyle, setMotionStyle] = useState(dealer.motion_signature?.style || "");
  const [motionAspects, setMotionAspects] = useState<MotionAspect[]>(() => {
    const saved = (dealer.motion_signature?.aspects || []).filter(isMotionAspect);
    return saved.length > 0 ? saved : DEFAULT_MOTION_ASPECTS;
  });
  const [motionAudio, setMotionAudio] = useState<MotionAudio>(() =>
    isMotionAudio(dealer.motion_signature?.audio)
      ? dealer.motion_signature.audio
      : DEFAULT_MOTION_AUDIO,
  );
  const [logoCorner, setLogoCorner] = useState<LogoCorner | "">(() =>
    isLogoCorner(dealer.logo_placement?.corner) ? dealer.logo_placement.corner : "",
  );
  const [logoScale, setLogoScale] = useState<number>(() => {
    const saved = dealer.logo_placement?.scale;
    return typeof saved === "number" && Number.isFinite(saved)
      ? Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, saved))
      : LOGO_SCALE_DEFAULT;
  });
  const [imageQualityTier, setImageQualityTier] = useState<ImageQualityTier | "">(
    dealer.image_quality_tier === "standard" || dealer.image_quality_tier === "studio"
      ? dealer.image_quality_tier
      : "",
  );
  const [banned, setBanned] = useState(dealer.banned_phrases || "");
  const [color, setColor] = useState(dealer.brand_color || "");
  const [oem, setOem] = useState(dealer.oem_affiliation || "");
  const [approval, setApproval] = useState(!!dealer.requires_approval);
  const [reviewChoice, setReviewChoice] = useState<ReviewChoice>(() =>
    readReviewChoice(!!dealer.requires_approval, dealer.approval_policy),
  );
  // What is typed in the first-posts count while the field is being edited.
  // It may be empty or out of range; the saved choice keeps the last valid,
  // clamped number, and the field shows that again on blur.
  const [firstNDraft, setFirstNDraft] = useState<string | null>(null);
  const [categoryDestinations, setCategoryDestinations] =
    useState<CategoryDestinations | null>(dealer.category_destinations ?? null);
  const [featurePermissions, setFeaturePermissions] =
    useState<FeaturePermissions | null>(dealer.feature_permissions ?? null);
  // Opt-OUT semantics: the stored field is `disabled`, so unset keeps the
  // disclosure on. The control is phrased positively for the manager.
  const [disclosureOn, setDisclosureOn] = useState(
    !dealer.employee_disclosure_disabled,
  );
  const [disclosureText, setDisclosureText] = useState(
    dealer.employee_disclosure_text || "",
  );

  // Contact + identity
  const [website, setWebsite] = useState(dealer.website || "");
  const [phone, setPhone] = useState(dealer.phone || "");
  const [address, setAddress] = useState(dealer.address || "");
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(() =>
    deriveHoursWeek(dealer.hours),
  );
  const hoursSerialized = serializeHours(hoursWeek);
  const [tagline, setTagline] = useState(dealer.tagline || "");

  // Social
  const [facebookUrl, setFacebookUrl] = useState(dealer.facebook_url || "");
  const [facebookPageTag, setFacebookPageTag] = useState(
    dealer.facebook_page_tag || "",
  );
  const [instagramHandle, setInstagramHandle] = useState(dealer.instagram_handle || "");
  const [tiktokHandle, setTiktokHandle] = useState(dealer.tiktok_handle || "");
  const [xHandle, setXHandle] = useState(dealer.x_handle || "");
  const [linkedinCompanyTag, setLinkedinCompanyTag] = useState(
    dealer.linkedin_company_tag || "",
  );
  const [gbpUrl, setGbpUrl] = useState(dealer.gbp_url || "");

  // Generation defaults
  const [defaultHashtags, setDefaultHashtags] = useState(dealer.default_hashtags || "");
  const [defaultFooter, setDefaultFooter] = useState(dealer.default_footer || "");

  // Overlay preferences
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(() =>
    deriveEnabledStyles(dealer.enabled_styles),
  );
  const [defaultStyle, setDefaultStyle] = useState(dealer.default_style || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const enabledStylesStr = Array.from(enabledStyles).join(",");

  // Structured brand fields compare by their canonical JSON so an untouched
  // form (including "not set" → null) never reads as dirty.
  const currentMotionSignature: MotionSignature | null = motionStyle
    ? { style: motionStyle, aspects: motionAspects, audio: motionAudio }
    : null;
  const currentLogoPlacement: LogoPlacement | null = logoCorner
    ? { corner: logoCorner, scale: Math.round(logoScale * 1000) / 1000 }
    : null;
  const savedLook: SignatureLook | "" = isSignatureLook(dealer.signature_look)
    ? dealer.signature_look
    : "";
  const approvalPolicy = toApprovalPolicy(approval, reviewChoice);

  const values: SettingsFormValues = {
    website,
    phone,
    address,
    hours: hoursSerialized,
    tagline,
    oem,
    facebookUrl,
    facebookPageTag,
    instagramHandle,
    tiktokHandle,
    xHandle,
    linkedinCompanyTag,
    gbpUrl,
    voice,
    voiceDo,
    voiceDont,
    defaultHashtags,
    hashtagsLocked,
    defaultFooter,
    banned,
    signatureLook,
    alternateLook,
    playfulStyle,
    color,
    logoPlacement: currentLogoPlacement,
    motionSignature: currentMotionSignature,
    imageQualityTier,
    enabledStyles: enabledStylesStr,
    defaultStyle,
    approval,
    approvalPolicy,
    disclosureOn,
    disclosureText,
    featurePermissions,
    categoryDestinations,
  };

  const saved = useMemo(() => savedFormValues(dealer), [dealer]);
  const sectionsDirty = dirtySections(values, saved);
  const dirty = Object.values(sectionsDirty).some(Boolean);

  // One memo over the form state: the sample post reads exactly what Save
  // would store, never a second copy of the rules. `values` is a new object
  // each render, so the memo keys on its JSON, which changes exactly when a
  // value does.
  const valuesKey = JSON.stringify(values);
  const draft = useMemo(() => draftDealer(dealer, values), [dealer, valuesKey]);

  const toggleStyle = (id: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultStyle === id) setDefaultStyle("");
      } else {
        next.add(id);
      }
      if (next.size === 0) next.add(id);
      return next;
    });
  };

  const selectLook = (next: SignatureLook) => {
    setSignatureLook(next);
    // The second Look is "a second look", so it can never equal the house look.
    if (alternateLook === next) setAlternateLook("");
  };

  const toggleMotionAspect = (aspect: MotionAspect) => {
    setMotionAspects((prev) =>
      prev.includes(aspect)
        ? prev.filter((item) => item !== aspect)
        : [...prev, aspect],
    );
  };

  const toggleReviewCategory = (category: BrandCategoryId) => {
    setReviewChoice((current) => {
      const checked = current.categories.includes(category);
      // At least one post type stays checked; an empty list would review
      // every post, which is what "Every post" is for.
      if (checked && current.categories.length === 1) return current;
      return {
        ...current,
        categories: orderCategories(
          checked
            ? current.categories.filter((id) => id !== category)
            : [...current.categories, category],
        ),
      };
    });
  };

  const selectedLookOption = SIGNATURE_LOOK_OPTIONS.find(
    (option) => option.id === signatureLook,
  );
  const suggestedMotionStyle = selectedLookOption
    ? motionStyleOptions.find(
        (option) => option.style === selectedLookOption.motionStyle,
      )
    : undefined;

  const validateBrandFields = (): string | null => {
    if (signatureLook && alternateLook && alternateLook === signatureLook) {
      return "The second Look must differ from the signature Look.";
    }
    for (const list of [voiceDo, voiceDont]) {
      if (list.length > BRAND_VOICE_MAX_ITEMS) {
        return `Brand voice lists may hold up to ${BRAND_VOICE_MAX_ITEMS} phrases.`;
      }
      if (list.some((phrase) => phrase.length > BRAND_VOICE_MAX_CHARS)) {
        return `Brand voice phrases must be ${BRAND_VOICE_MAX_CHARS} characters or fewer.`;
      }
    }
    if (motionStyle) {
      if (motionStyle.length > MOTION_STYLE_MAX_CHARS) {
        return "Choose a motion style from the list.";
      }
      if (motionAspects.length === 0) {
        return "Pick at least one video aspect for the motion signature.";
      }
    }
    if (
      logoCorner &&
      (!Number.isFinite(logoScale) ||
        logoScale < LOGO_SCALE_MIN ||
        logoScale > LOGO_SCALE_MAX)
    ) {
      return `Logo size must be between ${Math.round(LOGO_SCALE_MIN * 100)}% and ${Math.round(
        LOGO_SCALE_MAX * 100,
      )}% of the image width.`;
    }
    return null;
  };

  const handleSave = async () => {
    setError(null);
    if (color && !HEX_RE.test(color.trim())) {
      setError("Store color should be a hex value like #1d4ed8.");
      return;
    }
    const brandProblem = validateBrandFields();
    if (brandProblem) {
      setError(brandProblem);
      return;
    }
    setSaving(true);
    try {
      // The approval policy is always sent, already normalised: null whenever
      // review is off or covers every post, so the stored value can never
      // disagree with what this form shows. Category destinations and feature
      // permissions are sent only when they changed, so a save that does not
      // touch them leaves the stored value (including any per-person entries)
      // exactly as it is.
      const brandFields = db.encodeDealerBrandFields({
        signature_look: signatureLook,
        alternate_look: alternateLook,
        ...(signatureLook !== savedLook
          ? { default_tone: selectedLookOption?.tone || "" }
          : {}),
        brand_voice_do: voiceDo,
        brand_voice_dont: voiceDont,
        required_hashtags_locked: hashtagsLocked,
        playful_style: playfulStyle,
        motion_signature: currentMotionSignature,
        logo_placement: currentLogoPlacement,
        image_quality_tier: imageQualityTier,
        approval_policy: approvalPolicy,
        ...(JSON.stringify(categoryDestinations) !==
        JSON.stringify(dealer.category_destinations ?? null)
          ? { category_destinations: categoryDestinations }
          : {}),
        ...(JSON.stringify(featurePermissions) !==
        JSON.stringify(dealer.feature_permissions ?? null)
          ? { feature_permissions: featurePermissions }
          : {}),
      });
      // The exact text values that will be stored. After the save the form is
      // re-based onto these, so trimmed or normalised input never leaves the
      // card reporting a phantom unsaved change.
      const stored = storedTextValues(values);
      const fields: Record<string, string | boolean> = {
        ...brandFields,
        brand_voice: stored.voice,
        banned_phrases: stored.banned,
        brand_color: stored.color,
        oem_affiliation: stored.oem,
        requires_approval: approval,
        employee_disclosure_disabled: !disclosureOn,
        employee_disclosure_text: stored.disclosureText,
        website: stored.website,
        phone: stored.phone,
        address: stored.address,
        hours: hoursSerialized,
        tagline: stored.tagline,
        facebook_url: stored.facebookUrl,
        facebook_page_tag: stored.facebookPageTag,
        instagram_handle: stored.instagramHandle,
        tiktok_handle: stored.tiktokHandle,
        x_handle: stored.xHandle,
        linkedin_company_tag: stored.linkedinCompanyTag,
        gbp_url: stored.gbpUrl,
        default_hashtags: stored.defaultHashtags,
        default_footer: stored.defaultFooter,
        enabled_styles: enabledStylesStr,
        default_style: defaultStyle,
      };
      await onSaved(fields);
      // Re-base only a field that still holds the value that was submitted:
      // anything typed while the save was in flight stays as typed (and the
      // form stays dirty), rather than being replaced by the saved snapshot.
      const rebase = (
        set: React.Dispatch<React.SetStateAction<string>>,
        submitted: string,
        savedValue: string,
      ) => set((current) => (current === submitted ? savedValue : current));
      rebase(setVoice, voice, stored.voice);
      rebase(setBanned, banned, stored.banned);
      rebase(setColor, color, stored.color);
      rebase(setOem, oem, stored.oem);
      rebase(setDisclosureText, disclosureText, stored.disclosureText);
      rebase(setWebsite, website, stored.website);
      rebase(setPhone, phone, stored.phone);
      rebase(setAddress, address, stored.address);
      rebase(setTagline, tagline, stored.tagline);
      rebase(setFacebookUrl, facebookUrl, stored.facebookUrl);
      rebase(setFacebookPageTag, facebookPageTag, stored.facebookPageTag);
      rebase(setInstagramHandle, instagramHandle, stored.instagramHandle);
      rebase(setTiktokHandle, tiktokHandle, stored.tiktokHandle);
      rebase(setXHandle, xHandle, stored.xHandle);
      rebase(setLinkedinCompanyTag, linkedinCompanyTag, stored.linkedinCompanyTag);
      rebase(setGbpUrl, gbpUrl, stored.gbpUrl);
      rebase(setDefaultHashtags, defaultHashtags, stored.defaultHashtags);
      rebase(setDefaultFooter, defaultFooter, stored.defaultFooter);
      setSavedAt(new Date());
    } catch (err) {
      setError(toUiMessage(err, "Could not save these settings."));
    } finally {
      setSaving(false);
    }
  };

  return {
    values,
    sectionsDirty,
    dirty,
    draft,
    saving,
    error,
    savedAt,
    handleSave,
    // Store profile
    setWebsite,
    setPhone,
    setAddress,
    hoursWeek,
    setHoursWeek,
    setTagline,
    setOem,
    // Channels
    setFacebookUrl,
    setFacebookPageTag,
    setInstagramHandle,
    setTiktokHandle,
    setXHandle,
    setLinkedinCompanyTag,
    setGbpUrl,
    // Voice
    setVoice,
    setVoiceDo,
    setVoiceDont,
    setDefaultHashtags,
    setHashtagsLocked,
    setDefaultFooter,
    setBanned,
    // Creative
    selectLook,
    setAlternateLook,
    setPlayfulStyle,
    setColor,
    logoCorner,
    setLogoCorner,
    logoScale,
    setLogoScale,
    motionStyle,
    setMotionStyle,
    motionAspects,
    toggleMotionAspect,
    motionAudio,
    setMotionAudio,
    setImageQualityTier,
    enabledStyleSet: enabledStyles,
    toggleStyle,
    setDefaultStyle,
    selectedLookOption,
    suggestedMotionStyle,
    // Workflow
    setApproval,
    reviewChoice,
    setReviewChoice,
    firstNDraft,
    setFirstNDraft,
    toggleReviewCategory,
    setDisclosureOn,
    setDisclosureText,
    setFeaturePermissions,
    setCategoryDestinations,
  };
};

export type DealerSettingsForm = ReturnType<typeof useDealerSettingsForm>;

/** Report the form's dirty state to the dashboard (and from there to the app). */
export const useReportDirty = (
  dirty: boolean,
  onDirtyChange: (dirty: boolean) => void,
) => {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
};
