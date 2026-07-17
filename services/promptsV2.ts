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
- Subtle color grade, exposure, contrast, sharpening
- Tasteful text overlays, badges, and a small logo/watermark in empty space
- Light cinematic polish that does NOT invent a new car, new people, or a new lot

FORBIDDEN (instant failure):
- Replacing, regenerating, or "beautifying" faces into different people
- Swapping the car, moving the car, or inventing motion-blur highway backgrounds
- Full-scene redraws (comic, LEGO, poster stock, stock-car composites)
- Covering faces, hands, or the vehicle with oversized graphics

If you cannot place text without violating these rules, use a thin bottom/top banner over empty sky or pavement — never over the car or people.`;

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
  style?: StyleOption
): string => {
  const sections: string[] = [];

  sections.push(
    `You are an elite automotive social-media copywriter. Write one short, scroll-stopping caption to accompany the attached delivery photo. Output the caption ONLY — no preamble, no labels, no commentary.`
  );

  sections.push(
    xmlBlock(
      "context",
      `Dealership: ${dealershipName}
Customer: ${customerName?.trim() || "(name not provided — refer to them as 'our latest happy customer' or similar)"}
${style ? `Visual style of the post: ${style} — ${styleHint(style)}` : ""}`
    )
  );

  sections.push(xmlBlock("voice", TONE_FINGERPRINTS[tone]));

  if (creativeBrief?.trim()) {
    sections.push(
      xmlBlock(
        "creative_brief",
        `${creativeBrief.trim()}\n\nThe brief may contain vehicle facts, brand-voice direction, and forbidden phrases. Treat these as binding constraints, ranked higher than your default style.`
      )
    );
  }

  sections.push(
    xmlBlock(
      "image_analysis",
      `Briefly study the photo before writing.
- The car: if you can identify make+model with certainty, name it. If not, say "their new ride" / "this beauty" / similar. Wrong identification is worse than generic.
- The people: count, vibe (family / couple / solo), apparent mood.
- The scene: showroom vs outdoor — let it color the imagery.`
    )
  );

  const storeTag = dealershipName.replace(/[^A-Za-z0-9]+/g, "");
  sections.push(
    xmlBlock(
      "rules",
      `Length: 1–2 short hook sentences + 1 CTA. Three sentences max. Mobile-first — scannable on a phone screen.
Always name the store exactly as "${dealershipName}" in the body or CTA (not a shortened brand-only name) so multi-location traffic goes to the right rooftop.
Hashtags: 4–6 total, space-separated:
  - #${storeTag} (required)
  - 1 location/market tag if you can infer city/region from the store name (e.g. #HowellMI)
  - 2–3 high-intent automotive discovery tags (e.g. #NewCarDelivery #HappyCustomer #CarShopping) — no spam stuffing
  - Optional OEM tag only if the vehicle brand is certain from the photo/brief
Emoji: 0–2, never leading.
No prices, APR, "guaranteed", "lowest", "no credit check".
Do not invent vehicle specs not in <creative_brief>.
Tone: lively Hollywood marketing polish — confident and fun, never cheesy or try-hard.
${isRegeneration ? "REGENERATION: different opening + different hashtag mix than a prior draft." : ""}`
    )
  );

  sections.push(
    xmlBlock(
      "output_format",
      `Hook + story (1–2 sentences). Newline. CTA that includes "${dealershipName}" (1 sentence). Newline. Hashtags on one line.
No preamble. No quotes. Caption only.`
    )
  );

  return sections.join("\n\n");
};

// ----------------------------------------------------------------------------
// TEXT — Edit
// ----------------------------------------------------------------------------

export const editTextPromptV2 = (
  originalText: string,
  userEditRequest: string,
  tone: ToneOption
): string => {
  return [
    `You are an automotive social-media copywriter editing an existing caption.`,
    xmlBlock("original_caption", originalText.trim()),
    xmlBlock("user_edit_request", userEditRequest.trim()),
    xmlBlock(
      "voice",
      TONE_FINGERPRINTS[tone] +
        `\n\nKeep the tone consistent with the original unless the edit request explicitly changes it.`
    ),
    xmlBlock(
      "rules",
      `Apply ONLY the edit the user requested. Do not rewrite untouched portions.
Preserve hashtag count and order unless the edit asks otherwise.
Keep length within 10% of the original word count unless asked to shorten/extend.
Do not introduce compliance triggers ("0% APR", "$0 down", "guaranteed", etc).`
    ),
    xmlBlock("output_format", `Return ONLY the edited caption. No preamble, no diff markers, no commentary.`),
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
  creativeBrief?: string
): string => {
  const sections: string[] = [];

  sections.push(
    `You are an elite, world-class agency graphic designer and compositor. The attached photo shows a real customer with their new car. Your output is the SAME photo, but elevated with expert-level color grading, compositing, and typography to create a breathtaking social media advertisement. This is professional photo editing and design, not generic image generation.`
  );

  sections.push(xmlBlock("subject_preservation", subjectPreservation));
  sections.push(xmlBlock("safe_zones", safeZoneRules));

  sections.push(
    xmlBlock(
      "style_direction",
      `Style: ${style}
${imageStyleHint(style)}
Color & grading: subtle cinematic grade only — lift faces slightly, keep paint accurate, do not invent a new environment.
Typography: editorial hierarchy (hero line + short support line). Prefer open sky/pavement/wall safe zones. Avoid cheesy 3D chrome explosions or full-frame graphic takeover.
Compositing: light text shadows ok; no stock-car pastes, no background replacement, no re-posed people.`
    )
  );

  if (creativeBrief?.trim()) {
    sections.push(
      xmlBlock(
        "creative_brief",
        `${creativeBrief.trim()}\n\nReflect this in palette, typography, and supporting elements. Brand voice and OEM affiliation in the brief override default style choices.`
      )
    );
  }

  if (customMessage?.trim()) {
    sections.push(
      xmlBlock(
        "headline_text",
        `Render this exact text on the image. Do not alter spelling, capitalization, or punctuation:\n"${customMessage.trim()}"`
      )
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
}`
    )
  );

  sections.push(
    xmlBlock(
      "process",
      `1. Lock the input photo as canvas. Note the bounding boxes of all people and the vehicle.
2. Enhance: lift brightness, balance color, sharpen — the same way a professional photographer would post-process a delivery shot.
3. Place the overlay text and watermark inside safe zones only. Verify the 12%/32px margin rule before finalizing.
4. Final pass: confirm the people, the car, and the scene are pixel-equivalent to the input apart from the post-process and the overlays.`
    )
  );

  sections.push(
    xmlBlock(
      "prohibited",
      `Do not replace, regenerate, or "improve" any person's face, body, hair, clothing, or pose.
Do not change the car make, model, color, or trim.
Do not change the background or camera angle.
Do not add humans or vehicles that aren't in the source photo.
Do not cover faces or hands with text/graphics.`
    )
  );

  return sections.join("\n\n");
};

