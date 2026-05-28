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

const subjectPreservation = `This is photo editing, not generation. The input photo is the canvas.
Preserve the exact pixels for: every person's face/body/hair/clothing/pose, the vehicle's make/model/color/trim, the background scene, and the camera angle.
You may adjust: exposure, color grading, vibrancy, contrast, sharpening, and add text/badge overlays.
You may not: replace people, change the car, alter the location, or add hallucinated subjects.`;

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
  }
};

const imageStyleHint = (style: StyleOption): string => {
  switch (style) {
    case StyleOption.Luxury:
      return "High-end automotive brochure. Aggressive use of negative space. Cinematic, moody color grading with dodge and burn. Razor-thin elegant serif typography.";
    case StyleOption.Modern:
      return "Tech-event keynote aesthetic. Heavy, tracking-tight sans-serifs. Sleek minimalist geometry. High contrast lighting with glassmorphism overlays.";
    case StyleOption.Friendly:
      return "Modern direct-to-consumer lifestyle brand. Soft, warm golden-hour lighting. Rounded, approachable but premium typography. Vibrant, cheerful color palette.";
    case StyleOption.Sporty:
      return "Action sports/energy drink ad. Aggressive forward-leaning italics. Gritty high-contrast HDR processing. Dynamic editorial grid layout with motion blur elements.";
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

  sections.push(
    xmlBlock(
      "rules",
      `Length: 1–2 short sentences for the hook + 1 short CTA. Three sentences total max.
Hashtags: exactly 3–4. One of them is #${dealershipName.replace(/\s+/g, "")}.
Emoji: 0–2 total, only if they earn their place. Never as the first character.
Do not use prices, APR claims, "guaranteed", "lowest", "no credit check", or anything that could trigger a compliance footer the user has to delete.
Do not invent vehicle specs not present in <creative_brief>.
${isRegeneration ? "REGENERATION: This is a new variant. Use a different opening word, different image, and different hashtag-mix from any previous version." : ""}`
    )
  );

  sections.push(
    xmlBlock(
      "output_format",
      `Hook + story (1–2 sentences). Newline. CTA inviting visitors to ${dealershipName} (1 sentence). Newline. Hashtags space-separated on one line.
No "Here is" preamble. No quotes around the caption. Just the caption.`
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
Color & Grading: Apply cinematic color grading (LUTs) to naturally draw the viewer's eye to the customer and the car, subtly darkening distracting background elements. Match ambient lighting.
Typography & Layout: Abandon generic center-aligned text. Utilize expert editorial grid systems (e.g., Swiss Design), typography pairings, overlapping planes, and dynamic angles.
Compositing & Effects: Analyze the light source in the original photo and cast realistic drop shadows or ambient occlusion from any 3D text onto the environment (the ground, a wall). Seamlessly integrate text into the depth-of-field.`
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
      "watermark",
      hasLogo
        ? `A second image is the dealership logo. Place it as a small, tasteful watermark in a lower-corner safe zone. Do not distort. Do not also add the dealership name as text — the logo is enough.`
        : `Render the dealership name "${dealershipName}" as a small, tasteful text watermark in a lower-corner safe zone. Use the exact spelling.`
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
    `You are an artistic transformation engine. Take the attached customer-delivery photo and re-render it in the requested artistic style while keeping the subjects recognizable.`,
    xmlBlock(
      "style",
      `${requestedStyleName ? `Style: ${requestedStyleName}\n` : ""}${styleSummary}`
    ),
    xmlBlock(
      "subject_recognition",
      `Subjects must remain RECOGNIZABLE as the same people and the same car — not photorealistic, but unmistakably them.
Faces stay clear and uncovered. Hands stay intact. Vehicle silhouette stays correct.`
    ),
    xmlBlock(
      "watermark",
      hasLogo
        ? `Place the supplied logo subtly in a lower corner. Allow it to take on the artistic style if doing so doesn't distort the logo's readability.`
        : `Stylize the dealership name "${dealershipName}" as a signature element in a lower corner, matching the artistic medium.`
    ),
    xmlBlock(
      "safe_zones",
      `Any text in the transformed art must not cover faces, hands, or the vehicle nameplate.`
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
