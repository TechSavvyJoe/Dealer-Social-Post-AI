/**
 * V2 prompts — replacement implementations for the original verbose prompts
 * in `promptConfig.ts`. Designed for the current generation of models
 * (Gemini 3.x, Imagen 4, Veo 3.x) which follow instructions much better than
 * the 1.x / 2.0 generation the original prompts were tuned for.
 *
 * Design principles:
 *  - Structured with XML-ish tags so the model can attend to sections.
 *  - One imperative per line; no "ABSOLUTE, CRITICAL, NON-NEGOTIABLE" pile-up.
 *  - Explicit slots for brand voice, vehicle facts, banned phrases.
 *  - Output specs at the end so the model ends with the answer in the right shape.
 *  - Tone "fingerprints" with a short voice example, not just adjectives.
 *
 * Feature flag: `VITE_USE_V2_PROMPTS=false` falls back to the original prompts.
 * Default is V2 (better quality + faster because tokens-in is lower).
 */
import { StyleOption, ToneOption, VideoStyle, VideoRequestOptions } from "../types";

const xmlBlock = (tag: string, content: string): string =>
  `<${tag}>\n${content.trim()}\n</${tag}>`;

const safeZoneRules = `Place all text/logos in "safe zones" — open background, sky, pavement, blank walls.
Maintain a 12% margin (minimum 32px) between any text/logo and the bounding box of any person.
Do not cross people, hands, faces, license plates, dealer signage, or vehicle nameplates with text.
Keep everything 100% inside the image canvas.`;

const subjectPreservation = `This is PHOTO EDITING of the attached delivery photo — not a new illustration and not a scene rebuild.

LOCK these from the source photo (pixel-faithful, same framing):
- Every person's face, body, hair, clothing, expression, and pose
- The exact vehicle (make, model, color, trim, angle, position in frame)
- The real background / location and camera angle

ALLOWED only:
- Subtle color grade, exposure, contrast, sharpening (pro retouch polish)
- Tasteful text overlays, badges, and a small logo/watermark in empty space
- Light cinematic polish that does NOT invent a new car, new people, or a new lot

FORBIDDEN (instant failure):
- Replacing, regenerating, or "beautifying" faces into different people
- Swapping the car, moving the car, or inventing motion-blur highway backgrounds
- Full-scene redraws (comic, LEGO, poster stock, stock-car composites)
- Covering faces, hands, or the vehicle with oversized graphics

If you cannot place text without violating these rules, use a thin bottom/top banner over empty sky or pavement — never over the car or people.`;

/** Shared quality bar for a high-budget dealership social creative studio. */
const campaignQualityBar = `Quality bar: a leading automotive marketing agency producing a paid social unit for a multi-million-dollar OEM/dealer campaign.
Classy, confident, expensive-looking. Apple-keynote restraint + premium OEM brochure craft.
Not template Canva, not clip-art, not meme energy, not stock-photo composites.
Every choice (type, grade, spacing, logo scale) should look intentional enough to justify a four- or five-figure creative fee.`;

// ----------------------------------------------------------------------------
// TEXT — Caption
// ----------------------------------------------------------------------------

const TONE_FINGERPRINTS: Record<ToneOption, string> = {
  [ToneOption.Excited]: `Voice: hype, high-energy, celebratory. Short sentences. One exclamation max.
Sample cadence: "Keys, smiles, freedom. {Name} just rolled out in their new ride — and we couldn't be happier."`,
  [ToneOption.Professional]: `Voice: composed, confident, quietly proud. No exclamation points. No emoji.
Sample cadence: "Another satisfied owner. Thank you, {Name}, for trusting us with one of the biggest decisions you'll make this year."`,
  [ToneOption.Family]: `Voice: warm, sincere, welcoming, conversational.
Sample cadence: "Welcome to the family, {Name}. We can't wait to see where this one takes you."`,
  [ToneOption.Humorous]: `Voice: playful, clever, light. One car/road pun max. Avoid dad jokes.
Sample cadence: "{Name} drove off in their new {Model}. The other cars on the lot are jealous."`,
  [ToneOption.Inspirational]: `Voice: forward-looking, journey/possibility framed.
Sample cadence: "New chapter, new chrome. Wherever this one takes you, {Name} — make every mile count."`,
  [ToneOption.Promotional]: `Voice: confident close, soft urgency, no specific dollar claims.
Sample cadence: "{Name} just locked in their new ride. Ready to be next? Come see us this week."`,
};