// ----------------------------------------------------------------------------
// IMAGE — Edit (apply specific change)
// ----------------------------------------------------------------------------

export const editImagePromptV2 = (
  userEditRequest: string,
  dealershipName: string,
  hasLogo: boolean
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
Spelling on any text must remain exact.`
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
  requestedStyleName?: string
): string => {
  return [
    `You are a premium campaign artist applying a stylized LOOK to a real delivery photo — like a limited Marvel/LEGO/superhero campaign treatment over photography, not a full redraw that invents a new car or new people.`,
    xmlBlock(
      "style",
      `${requestedStyleName ? `Style: ${requestedStyleName}\n` : ""}${styleSummary}

Keep the treatment fun and iconic (Marvel energy, Superman poster polish, LEGO charm, nostalgic comic) but HOLLYWOOD-STUDIO professional — not cheesy clip-art.
The original photo composition stays: same people positions, same vehicle, same location. Stylize colors, linework overlays, and texture ON TOP of that composition.`
    ),
    xmlBlock(
      "subject_lock",
      `CRITICAL: The real customers and the real car must remain clearly the same subjects from the source photo.
Do not swap the vehicle. Do not invent a different car flying through a highway blur. Do not replace faces.
Mild stylization of skin/line is ok; identity must still match the photo at a glance.`
    ),
    xmlBlock(
      "store_identity",
      hasLogo
        ? `Place the logo small in a corner AND render the full store name "${dealershipName}" as readable campaign text.`
        : `Include the full store name "${dealershipName}" as a clear signature/lockup — exact spelling.`
    ),
    xmlBlock(
      "safe_zones",
      `Text must not cover faces, hands, or the vehicle nameplate.`
    ),
  ].join("\n\n");
};

// ----------------------------------------------------------------------------
// VIDEO — Veo prompt distillation
// ----------------------------------------------------------------------------

export const generateVideoPromptV2 = (
  style: VideoStyle,
  options: VideoRequestOptions,
  baseCaption?: string
): string => {
  const motion =
    options.pacing === "cinematic"
      ? "Cinematic slow-push, subtle parallax, gentle camera drift. Hold reveals."
      : "Snappy cuts, quick zooms, energetic motion. Beat-matched if soundtrack present.";
  return [
    `Generate a 5–8 second video from the attached still photo.`,
    xmlBlock(
      "style",
      `${style}\nDuration: ${options.durationSeconds}s. Aspect: ${
        options.aspectPreference === "auto" ? "match source" : options.aspectPreference
      }. Resolution: ${options.resolution}. Pacing: ${options.pacing}.\n${motion}`
    ),
    xmlBlock(
      "soundtrack",
      options.soundtrack === "none"
        ? `No audio.`
        : `Background music style: ${options.soundtrack}. Build to a brief peak at the reveal moment. No copyrighted tracks.`
    ),
    baseCaption
      ? xmlBlock(
          "narrative_hint",
          `The companion caption is: "${baseCaption.trim()}". Reflect its mood and the subject's emotion in the motion.`
        )
      : "",
    xmlBlock(
      "subject_preservation",
      `The people and the vehicle must remain recognizable. Do not regenerate faces or swap the vehicle. Slight motion (head turn, smile expansion) is allowed.`
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
};
