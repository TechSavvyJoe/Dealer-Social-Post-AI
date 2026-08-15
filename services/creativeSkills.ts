import { StyleOption } from "../types";

/**
 * Runtime creative skills are deliberately data-only. The selector turns the
 * large caption brief into closed visual classes, then emits a small packet of
 * art-direction constraints for the image model. It never forwards customer
 * names, custom-scenario prose, contact details, hashtags, quotes, or prompt
 * instructions from the caption brief.
 */
export type CreativeMode = "regular" | "fun";

export type CreativeScenario =
  | "customer_delivery"
  | "preowned_spotlight"
  | "new_arrival"
  | "trade_in_spotlight"
  | "service_promotion"
  | "recall_complete"
  | "customer_testimonial"
  | "sold_by_salesperson"
  | "model_year_end"
  | "community_event"
  | "team_anniversary"
  | "test_drive_invite"
  | "custom"
  | "unknown";

export type CreativePhotoType =
  | "customer_vehicle"
  | "vehicle"
  | "service_customer_vehicle"
  | "service"
  | "customer_portrait"
  | "community_people"
  | "team_people"
  | "general";

export type CreativePlatformProfile =
  "vertical" | "feed" | "landscape" | "mixed" | "neutral";

export type CreativeVehicleClass = "truck" | "suv" | "car" | "van" | "ev" | "unknown";

export type CreativeStyleClass =
  | "luxury"
  | "modern"
  | "friendly"
  | "sporty"
  | "depth_pop"
  | "fun_transform"
  | "unknown";

export type CreativeSkillId =
  | "campaign_art_direction"
  | "photo_type_planning"
  | "regular_photo_fidelity"
  | "fun_transformation"
  | "environmental_3d_compositing"
  | "customer_dignity_identity"
  | "dealership_oem_brand_accuracy"
  | "platform_finishing"
  | "output_qa";

export interface ClassifiedCreativeBrief {
  hasSource: boolean;
  scenario: CreativeScenario;
  photoType: CreativePhotoType;
  platform: CreativePlatformProfile;
  vehicleClass: CreativeVehicleClass;
  hasVerifiedVehicleFacts: boolean;
  oemAffiliations: readonly string[];
  /** True means source prose was classified but intentionally not forwarded. */
  discardedFreeform: boolean;
}

export interface CreativeSkillContext extends ClassifiedCreativeBrief {
  mode: CreativeMode;
  styleClass: CreativeStyleClass;
  hasLogo: boolean;
}

export interface CreativeSkillSelectionInput {
  mode: CreativeMode;
  style: StyleOption | string;
  hasLogo: boolean;
  creativeBrief?: string;
}

export interface CreativeSkillModule {
  id: CreativeSkillId;
  title: string;
  applies: (context: CreativeSkillContext) => boolean;
  instructions: (context: CreativeSkillContext) => readonly string[];
}

export interface CreativeSkillPacket {
  context: CreativeSkillContext;
  skillIds: readonly CreativeSkillId[];
  prompt: string;
  safeBrief: string;
}

interface ScenarioDefinition {
  id: Exclude<CreativeScenario, "custom" | "unknown">;
  label: string;
  aliases: readonly string[];
  photoType: CreativePhotoType;
  campaignDirection: string;
}