const styleHint = (style: StyleOption): string => {
  switch (style) {
    case StyleOption.Luxury:
      return "Polished, refined word choice. Minimal punctuation. Premium-feeling.";
    case StyleOption.Modern:
      return "Crisp, bold, current. Short bursts. Strong nouns + verbs.";
    case StyleOption.Friendly:
      return "Warm, approachable, conversational. Casual but professional.";
    case StyleOption.Sporty:
      return "Action verbs, energy, motion. Sentence rhythm should pull forward.";
    default:
      // `style` can be an invalid value cast from untrusted custom-scenario
      // JSON. Without this, the function returns undefined and "undefined" gets
      // interpolated into the model prompt.
      return "Crisp, clear, professional. Strong nouns and verbs.";
  }
};

const imageStyleHint = (style: StyleOption): string => {
  switch (style) {
    case StyleOption.Luxury:
      return "Boutique automotive campaign polish — restrained color grade, soft highlight control, elegant serif or refined sans type. Think Apple keynote + premium auto brochure, not stock-photo composites.";
    case StyleOption.Modern:
      return "Clean Meta/Google ads polish — crisp contrast, confident sans type, minimal shapes. Keep the real photo dominant; overlays stay secondary.";
    case StyleOption.Friendly:
      return "Warm community-dealership energy — slight warmth/brightness, friendly rounded type. Still the real customers and real car, not a cartoon.";
    case StyleOption.Sporty:
      return "Athletic campaign energy — tighter contrast, bold italics, red/blue accent type. No fake motion-blur highways or replacement vehicles.";
    default:
      return "Professional automotive social creative: real photo first, studio-grade type and grade second.";
  }
};

export const generateTextPromptV2 = (
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  isRegeneration = false,
  creativeBrief?: string,
  style?: StyleOption,
): string => {
  // Keep this prompt SHORT. Long multi-block prompts cause models to emit
  // labels, XML, or gibberish. Salespeople need plain English posts only.
  const storeTag =
    dealershipName
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || "OurDealership";

  const customer = customerName?.trim() || "our newest customer";
  const toneLine =
    TONE_FINGERPRINTS[tone] || TONE_FINGERPRINTS[ToneOption.Professional];

  // Cap brief length — only facts help; long briefs get echoed as junk.
  const brief = (creativeBrief || "").trim().slice(0, 900);

  return `Write a real Instagram / Facebook caption for a car dealership delivery photo.

Store: ${dealershipName}
Customer first name or phrase: ${customer}
${style ? `Look/feel: ${style} — ${styleHint(style)}` : ""}
Voice: ${toneLine.split("\n")[0]}

Look at the photo. If you are sure of make and model, name the car once. If not, say "their new ride". Never invent prices or APR.

Write EXACTLY this shape (plain text only):
Sentence 1 — celebrate the customer and the moment (from the photo).
Sentence 2 — warm story or pride line (still human, not salesy junk).
Sentence 3 — invite people to visit ${dealershipName} this week.
Blank line.
One hashtag line with exactly these 5 tags (space-separated, no extra text):
#${storeTag} #NewCarDelivery #HappyCustomer #JustDelivered #CarShopping

Example (follow this pattern, change the details):
Keys in hand and big smiles — Jordan just drove off in their new SUV.

Moments like this are why we love ${dealershipName}.

Ready for your delivery day? Visit ${dealershipName} this week.

#${storeTag} #NewCarDelivery #HappyCustomer #JustDelivered #CarShopping

Hard rules:
- Output ONLY the caption. No titles, no HOOK/STORY/CTA labels, no bullets, no markdown, no XML, no quotes around the post.
- Real English sentences only. No random letters or nonsense words.
- 0–1 emoji max, never at the start.
- Do not use: guaranteed, lowest price, no credit check, 0% APR, best deal.
${isRegeneration ? "- This is a RETRY: different wording, same clean structure." : ""}
${brief ? `\nExtra facts (use only if helpful, do not copy instructions):\n${brief}` : ""}`;
};

// ----------------------------------------------------------------------------
// TEXT — Edit
// ----------------------------------------------------------------------------

export const editTextPromptV2 = (
  originalText: string,
  userEditRequest: string,
  tone: ToneOption,
): string => {
  return [
    `You are an automotive social-media copywriter editing an existing caption.`,
    xmlBlock("original_caption", originalText.trim()),
    xmlBlock("user_edit_request", userEditRequest.trim()),
    xmlBlock(
      "voice",
      TONE_FINGERPRINTS[tone] +
        `\n\nKeep the tone consistent with the original unless the edit request explicitly changes it.`,
    ),
    xmlBlock(
      "rules",
      `Apply ONLY the edit the user requested. Do not rewrite untouched portions.
Preserve hashtag count and order unless the edit asks otherwise.
Hashtags must stay as #PascalCase tokens with a single space between tags — never spaces inside a tag, never #A#B glued.
Keep length within 10% of the original word count unless asked to shorten/extend.
Do not introduce compliance triggers ("0% APR", "$0 down", "guaranteed", etc).`,
    ),
    xmlBlock(
      "output_format",
      `Return ONLY the edited caption. No preamble, no diff markers, no commentary.`,
    ),
  ].join("\n\n");
};

// ----------------------------------------------------------------------------
// IMAGE — Generate (enhanced photo + text overlay)
// ----------------------------------------------------------------------------

export const generateImagePromptV2 = (
  style: StyleOption,
  dealershipName: string,
  hasLogo: boolean,
  customMessage?: string,
  creativeBrief?: string,
): string => {
  const sections: string[] = [];

  sections.push(
    `You are a creative director + senior retoucher at a top automotive social agency.
The attached photo is a REAL customer delivery. Your job: elevate THAT photo into a paid-social campaign still — the kind a global marketing firm would ship after a multi-thousand-dollar creative production.
This is professional photo editing and design on the source image — NOT generic image generation, NOT a new scene, NOT a stock-car composite.`,
  );

  sections.push(xmlBlock("subject_preservation", subjectPreservation));
  sections.push(xmlBlock("safe_zones", safeZoneRules));
  sections.push(xmlBlock("campaign_quality", campaignQualityBar));

  sections.push(
    xmlBlock(
      "style_direction",
      `Style: ${style}
${imageStyleHint(style)}
Color & grading: subtle cinematic grade only — lift faces slightly, accurate paint color, controlled contrast, gentle highlight roll-off. Do not invent a new environment or sky replacement.
Typography: editorial hierarchy (one hero line + optional short support). Refined tracking, high-end weight pairing, generous breathing room. Prefer open sky/pavement/wall safe zones.
Avoid: cheesy 3D chrome, burst explosions, clip-art confetti piles, full-frame graphic takeover, meme stickers, watermark spam.
Compositing: light text shadows ok; logo small and premium; no stock-car pastes, no background replacement, no re-posed people.
Finish: looks like a finished campaign asset ready for Instagram/Facebook/TikTok paid social.`,
    ),
  );

  if (creativeBrief?.trim()) {
    sections.push(
      xmlBlock(
        "creative_brief",
        `${creativeBrief.trim()}\n\nReflect this in palette, typography, and supporting elements. Brand voice and OEM affiliation in the brief override default style choices.`,
      ),
    );
  }

  if (customMessage?.trim()) {
    sections.push(
      xmlBlock(
        "headline_text",
        `Render this exact text on the image. Do not alter spelling, capitalization, or punctuation:\n"${customMessage.trim()}"`,
      ),
    );
  }

  sections.push(
    xmlBlock(
      "store_identity",
      `This store's full legal/marketing name is exactly:
"${dealershipName}"

You MUST show this full name clearly in the design (not abbreviated to a brand family only). Multi-location groups (e.g. several Ford stores + Lincoln) need the specific location name so customers know which store to visit.

${
  hasLogo
    ? `A second image is the store logo — place it small in a lower corner safe zone AND still include the full name "${dealershipName}" as readable text (badge, banner, or caption line). Logo alone is not enough.`
    : `Render "${dealershipName}" as a clear, tasteful text lockup in a safe zone (lower third or corner). Exact spelling required.`
}`,
    ),
  );

  sections.push(
    xmlBlock(
      "process",
      `1. Lock the input photo as canvas. Note the bounding boxes of all people and the vehicle.
2. Enhance: lift brightness, balance color, sharpen — the same way a professional photographer would post-process a delivery shot.
3. Place the overlay text and watermark inside safe zones only. Verify the 12%/32px margin rule before finalizing.
4. Final pass: confirm the people, the car, and the scene are pixel-equivalent to the input apart from the post-process and the overlays.`,
    ),
  );

  sections.push(
    xmlBlock(
      "prohibited",
      `Do not replace, regenerate, or "improve" any person's face, body, hair, clothing, or pose.
Do not change the car make, model, color, or trim.
Do not change the background or camera angle.
Do not add humans or vehicles that aren't in the source photo.
Do not cover faces or hands with text/graphics.`,
    ),
  );

  return sections.join("\n\n");
};