const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = [
  {
    id: "customer_delivery",
    label: "Customer delivery",
    aliases: ["customer delivery", "customer delivery photo"],
    photoType: "customer_vehicle",
    campaignDirection:
      "Celebrate the handoff and human joy; keep the real customer and purchased vehicle as co-heroes.",
  },
  {
    id: "preowned_spotlight",
    label: "Pre-owned spotlight",
    aliases: ["pre-owned spotlight", "pre-owned vehicle spotlight"],
    photoType: "vehicle",
    campaignDirection:
      "Create an inventory hero focused on condition and desirability without inventing price, history, or equipment.",
  },
  {
    id: "new_arrival",
    label: "New arrival",
    aliases: ["new arrival", "new arrival announcement"],
    photoType: "vehicle",
    campaignDirection:
      "Treat the exact vehicle as a first-look reveal with fresh-arrival energy and no availability claim in pixels.",
  },
  {
    id: "trade_in_spotlight",
    label: "Trade-in spotlight",
    aliases: ["trade-in spotlight", "trade in spotlight"],
    photoType: "vehicle",
    campaignDirection:
      "Frame the exact vehicle as ready for its next chapter; avoid unsupported ownership or condition claims.",
  },
  {
    id: "service_promotion",
    label: "Service promotion",
    aliases: ["service promotion", "service department promotion"],
    photoType: "service",
    campaignDirection:
      "Make service feel reassuring, capable, and approachable; never invent prices, completion status, or repair claims.",
  },
  {
    id: "recall_complete",
    label: "Recall completion",
    aliases: ["recall completion", "recall complete"],
    photoType: "service_customer_vehicle",
    campaignDirection:
      "Build a calm trust moment around the real customer and vehicle without depicting or claiming unverified repair details.",
  },
  {
    id: "customer_testimonial",
    label: "Customer testimonial",
    aliases: ["customer testimonial"],
    photoType: "customer_portrait",
    campaignDirection:
      "Create a dignified customer-first portrait system; do not invent, paraphrase, or burn a testimonial quote into pixels.",
  },
  {
    id: "sold_by_salesperson",
    label: "Sold by salesperson",
    aliases: ["sold by salesperson", "sold by"],
    photoType: "customer_vehicle",
    campaignDirection:
      "Celebrate the handoff team without rendering any salesperson or customer name and without turning people into endorsements.",
  },
  {
    id: "model_year_end",
    label: "Model-year-end push",
    aliases: ["model-year-end push", "model year end push"],
    photoType: "vehicle",
    campaignDirection:
      "Use decisive campaign energy around the exact vehicle while omitting prices, urgency claims, APR, and incentives from pixels.",
  },
  {
    id: "community_event",
    label: "Community event",
    aliases: ["community event"],
    photoType: "community_people",
    campaignDirection:
      "Show community warmth and place, keeping every real attendee dignified and avoiding invented sponsorship or partnership marks.",
  },
  {
    id: "team_anniversary",
    label: "Team anniversary",
    aliases: ["team anniversary"],
    photoType: "team_people",
    campaignDirection:
      "Create a proud team milestone composition without inventing names, tenure, awards, or employment claims.",
  },
  {
    id: "test_drive_invite",
    label: "Test-drive invite",
    aliases: ["test-drive invite", "test drive invite"],
    photoType: "vehicle",
    campaignDirection:
      "Make the exact vehicle inviting and energetic while avoiding promises of availability, reservation, or appointment.",
  },
];

const PHOTO_LABELS: Record<CreativePhotoType, string> = {
  customer_vehicle: "customer and vehicle",
  vehicle: "vehicle hero",
  service_customer_vehicle: "service customer and vehicle",
  service: "service environment",
  customer_portrait: "customer portrait",
  community_people: "community group",
  team_people: "dealership team",
  general: "general dealership photo",
};

const PLATFORM_LABELS: Record<CreativePlatformProfile, string> = {
  vertical: "vertical social",
  feed: "feed",
  landscape: "landscape",
  mixed: "mixed social destinations",
  neutral: "neutral or private destination",
};

const VEHICLE_LABELS: Record<CreativeVehicleClass, string> = {
  truck: "truck",
  suv: "SUV or crossover",
  car: "passenger car",
  van: "van",
  ev: "electric vehicle",
  unknown: "unspecified vehicle",
};