// ----------------------------------------------------------------------------
// IMAGE — Edit (apply specific change)
// ----------------------------------------------------------------------------

export const editImagePromptV2 = (
  userEditRequest: string,
  dealershipName: string,
  hasLogo: boolean,
): string => {
  return [
    `You are editing an existing generated social-media post image. Apply ONLY the change the user requested, keeping everything else identical.`,
    xmlBlock("subject_preservation", subjectPreservation),
    xmlBlock("safe_zones", safeZoneRules),
    xmlBlock("user_edit_request", userEditRequest.trim()),
    xmlBlock(
      "rules",
      `Touch only the elements the user named. Do not "improve" other elements.
If the request would move text into a person's exclusion zone, decline and place it in the nearest safe zone instead.
${hasLogo ? "The dealership logo must remain visible." : `The dealership name "${dealershipName}" must remain visible as text watermark.`}
Spelling on any text must remain exact.`,
    ),
  ].join("\n\n");
};

// ----------------------------------------------------------------------------
// IMAGE — Fun mode (artistic transform)
// ----------------------------------------------------------------------------

export const generateFunPromptV2 = (
  styleSummary: string,
  dealershipName: string,
  hasLogo: boolean,
  requestedStyleName?: string,
): string => {
  return [
    `You are a senior campaign artist for a high-budget automotive dealership social unit.
Apply a stylized LOOK to a REAL delivery photo — limited Marvel / poster / LEGO energy over photography, not a full scene rebuild.
${campaignQualityBar}`,
    xmlBlock(
      "style",
      `${requestedStyleName ? `Style: ${requestedStyleName}\n` : ""}${styleSummary}

Keep it fun and iconic but HOLLYWOOD-STUDIO professional — not cheesy clip-art.
Composition stays: same people positions, same vehicle, same location. Stylize color, line, texture ON TOP of that composition.`,
    ),
    xmlBlock(
      "subject_lock",
      `CRITICAL: The real customers and the real car must remain clearly the same subjects.
No vehicle swap, no different car on a highway, no face replacement.
Mild line/skin stylization OK; identity must match the photo at a glance.`,
    ),
    xmlBlock(
      "marketing_overlays",
      `Add premium campaign graphic overlays suitable for Instagram/Facebook:
- Full store name "${dealershipName}" as a clean lockup (exact spelling)
- Optional short hook badge in empty space only (e.g. "DELIVERED", "KEYS DAY", "WELCOME") — max 2 words, bold sans
- Optional small secondary line if space allows (e.g. "Your turn next") — never over faces or the car badge
${hasLogo ? "- Place the store logo small in a corner" : ""}
Do not invent prices, APR, or "lowest price" claims.`,
    ),
    xmlBlock(
      "safe_zones",
      `Text/logo must not cover faces, hands, license plate, or vehicle nameplate. Keep top/bottom margins for social UI.`,
    ),
  ].join("\n\n");
};

// ----------------------------------------------------------------------------
// VIDEO — Veo image-to-video (photo-locked campaign motion)
// ----------------------------------------------------------------------------

/**
 * Veo image-to-video works best when the prompt describes MOTION only.
 * Describing a new scene, second car, morph, or "reveal of another vehicle"
 * causes the model to invent frames that leave the source photo.
 */
const videoMotionForStyle = (
  style: VideoStyle,
  pacing: VideoRequestOptions["pacing"],
): string => {
  const snappy = pacing === "snappy";
  const base = snappy
    ? "Motion starts immediately. Keep it short, confident, and premium — not chaotic."
    : "Motion starts immediately. Slow, smooth, high-end automotive commercial feel.";

  switch (style) {
    case VideoStyle.GoldenRadiance:
      return `${base} GOLDEN DELIVERY: very slow push-in (≤8% scale over the clip). Warm specular roll left→right across real paint and glass. Soft lens kiss. Classy OEM pride. No second car.`;
    case VideoStyle.Spotlight:
      return `${base} KEYS & SMILE: camera nearly locked. Soft spotlight falloff brightens existing faces and car nose. Intimate handover energy. No confetti storm.`;
    case VideoStyle.VintageFilm:
      return `${base} LIVING STILL: gentle Ken Burns (micro pan + micro push) over the SAME frame; light film grain optional. Documentary-premium, not shaky home video.`;
    case VideoStyle.RoadTrip:
      return `${base} LOT PARALLAX: background-only depth (sky/trees/building drift); car + people stay a fixed hero plate. Ready-for-the-road without fake driving.`;
    case VideoStyle.PartyTime:
      return `${base} TASTEFUL CONFETTI: almost locked camera. Light confetti/sparkle only in empty sky or pavement — never over faces or the car badge.`;
    case VideoStyle.LiquidChrome:
      return `${base} PAINT SHEEN: micro truck or locked camera. Specular roll only on existing chrome/paint — no liquid morph into another vehicle.`;
    case VideoStyle.StickerSlap:
      return `${base} BADGE POP: photo micro-jiggle on hit. 1–2 small badges (SOLD / keys / star) slap into EMPTY corners only. TikTok-native, small and classy.`;
    case VideoStyle.EpicReveal:
      return `${base} SOFT HERO LIGHT: locked or ≤2% drift. Gentle light wrap on existing paint and faces. No push-zoom inventing detail. No second vehicle.`;
    case VideoStyle.CarSketch:
      return `${base} SOFT RESOLVE: brief line-sketch overlay that dissolves into the real photo within ~1s — identity already matches the photo.`;
    case VideoStyle.Blueprint:
      return `${base} Thin blueprint lines that dissolve to the real delivery photo within 1s.`;
    case VideoStyle.NeonPulse:
      return `${base} Soft edge glow pulse once on existing body lines. Minimal drift.`;
    case VideoStyle.CometStrike:
      return `${base} Fine stardust in empty background only. Locked framing.`;
    case VideoStyle.HappyDance:
      return `${base} Micro 1–2% frame pulse only — never re-pose people or the car.`;
    case VideoStyle.JumpingForJoy:
      return `${base} People planted; brief energy on existing smiles only. No leaving the ground.`;
    case VideoStyle.SpeedLines:
      return `${base} Faint edge streaks in empty margins; car and people rock-still.`;
    case VideoStyle.GlitchPop:
      return `${base} One tasteful micro-glitch that resolves instantly; identity never changes.`;
    case VideoStyle.SmokeReveal:
      return `${base} Thin edge haze that clears to the SAME photo — never replace the car.`;
    case VideoStyle.FireEmbers:
      return `${base} Soft embers in empty space only; warm grade; no fire on faces.`;
    case VideoStyle.GraffitiReveal:
      return `${base} Brief color wash at edges that settles into the real photo.`;
    case VideoStyle.HolographicScan:
      return `${base} Soft scan-line pass that resolves to the full-color source photo.`;
    default:
      return `${base} Locked camera, natural light shimmer on paint, subjects locked.`;
  }
};