const normalizeSource = (value?: string): string =>
  (value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

const normalizeLabel = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[{}[\]_*"'’]/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const scenarioFromLabel = (value: string): CreativeScenario => {
  const normalized = normalizeLabel(value);
  if (!normalized) return "unknown";

  for (const definition of SCENARIO_DEFINITIONS) {
    if (
      definition.aliases.some((alias) => {
        const normalizedAlias = normalizeLabel(alias);
        return (
          normalized === normalizedAlias ||
          (definition.id === "sold_by_salesperson" &&
            normalized.startsWith(normalizedAlias + " "))
        );
      })
    ) {
      return definition.id;
    }
  }
  return "custom";
};

const classifyScenario = (source: string): CreativeScenario => {
  const primary =
    /Post scenario:\s*([^.]{1,100})\./i.exec(source)?.[1] ||
    /Scenario:\s*([^.]{1,120})\./i.exec(source)?.[1] ||
    "";
  return scenarioFromLabel(primary);
};

const photoTypeForScenario = (scenario: CreativeScenario): CreativePhotoType =>
  SCENARIO_DEFINITIONS.find((definition) => definition.id === scenario)?.photoType ||
  "general";

const classifyPlatform = (source: string): CreativePlatformProfile => {
  const start = source.search(/Target platforms\s*\(/i);
  if (start < 0) return "neutral";
  const end = source.indexOf("Always name the store", start);
  const block = source.slice(start, end >= 0 ? end : start + 1400);
  const selected = Array.from(
    block.matchAll(
      /-\s*(Instagram Feed|Instagram Reel|Instagram Story|Facebook|TikTok|Google Business(?: Profile)?|Marketplace|LinkedIn|X(?:\s*\/\s*Twitter)?|Device share)\s*\(/gi,
    ),
    (match) => match[1].toLocaleLowerCase(),
  );
  if (selected.length === 0) return "neutral";

  const vertical = selected.some((label) =>
    /instagram reel|instagram story|tiktok/.test(label),
  );
  const feed = selected.some((label) =>
    /instagram feed|facebook|linkedin|x|device share/.test(label),
  );
  const landscape = selected.some((label) => /google business|marketplace/.test(label));
  const categoryCount = Number(vertical) + Number(feed) + Number(landscape);
  if (categoryCount > 1) return "mixed";
  if (vertical) return "vertical";
  if (landscape) return "landscape";
  return "feed";
};

const vehicleSegment = (source: string): string => {
  const start = source.search(/Vehicle facts \(do not contradict\):/i);
  if (start < 0) return "";
  return source
    .slice(start, start + 520)
    .split(
      /\s+(?:Brand voice|Forbidden phrases|OEM affiliation|Dealership facts|Required hashtags|Required footer):/i,
    )[0];
};

const classifyVehicle = (source: string): CreativeVehicleClass => {
  const segment = vehicleSegment(source).toLocaleLowerCase();
  if (!segment) return "unknown";
  if (/\b(?:pickup|truck|super duty)\b/.test(segment)) return "truck";
  if (/\b(?:suv|sport utility|crossover)\b/.test(segment)) return "suv";
  if (/\b(?:van|minivan|cargo van|passenger van)\b/.test(segment)) return "van";
  if (/\b(?:sedan|coupe|hatchback|convertible|wagon|passenger car)\b/.test(segment)) {
    return "car";
  }
  if (/\b(?:electric|battery electric|bev|ev)\b/.test(segment)) return "ev";
  return "unknown";
};

const OEM_ALLOWLIST: readonly [string, RegExp][] = [
  ["Acura", /\bacura\b/i],
  ["Audi", /\baudi\b/i],
  ["BMW", /\bbmw\b/i],
  ["Buick", /\bbuick\b/i],
  ["Cadillac", /\bcadillac\b/i],
  ["Chevrolet", /\b(?:chevrolet|chevy)\b/i],
  ["Chrysler", /\bchrysler\b/i],
  ["Dodge", /\bdodge\b/i],
  ["Ford", /\bford\b/i],
  ["Genesis", /\bgenesis\b/i],
  ["GMC", /\bgmc\b/i],
  ["Honda", /\bhonda\b/i],
  ["Hyundai", /\bhyundai\b/i],
  ["INFINITI", /\binfiniti\b/i],
  ["Jeep", /\bjeep\b/i],
  ["Kia", /\bkia\b/i],
  ["Lexus", /\blexus\b/i],
  ["Lincoln", /\blincoln\b/i],
  ["Lucid", /\blucid\b/i],
  ["Mazda", /\bmazda\b/i],
  ["Mercedes-Benz", /\b(?:mercedes(?:-benz)?|benz)\b/i],
  ["Mitsubishi", /\bmitsubishi\b/i],
  ["Nissan", /\bnissan\b/i],
  ["Porsche", /\bporsche\b/i],
  ["Ram", /\bram\b/i],
  ["Rivian", /\brivian\b/i],
  ["Subaru", /\bsubaru\b/i],
  ["Tesla", /\btesla\b/i],
  ["Toyota", /\btoyota\b/i],
  ["Volkswagen", /\b(?:volkswagen|vw)\b/i],
  ["Volvo", /\bvolvo\b/i],
];

const classifyOemAffiliations = (source: string): readonly string[] => {
  const match = /OEM affiliation:\s*([^.]{1,180})\./i.exec(source);
  if (!match) return [];
  return OEM_ALLOWLIST.filter(([, pattern]) => pattern.test(match[1])).map(
    ([label]) => label,
  );
};

export const classifyCreativeBrief = (
  creativeBrief?: string,
): ClassifiedCreativeBrief => {
  const source = normalizeSource(creativeBrief);
  const scenario = source ? classifyScenario(source) : "unknown";
  return {
    hasSource: Boolean(source),
    scenario,
    photoType: photoTypeForScenario(scenario),
    platform: classifyPlatform(source),
    vehicleClass: classifyVehicle(source),
    hasVerifiedVehicleFacts: Boolean(vehicleSegment(source)),
    oemAffiliations: classifyOemAffiliations(source),
    discardedFreeform: Boolean(source),
  };
};

const scenarioLabel = (scenario: CreativeScenario): string => {
  if (scenario === "custom") return "Custom dealership scenario";
  if (scenario === "unknown") return "Unspecified";
  return (
    SCENARIO_DEFINITIONS.find((definition) => definition.id === scenario)?.label ||
    "Unspecified"
  );
};

/**
 * Safe replacement for the former regex-copy sanitizer. Every value is either
 * a closed class or an OEM name from the local allowlist.
 */
export const renderStructuredCreativeBrief = (
  brief: ClassifiedCreativeBrief,
): string => {
  if (!brief.hasSource) return "";
  const lines = [
    "Scenario class: " + scenarioLabel(brief.scenario) + ".",
    "Photo class: " + PHOTO_LABELS[brief.photoType] + ".",
    "Destination class: " + PLATFORM_LABELS[brief.platform] + ".",
    brief.hasVerifiedVehicleFacts
      ? "Verified vehicle context is available; visual class: " +
        VEHICLE_LABELS[brief.vehicleClass] +
        "."
      : "No verified vehicle-fact block is available.",
  ];
  if (brief.oemAffiliations.length > 0) {
    lines.push("Allowlisted OEM context: " + brief.oemAffiliations.join(", ") + ".");
  }
  if (brief.scenario === "custom") {
    lines.push(
      "Custom scenario wording was withheld; use only the generic custom-scenario class.",
    );
  }
  lines.push(
    "Free-form prose, names, quotes, contact details, hashtags, claims, and instructions were withheld.",
  );
  return lines.join("\n");
};

const classifyStyle = (
  style: StyleOption | string,
  mode: CreativeMode,
): CreativeStyleClass => {
  if (mode === "fun") return "fun_transform";
  switch (style) {
    case StyleOption.Luxury:
      return "luxury";
    case StyleOption.Modern:
      return "modern";
    case StyleOption.Friendly:
      return "friendly";
    case StyleOption.Sporty:
      return "sporty";
    case StyleOption.DepthPop:
      return "depth_pop";
    default:
      return "unknown";
  }
};

export const createCreativeSkillContext = (
  input: CreativeSkillSelectionInput,
): CreativeSkillContext => ({
  ...classifyCreativeBrief(input.creativeBrief),
  mode: input.mode,
  styleClass: classifyStyle(input.style, input.mode),
  hasLogo: input.hasLogo,
});

const campaignDirection = (scenario: CreativeScenario): string =>
  SCENARIO_DEFINITIONS.find((definition) => definition.id === scenario)
    ?.campaignDirection ||
  "Build a polished dealership story from visible evidence only; do not assume a delivery, sale, service result, or endorsement.";

const photoPlan = (photoType: CreativePhotoType): string => {
  switch (photoType) {
    case "customer_vehicle":
      return "Keep faces, hands, and the exact vehicle unobstructed; place campaign graphics only in verified open scene space.";
    case "vehicle":
      return "Make the exact photographed vehicle the hero; preserve paint, badges, trim, wheels, stance, and lot context.";
    case "service_customer_vehicle":
      return "Balance customer dignity, the exact vehicle, and recognizable service context without depicting invented work.";
    case "service":
      return "Use real service-lane or shop geometry as the composition system; do not add technicians, tools, parts, or repairs.";
    case "customer_portrait":
      return "Keep the real person emotionally central and reserve generous exclusion space around face, body, and hands.";
    case "community_people":
      return "Preserve every attendee, group relationship, expression, and event location; avoid singling out a person as a joke.";
    case "team_people":
      return "Preserve the full team count, relative positions, clothing, and workplace context; use a proud ensemble hierarchy.";
    default:
      return "Inspect the source first, preserve every real subject, and choose safe open space before placing any design layer.";
  }
};

const platformFinish = (platform: CreativePlatformProfile): string => {
  switch (platform) {
    case "vertical":
      return "Compose for 9:16: protect faces and the hero vehicle in the center crop, keep copy brief, and reserve clean top/bottom UI-safe margins without drawing app chrome.";
    case "feed":
      return "Compose for feed crops: keep the key story intact in both 4:5 and 1:1, with readable thumbnail hierarchy and interior margins.";
    case "landscape":
      return "Compose for 16:9 or 4:3: use horizontal depth and keep all identity, people, and vehicle details inside a centered crop-safe area.";
    case "mixed":
      return "Use a center-weighted master that survives 9:16, 4:5, and 1:1 crops; keep essential text and identity in the shared safe core.";
    default:
      return "Use a neutral, website-friendly master with no platform-specific framing, app UI, social handle, or fake interaction controls.";
  }
};

export const CREATIVE_SKILL_MODULES: readonly CreativeSkillModule[] = [
  {
    id: "campaign_art_direction",
    title: "Campaign art direction",
    applies: () => true,
    instructions: (context) => [
      campaignDirection(context.scenario),
      "Use one confident visual idea, coordinated type hierarchy, and scene-sampled color; avoid generic white type, clutter, clip art, and meme styling.",
    ],
  },
  {
    id: "photo_type_planning",
    title: "Photo-type planning",
    applies: () => true,
    instructions: (context) => [photoPlan(context.photoType)],
  },
  {
    id: "regular_photo_fidelity",
    title: "Regular-photo fidelity",
    applies: (context) => context.mode === "regular",
    instructions: () => [
      "Edit the source photo rather than rebuilding it: lock subject count, faces, bodies, hair, clothing, expressions, poses, exact vehicle identity/color/trim/angle, background, and framing.",
      "Allow only photographic retouching and designed overlays; never replace, beautify into different people, re-pose, move the car, or create a new scene.",
    ],
  },
  {
    id: "fun_transformation",
    title: "Fun transformation",
    applies: (context) => context.mode === "fun",
    instructions: () => [
      "Transform the full scene into the chosen artistic medium, but reference-lock the same number of people, recognizable facial traits, relative poses, exact vehicle identity/color/silhouette, and basic location geometry.",
      "Do not substitute people or vehicles, add characters, turn a customer into a joke, or expose prompt text in the artwork.",
    ],
  },
  {
    id: "environmental_3d_compositing",
    title: "Environmental 3D compositing",
    applies: (context) =>
      context.mode === "regular" &&
      ["depth_pop", "modern", "sporty"].includes(context.styleClass),
    instructions: (context) => [
      context.styleClass === "depth_pop"
        ? "Depth Pop requires realistic environmental 3D when a safe depth plane exists; otherwise fall back to a polished 2D depth stack."
        : "Use realistic environmental 3D only when the source has a trustworthy ground, wall, or sky-break plane; otherwise keep the selected style in polished 2D.",
      "Solve horizon, camera perspective, depth map, key-light direction, occlusion, contact shadow, reflected scene color, atmospheric softness, and depth-of-field before placing dimensional type or forms.",
      "Let a dimensional layer pass behind a vehicle edge only when the mask is believable; never pass through or touch a person, face, hand, plate, badge, or nameplate.",
    ],
  },
  {
    id: "customer_dignity_identity",
    title: "Customer dignity and identity",
    applies: () => true,
    instructions: () => [
      "Present every real person warmly and proudly. Preserve identity and natural proportions; never mock, sexualize, caricature, exaggerate age/body/disability, or make a person the punchline.",
      "Do not render any customer or salesperson name; identity belongs in the editable caption, not image pixels.",
    ],
  },
  {
    id: "dealership_oem_brand_accuracy",
    title: "Dealership and OEM brand accuracy",
    applies: () => true,
    instructions: (context) => [
      context.hasLogo
        ? "Use only the supplied dealership logo, unchanged and subordinate to the story; do not invent, trace, or redraw any other mark."
        : "No logo asset is authorized: use the exact supplied dealership-name text only and never invent a badge, crest, seal, or emblem.",
      context.oemAffiliations.length > 0
        ? "Allowlisted OEM context is " +
          context.oemAffiliations.join(", ") +
          "; keep real photographed vehicle marks unchanged and never recreate, enlarge, relocate, or duplicate an OEM logo."
        : "Keep real photographed vehicle marks unchanged and never recreate, enlarge, relocate, or duplicate an OEM logo.",
      "Never infer dealership affiliation from a vehicle badge or add unsupported offer, availability, award, partnership, or certification claims.",
    ],
  },
  {
    id: "platform_finishing",
    title: "Platform finishing",
    applies: () => true,
    instructions: (context) => [
      platformFinish(context.platform),
      "Return artwork only: no phone frame, platform header, username, watermark, hearts, comments, share buttons, or black app bars.",
    ],
  },
  {
    id: "output_qa",
    title: "Output QA",
    applies: () => true,
    instructions: (context) => [
      context.mode === "regular"
        ? "Compare the final against the source: same people, faces, bodies, vehicle, location, and framing; reject any identity or vehicle drift."
        : "Compare the transformed final against the source: same subject count, recognizable people, relative poses, vehicle identity/color/silhouette, and location story.",
      "Reject misspelled store identity, long copy, names, quotes, hashtags, contact details, prompt fragments, fake logos/seals/OEM marks, UI chrome, malformed type, unsafe overlaps, and cropped essential elements.",
    ],
  },
];

export const selectCreativeSkillModules = (
  context: CreativeSkillContext,
): readonly CreativeSkillModule[] =>
  CREATIVE_SKILL_MODULES.filter((skill) => skill.applies(context));

export const buildCreativeSkillPacket = (
  input: CreativeSkillSelectionInput,
): CreativeSkillPacket => {
  const context = createCreativeSkillContext(input);
  const skills = selectCreativeSkillModules(context);
  const header = [
    "Mode class: " + context.mode + ".",
    "Scenario class: " + scenarioLabel(context.scenario) + ".",
    "Photo class: " + PHOTO_LABELS[context.photoType] + ".",
    "Style class: " + context.styleClass.replace("_", " ") + ".",
    "Destination class: " + PLATFORM_LABELS[context.platform] + ".",
  ].join(" ");
  const prompt = [
    header,
    ...skills.map(
      (skill) =>
        "[" +
        skill.id +
        "] " +
        skill.title +
        "\n- " +
        skill.instructions(context).join("\n- "),
    ),
  ].join("\n\n");

  return {
    context,
    skillIds: skills.map((skill) => skill.id),
    prompt,
    safeBrief: renderStructuredCreativeBrief(context),
  };
};