export const generateVideoPromptV2 = (
  style: VideoStyle,
  options: VideoRequestOptions,
  baseCaption?: string,
): string => {
  const duration = options.durationSeconds || 6;
  const aspect =
    options.aspectPreference === "auto"
      ? "match the source photo aspect"
      : options.aspectPreference === "1:1"
        ? "9:16 or 16:9 letterbox (never crop faces or the vehicle)"
        : String(options.aspectPreference);

  return [
    `You are directing a premium automotive dealership SOCIAL video (Reels/TikTok/Facebook).
Image-to-video ONLY. The attached photo is frame 1 and the only scene — a real customer delivery moment.
Goal: scroll-stopping living photography that feels like a high-budget OEM campaign spot, not random AI morphs.`,
    xmlBlock(
      "hard_locks",
      `NON-NEGOTIABLE:
- Frame 1 = attached photo. Last frame still clearly that same photo (same people, same car, same place).
- No second car, color swap, showroom swap, highway plate, or stock hero vehicle.
- No face morph, re-pose, dance, or people leaving the ground.
- No extreme zoom inventing detail that was not in the photo.
- Full vehicle + all people visible for all ${duration}s.
- Motion starts immediately (no long black fade into a different scene).`,
    ),
    xmlBlock(
      "campaign_quality",
      `${campaignQualityBar}
Automotive marketing bar: confidence, warmth, trust. Delivery-day authenticity > CGI spectacle.
One primary move only (push OR light sweep OR particles — not all aggressive at once).
Loop-friendly settle at the end.`,
    ),
    xmlBlock(
      "motion",
      `Named recipe: ${style}
Duration: ${duration}s. Frame: ${aspect}. Resolution: ${options.resolution}.
Pacing: ${options.pacing}.
${videoMotionForStyle(style, options.pacing)}
Style name is a MOTION RECIPE only — never permission to rebuild the scene.`,
    ),
    xmlBlock(
      "marketing_graphics",
      `Dealership social proof overlays (EMPTY safe space only — never on faces, hands, license plate, or car nameplate):
- Prefer 0–2 tiny motion badges max: "DELIVERED", "SOLD", keys icon, star burst, or "WELCOME" — bold sans, 1–2 words.
- Badge Pop / Tasteful Confetti may animate badges into lower corners or sky/pavement gaps.
- Other styles: prioritize light, sheen, and parallax; badges optional and tiny.
- Do NOT paint long captions, prices, APR, payment claims, phone numbers, or paragraphs into frames.
- Keep top ~12% and bottom ~18% relatively clean for Instagram/TikTok UI + caption text added in-app.
Industry bar: short-form delivery social proof that feels authentic and premium — not stock CGI inventory ads.`,
    ),
    xmlBlock(
      "soundtrack",
      options.soundtrack === "none"
        ? `Silent video only — no music, dialogue, or score.`
        : `NATIVE AUDIO REQUIRED: full original score baked into the file (not silent).
Mood: ${options.soundtrack} — warm pride / delivery-day celebration; original music only (no copyrighted tracks).
Light lot/outdoor ambience + tasteful underscore that peaks mid-clip. No fake customer dialogue.
Silent output is a failure when music is requested.`,
    ),
    baseCaption
      ? xmlBlock(
          "caption_mood_only",
          `Post caption mood (do NOT paint this text into frames): "${baseCaption.trim().slice(0, 220)}"`,
        )
      : "",
    xmlBlock(
      "success_criteria",
      `A viewer who saw the original photo instantly recognizes the same delivery moment.
If car or people identity drifts at any frame → failure.
Feels like a paid dealership social ad someone would be proud to post.`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
};
