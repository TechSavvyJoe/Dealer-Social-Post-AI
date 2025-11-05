// FIX: Replaced 'GenerateVideosOperationResponse' with the correct 'GenerateVideosOperation' type.
import { GoogleGenAI, Modality, Type, GenerateVideosOperation } from "@google/genai";
import { parseDataUrl } from '../utils/imageUtils';
import { StyleOption, ToneOption, VideoStyle } from "../types";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

let ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const generateImagePrompt = (style: StyleOption, dealershipName: string, hasLogo: boolean, customMessage?: string): string => {
    const criticalRules = `
**CRITICAL, NON-NEGOTIABLE CORE DIRECTIVES: READ AND OBEY THESE RULES ABOVE ALL ELSE. FAILURE TO FOLLOW THEM PERFECTLY IS A TOTAL TASK FAILURE.**

**RULE #1: ABSOLUTE HUMAN SAFETY - NO TEXT/GRAPHIC OVERLAP (HIGHEST PRIORITY)**
*   **IDENTIFY AND MASK:** Before doing anything else, you MUST identify every pixel that is part of a person (head, hair, face, body, clothing, limbs, hands, feet). Create a large, invisible "exclusion zone" around them.
*   **ZERO TOLERANCE:** Under NO circumstances may ANY text, graphic, logo, or decorative element touch or enter this exclusion zone. Even a single pixel of overlap is a complete failure.
*   **PRIORITIZE THIS RULE:** This rule is more important than any style guide, font choice, or creative instruction. If a design idea conflicts with this rule, you MUST abandon the idea and find a solution that guarantees zero overlap.

**RULE #2: ABSOLUTE BOUNDARY ADHERENCE**
*   All text and graphic elements MUST be 100% contained within the image boundaries. Nothing can be cut off.

**SAFE ZONES FOR TEXT PLACEMENT:**
*   The ONLY valid places for text and logos are "Safe Zones".
*   Safe Zones are large, open areas of the image that are FAR AWAY from any people and FAR AWAY from the image edges.
*   Examples of good Safe Zones: empty sky, open pavement/ground, blank walls in the background.
*   Examples of BAD places: on the car if it's near a person, anywhere near a person's head or body.`;
    
    const watermarkInstruction = hasLogo
        ? `*   **MANDATORY LOGO PLACEMENT:** A second image has been provided—this is the dealership's logo. It is a CRITICAL REQUIREMENT that you place this logo as a small, tasteful watermark in a lower corner of the final image, inside a Safe Zone. Do not distort it. Do NOT use the dealership name as a text watermark if the logo image is present. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `*   **WATERMARK:** The dealership name, '${dealershipName}', MUST be used as a text watermark. Use the *exact* spelling provided and place it tastefully in a lower corner within a Safe Zone.`;

    const varietyInstruction = `**CRITICAL CREATIVE MANDATE: VIRAL-WORTHY DESIGN.** Your goal is not just to make a post, but to create a visually stunning, one-of-a-kind piece of art that stops people from scrolling. For this specific generation, you MUST create a completely unique and fresh design. Do not default to a standard template. You are a creative director, so be bold! Experiment with the following elements within the chosen style guide below:
- **Font Artistry:** Choose a unique pair of complementary fonts that make a statement. Don't just place text; treat it like a design element itself.
- **Harmonious Color Palette:** Select a dynamic color palette. You MUST derive the primary colors from the car, the background scene, or the customer's clothing to create a professional, harmonious, and striking design.
- **Dynamic Layout:** Experiment with unconventional layouts. Consider angled text, text that wraps around parts of the car (without touching people), stacked words, or integrating text with the scene's lines, while ALWAYS staying in the Safe Zones.
- **High-Impact Text Effects:** Apply a unique and tasteful text effect that makes the text 'pop'. Examples include a vibrant neon glow, a realistic 3D metallic sheen, a bold graphic drop shadow, an elegant outline, or text that appears to be part of the environment itself. The goal is to make every post look like a custom, high-end design.`;

    const coreInstruction = `Act as a world-class graphic designer with an infallible eye for composition. Your mission is to create a viral-worthy social media post by enhancing a photo and adding text overlays. You have been provided a primary photo of a customer and their car. You may also have been provided a second image which is a company logo.

${criticalRules}

You must follow this process:

**Step 1: PHOTO ENHANCEMENT**
Perform a full, professional-grade photo enhancement on the original image to make it significantly brighter, more vibrant, and visually appealing.
*   **BRIGHTEN & ENHANCE:** Significantly increase the overall brightness and vibrancy. The goal is a bright, clear, and eye-catching image that pops.
*   **FLATTERING LIGHTING:** Intelligently balance lighting. Eliminate harsh shadows on people and the car, adding a soft 'fill light' effect for a professional studio look.
*   **COLOR GRADING & POLISH:** Apply a rich, appealing color grade. Add a final touch of sharpening to make details crisp and clear.

**Step 2: INTELLIGENT TEXT OVERLAY (Restricted to Safe Zones)**
After enhancing the photo, you will add text elements based on the provided instructions.
*   **ABSOLUTE SPELLING & CONTENT ACCURACY:** The text you add to the image must be spelled *perfectly* and use the *exact* wording provided in the text instructions. DO NOT add, omit, or change any words. Any spelling error is a task failure.
*   **DYNAMIC COMPOSITION:** Within the Safe Zones, create a dynamic, visually engaging composition based on your Creative Mandate. Use varied angles and creative positioning.
*   **3D & REALISM:** When appropriate for the style, render the main text as a bold, chunky, 3D object that casts realistic shadows and reflects the scene's lighting.
${watermarkInstruction}`;
    
    let textInstruction = '';
    if (customMessage && customMessage.trim()) {
        textInstruction = `
        **Custom Text Overlay:**
        *   The user has provided a custom message that MUST be used for the text overlay.
        *   **EXACT TEXT TO USE:** "${customMessage.trim()}"
        *   **Your task:** Intelligently and creatively display this exact text on the image. You have creative freedom to split it into a main headline and a smaller sub-text for better design, or use it as a single block if that looks better. The most important words should be emphasized. Do not add any text that isn't in the provided message, except for the dealership watermark/logo if applicable. Ensure every word from the user's message is included.`;
    } else {
        const mainText = "Congratulations!";
        const subText = `Welcome to the ${dealershipName} Family`;
        textInstruction = `
        - Main Text: '${mainText}' should be the most prominent text element.
        - Sub-Text: '${subText}' should be smaller and placed thoughtfully in relation to the main text.`;
    }

    let styleInstruction = "";
    switch (style) {
        case StyleOption.Luxury:
            styleInstruction = `
                - Style Guide: Luxury & Elegance. Think high-end automotive brands (Mercedes, Audi), luxury watch ads, or premium real estate brochures.
                - Photo Enhancement: Apply a subtle warm or slightly desaturated color grade for a premium, cinematic feel. Enhance reflections on the car's paint and chrome. Soften any harsh sunlight shadows.
                - Font Inspiration: Sophisticated serif fonts (e.g., Garamond, Bodoni), elegant flowing scripts, or clean, minimalist sans-serifs with wide tracking.
                - Text Effect Inspiration: A metallic gold/silver/chrome sheen with realistic reflections, an elegant bevel, a soft, classy glow, or a simple, sharp white/black text with perfect placement.
                - Overall Feel: Refined, prestigious, exclusive, and celebratory.`;
            break;
        case StyleOption.Modern:
            styleInstruction = `
                - Style Guide: Modern & Bold. Think tech company announcements, streetwear brands, or a cutting-edge magazine cover.
                - Photo Enhancement: Boost vibrance and contrast for a sharp, clean, high-impact look. Apply a subtle cool color tint or a high-contrast black and white effect if it suits the image.
                - Font Inspiration: Strong, clean sans-serif fonts (e.g., Helvetica Neue Bold, Montserrat, Bebas Neue). Experiment with weights (e.g., Black for main text, Light for sub-text).
                - Text Effect Inspiration: Vibrant color gradients, a sharp drop shadow, a bold vector outline, or clean text placed inside a geometric shape.
                - Overall Feel: Energetic, fresh, exciting, and confident.`;
            break;
        case StyleOption.Friendly:
            styleInstruction = `
                - Style Guide: Fun & Friendly. Think local community events, family-run businesses, or a cheerful holiday card.
                - Photo Enhancement: Add a touch of warmth and brightness to create a happy, inviting atmosphere. Make colors feel welcoming and vibrant.
                - Font Inspiration: Rounded, playful sans-serifs, casual handwritten-style or script fonts.
                - Text Effect Inspiration: Bright, happy colors. Effects like a 3D "bubble" look, a colorful outline, a gentle arc, or placing text on a semi-transparent colored banner.
                - Overall Feel: Welcoming, cheerful, personal, and down-to-earth.`;
            break;
        case StyleOption.Sporty:
            styleInstruction = `
                - Style Guide: Sporty & Dynamic. Think racing advertisements, energy drink branding, or action movie posters.
                - Photo Enhancement: Increase contrast and apply a cool, slightly desaturated, or gritty color grade to enhance the dynamic, aggressive feel. A subtle vignette can add focus.
                - Font Inspiration: Italicized, forward-slanting sans-serifs to imply speed and motion. Distressed, stencil, or blocky fonts can also work.
                - Text Effect Inspiration: Brushed metal texture, a carbon fiber overlay, motion lines, a high-energy color like racing red or electric blue, or a grunge effect.
                - Overall Feel: Fast, powerful, thrilling, and high-energy.`;
            break;
    }

    return `${coreInstruction}
        ${varietyInstruction}
        ${textInstruction}
        
        **Your assigned style guide for THIS generation is:**
        ${styleInstruction}
        
        The final output must be a single, high-resolution image ready for social media.`;
};


const generateTextPrompt = (tone: ToneOption, dealershipName: string, customerName?: string, isRegeneration = false): string => {
    const nameInfo = customerName 
        ? `The customer's first name is ${customerName}. Personalize the post by addressing them directly.` 
        : "The customer's name was not provided, so refer to them as 'our latest happy customer' or a similar friendly phrase.";
    
    let toneInstruction = "";
    switch(tone) {
        case ToneOption.Excited:
            toneInstruction = "Write in an upbeat, energetic, and celebratory tone. Use exclamation points and enthusiastic language to convey excitement!";
            break;
        case ToneOption.Professional:
            toneInstruction = "Write in a more formal, polished, and professional tone. The language should be refined, focusing on quality, trust, and customer satisfaction.";
            break;
        case ToneOption.Family:
            toneInstruction = "Write in a warm, welcoming, and friendly tone, as if talking to a new member of the family. Keep it heartfelt, personal, and sincere.";
            break;
        case ToneOption.Humorous:
            toneInstruction = "Write in a witty, funny, and light-hearted tone. Feel free to use a clever pun related to cars or driving. The goal is to make people smile.";
            break;
        case ToneOption.Inspirational:
            toneInstruction = "Write in an uplifting and motivational tone. Focus on the idea of a new journey, new beginnings, or achieving a dream. The post should feel inspiring and positive.";
            break;
        case ToneOption.Urgent:
            toneInstruction = "Write in a compelling, promotional, and urgent tone. Create a sense of excitement and encourage people to visit the dealership soon. You can hint at great deals or a limited-time opportunity without mentioning specifics.";
            break;
    }
    
    const regenerationInstruction = isRegeneration ? "CRITICAL: The user is asking for a new version. This caption MUST be different from any previous one you've generated. Use a fresh angle." : "";

    return `You are an expert social media copywriter and viral marketing strategist for a car dealership. Your task is to write a short, vibrant, and highly engaging caption for the provided photo that will stop people from scrolling.

**ABSOLUTE, NON-NEGOTIABLE REQUIREMENTS:**
1.  **DEEP IMAGE ANALYSIS:** This is your most important task. Meticulously analyze the provided photo to identify:
    *   **The exact car:** Make, model, and estimated year (e.g., Ford Mustang GT, Toyota RAV4 Hybrid).
    *   **The car's characteristics:** Color, type (SUV, sedan, truck, sports car), and any visible special features.
    *   **The scene's vibe:** Is it a family, a solo adventurer, a first-time car owner? Is the background urban, suburban, sunny, etc.?
2.  **GENERATE A COMPLETE POST:** You MUST write a complete social media post (2-4 sentences), NOT just hashtags or a single sentence.
3.  **USE EMOJIS:** You MUST strategically use 2-4 relevant emojis to add personality and visual appeal.
4.  **FORMAT:** Your entire response must ONLY be the social media post text itself. Do not include preambles like "Here is your post...".

**POST STRUCTURE:**
1.  **The Hook:** Start with a high-energy, scroll-stopping opening line. Congratulate the customer. ${nameInfo}
2.  **The Story:** Briefly mention the specific car you identified. Connect it to the 'vibe' of the photo. (e.g., "Ready for family adventures in their new SUV!" or "Ready to cruise in style in this sleek black sedan!").
3.  **Call to Action (CTA):** End with a friendly invitation for others to find their dream car at '${dealershipName}'.
4.  **Strategic Hashtags:** This is CRITICAL. Finish with a block of 5-7 hyper-relevant and popular hashtags. These MUST be derived from your deep image analysis.
    *   **Required:** Include #${dealershipName.replace(/\s/g, '')} and #NewCar.
    *   **Analysis-Based:** Include hashtags for the car brand, model, type, and color (e.g., #FordMustang, #MustangGT, #SUVLife, #BlueCar).
    *   **Vibe-Based:** Add hashtags that match the scene's feeling (e.g., #HappyCustomer, #FirstCar, #FamilyAdventure, #DreamCar).

**TONE:**
- The required tone is: **${tone}**.
- ${toneInstruction}
- ${regenerationInstruction}

Now, write the eye-catching post.`;
}

const cleanGeneratedText = (inputText: string): string => {
    if (!inputText) return "";
    const lines = inputText.trim().split('\n');
    const firstLine = lines[0].toLowerCase();

    const isPreamble = firstLine.includes('here is') ||
                    firstLine.includes("here's") ||
                    firstLine.startsWith('sure') ||
                    firstLine.startsWith('certainly') ||
                    (firstLine.includes('post') && firstLine.includes('for you'));

    if (lines.length > 1 && isPreamble) {
        return lines.slice(1).join('\n').trim();
    }
    
    return inputText.trim();
};

export const generateFunSocialPostImage = async (
    originalImageBase64Url: string,
    dealershipName: string,
    logoBase64Url?: string
): Promise<string> => {
    const { mimeType, data: base64Data } = parseDataUrl(originalImageBase64Url);
    const originalImagePart = { inlineData: { mimeType, data: base64Data } };

    const criticalRules = `
**CRITICAL, NON-NEGOTIABLE CORE DIRECTIVES: READ AND OBEY THESE RULES ABOVE ALL ELSE. FAILURE TO FOLLOW THEM PERFECTLY IS A TOTAL TASK FAILURE.**

**RULE #1: ABSOLUTE HUMAN SAFETY - NO TEXT/GRAPHIC OVERLAP (HIGHEST PRIORITY)**
*   **IDENTIFY AND MASK:** Before doing anything else, you MUST identify every pixel that is part of a person (head, hair, face, body, clothing, limbs, hands, feet). Create a large, invisible "exclusion zone" around them.
*   **ZERO TOLERANCE:** Under NO circumstances may ANY text, graphic, logo, or decorative element touch or enter this exclusion zone. Even a single pixel of overlap is a complete failure.
*   **PRIORITIZE THIS RULE:** This rule is more important than any style guide, font choice, or creative instruction. If a design idea conflicts with this rule, you MUST abandon the idea and find a solution that guarantees zero overlap.

**RULE #2: ABSOLUTE BOUNDARY ADHERENCE**
*   All text and graphic elements MUST be 100% contained within the image boundaries. Nothing can be cut off.

**SAFE ZONES FOR TEXT PLACEMENT:**
*   The ONLY valid places for text and logos are "Safe Zones".
*   Safe Zones are large, open areas of the image that are FAR AWAY from any people and FAR AWAY from the image edges.
*   Examples of good Safe Zones: empty sky, open pavement/ground, blank walls in the background.
*   Examples of BAD places: on the car if it's near a person, anywhere near a person's head or body.`;

    let logoImagePart = null;
    if (logoBase64Url) {
        const { mimeType: logoMime, data: logoData } = parseDataUrl(logoBase64Url);
        logoImagePart = { inlineData: { mimeType: logoMime, data: logoData } };
    }

    const watermarkInstruction = logoBase64Url
        ? `A dealership logo has been provided as a second image. It is a MANDATORY REQUIREMENT to place this logo as a small, tasteful watermark in a lower corner of the final image. It must be styled to match the overall artistic theme but remain clearly legible and unobtrusive. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `The dealership name is '${dealershipName}'. You MUST use this EXACT name as a small, tasteful text watermark in a lower corner. Style it to match the aesthetic but keep it discreet. Double-check your spelling of '${dealershipName}'.`;

    const funStyles = [
        {
            name: "Superhero Comic Book Art",
            prompt: "Redraw the entire scene in a classic American superhero comic book style. Use bold, dynamic ink lines, vibrant primary colors, and halftone dots for shading. The people should look like powerful heroes, and the car should look like their iconic vehicle. The background should be energetic, maybe with speed lines or a dramatic cityscape."
        },
        {
            name: "Japanese Anime/Manga",
            prompt: "Transform the photo into a vibrant, high-quality Japanese anime scene. Give the people expressive, large eyes and stylized hair. Use clean lines and crisp cel-shading. The car should look sleek and futuristic. The background should be beautiful and dynamic, perhaps with sparkling light effects or dramatic speed lines."
        },
        {
            name: "Action Movie Poster",
            prompt: "Recreate the photo as a gritty, high-octane action movie poster. Use dramatic, high-contrast lighting with deep shadows. The people should have determined, heroic expressions. The car should look tough and ready for action. Add a fiery, explosive, or smoke-filled background for maximum intensity."
        },
        {
            name: "3D Animated Movie Style",
            prompt: "Reimagine the scene as if it's from a modern 3D animated family film (like Pixar or DreamWorks). Give the people and car soft, appealing, rounded features. The lighting should be warm, friendly, and magical. The overall feeling must be charming, heartwarming, and full of character."
        },
        {
            name: "Grand Theft Auto Art Style",
            prompt: "Recreate the image in the iconic, stylized art style of a Grand Theft Auto loading screen. Use heavy, distinct black outlines on characters and objects, a semi-realistic but illustrated look, and a specific, vibrant color palette. The scene should feel cool, edgy, and stylish."
        },
        {
            name: "Retro 80s Cartoon",
            prompt: "Transform the image into a scene from a classic 1980s Saturday morning cartoon. Use softer lines, a bright pastel and neon color palette, and a classic hand-drawn animation feel. The people and car should look like fun, adventurous cartoon characters."
        },
    ];

    const selectedStyle = funStyles[Math.floor(Math.random() * funStyles.length)];

    const funPrompt = `You are a master illustrator. Your task is to create a completely new piece of digital art from scratch. You have been given a reference photo, but you must NOT edit it.

**CORE MISSION: TOTAL ARTISTIC RE-CREATION. THIS IS A GENERATION TASK, NOT AN EDITING TASK.**

**YOUR ONLY GOAL:** Generate a brand new image that re-imagines the subjects (people, car) and their poses from the reference photo in the specified artistic style. The final image must be 100% your own, newly generated artwork.

**THE ROLE OF THE INPUT PHOTO:** The provided image is a **REFERENCE-ONLY** guide. Use it ONLY to understand:
1.  Who the people are (so you can maintain a recognizable likeness).
2.  What the car looks like.
3.  The general poses and composition of the scene.

**ABSOLUTE PROHIBITION: DO NOT EDIT THE ORIGINAL PHOTO.**
*   You are strictly FORBIDDEN from editing, filtering, modifying, or using any of the pixels from the input image in your final output.
*   The final image must NOT look like a simple filter or style transfer applied to the original. It must look like a completely new drawing or illustration.
*   Any output that appears to be an edit of the original photo is a COMPLETE TASK FAILURE. You must demonstrate a full artistic re-interpretation by creating the scene from a blank canvas.

${criticalRules}

**MANDATORY 3-PHASE CREATIVE PROCESS:**

**Phase 1: STYLE SELECTION**
- The artistic style for this generation has been randomly selected for you.
- **YOUR ASSIGNED STYLE:** ${selectedStyle.name}
- **STYLE DESCRIPTION:** ${selectedStyle.prompt}

**Phase 2: ARTISTIC TRANSFORMATION**
1.  **Analyze Original Photo:** Identify the people, their poses, clothing, and key features. Identify the car's model and color.
2.  **Apply Assigned Style:** Radically redraw and reimagine the ENTIRE scene based on the assigned style description above.
3.  **PRESERVE LIKENESS:** This is CRITICAL. The transformed people MUST be clearly recognizable as the individuals from the original photo. Capture their hair style, facial structure, and general appearance, but render them completely in the new style. The car must also be recognizable. The result should be a fun caricature, not a generic character.

**Phase 3: STYLIZED TEXT & BRANDING**
1.  **Integrate Text Creatively:** You MUST add the following text to the image, styled to PERFECTLY match the artistic theme:
    *   **Main Text:** "Congratulations!"
    *   **Sub-Text:** "Welcome to the '${dealershipName}' Family". **CRITICAL:** You MUST spell the dealership name exactly as it appears: '${dealershipName}'.
2.  **Styling Guide for Text:** The text's font, color, texture, and effects must be an integral part of the chosen artistic style. It must look like it belongs in the scene (e.g., a comic book sound effect bubble, cinematic movie title font, etc.), not just placed on top.
3.  **Integrate Watermark/Branding:** ${watermarkInstruction} This is separate from the sub-text and should be placed discreetly in a corner, also styled to match the theme.

The final output must be a single, high-resolution, fully-composed image in the assigned artistic style, complete with integrated text.`;


    const imageParts: any[] = [originalImagePart, { text: funPrompt }];
    if (logoImagePart) {
        imageParts.push(logoImagePart);
    }
    
    const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: imageParts },
        config: {
            responseModalities: [Modality.IMAGE],
        }
    });

    const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
    if (imageContentPart && imageContentPart.inlineData) {
        const generatedImageMime = imageContentPart.inlineData.mimeType;
        const generatedImageData = imageContentPart.inlineData.data;
        return `data:${generatedImageMime};base64,${generatedImageData}`;
    }

    throw new Error("Failed to generate fun mode image from AI.");
};

export const editSocialPostImage = async (
    previousImageBase64Url: string,
    editPrompt: string,
    dealershipName: string,
    logoBase64Url?: string
): Promise<string> => {
    const { mimeType, data: base64Data } = parseDataUrl(previousImageBase64Url);
    const previousImagePart = { inlineData: { mimeType, data: base64Data } };

    let logoImagePart = null;
    if (logoBase64Url) {
        const { mimeType: logoMime, data: logoData } = parseDataUrl(logoBase64Url);
        logoImagePart = { inlineData: { mimeType: logoMime, data: logoData } };
    }
    
    const criticalRulesForEditing = `
**CRITICAL, NON-NEGOTIABLE CORE DIRECTIVES FOR EDITING: READ AND OBEY THESE RULES ABOVE ALL ELSE. FAILURE TO FOLLOW THEM PERFECTLY IS A TOTAL TASK FAILURE.**

**RULE #1: ABSOLUTE HUMAN SAFETY - NO TEXT/GRAPHIC OVERLAP (HIGHEST PRIORITY)**
*   Your highest priority is to follow the user's edit request *without* placing any new text or elements over any part of the people in the photo.
*   **IDENTIFY AND MASK:** Before doing anything else, you MUST identify every pixel that is part of a person (head, hair, face, body, clothing, limbs, hands, feet). Create a large, invisible "exclusion zone" around them.
*   **ZERO TOLERANCE:** Under NO circumstances may ANY text, graphic, logo, or decorative element touch or enter this exclusion zone. This is a non-negotiable, zero-tolerance rule. Any violation is a task failure.

**RULE #2: ABSOLUTE BOUNDARY ADHERENCE**
*   All text and graphic elements you add or modify MUST be 100% contained within the visible boundaries of the image. Nothing can be cropped or cut off by the edge.

**SAFE ZONES FOR TEXT PLACEMENT:**
*   The ONLY valid places for text and logos are "Safe Zones"—large, open areas far away from people and edges (e.g., empty sky, open ground, blank walls).`;

    const watermarkInstruction = logoBase64Url
        ? `A dealership logo has been provided as a second image. It is a CRITICAL REQUIREMENT to ensure this logo is present and tastefully placed in a corner of the final edited image. Do not distort it. If the logo was missing from the original image, you MUST add it now. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `The dealership name is '${dealershipName}'. If a text watermark with this name was on the original image, ensure it remains or is tastefully reapplied.`;

    const editInstruction = `Act as a world-class photo editor and graphic designer. You have been provided an image that was previously generated for a social media post. The user wants you to make specific edits.

${criticalRulesForEditing}

    **USER'S EDIT REQUEST:** "${editPrompt}"

    **YOUR TASK:**
    1.  Carefully analyze the user's request.
    2.  Apply the requested changes to the provided image, strictly following the Core Directives above.
    3.  **MAINTAIN QUALITY:** Ensure the final image is high-resolution and looks professional.
    4.  **WATERMARK/LOGO:** ${watermarkInstruction}
    5.  **PERFECT WORDING:** If the user asks to change or add text, you MUST use the exact spelling and wording they provide. Do not add, omit, or change any words from their request.

    The final output must be only the edited image.`;

    const imageParts: any[] = [previousImagePart, { text: editInstruction }];
    if (logoImagePart) {
        imageParts.push(logoImagePart);
    }

    const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: imageParts,
        },
        config: {
            responseModalities: [Modality.IMAGE],
        }
    });

    let newImageBase64 = '';
    const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
    if (imageContentPart && imageContentPart.inlineData) {
        const generatedImageMime = imageContentPart.inlineData.mimeType;
        const generatedImageData = imageContentPart.inlineData.data;
        newImageBase64 = `data:${generatedImageMime};base64,${generatedImageData}`;
    }

    if (!newImageBase64) {
        throw new Error("Failed to generate edited image from AI.");
    }

    return newImageBase64;
};

export const generateSocialPostText = async (
    imageBase64Url: string, 
    tone: ToneOption,
    dealershipName: string,
    customerName?: string,
    isRegeneration = false,
): Promise<string> => {
    const { mimeType, data: base64Data } = parseDataUrl(imageBase64Url);
    const imagePart = { inlineData: { mimeType, data: base64Data } };
    const textPrompt = generateTextPrompt(tone, dealershipName, customerName, isRegeneration);

    const textResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: { parts: [ imagePart, { text: textPrompt } ] }
    });
    
    const text = cleanGeneratedText(textResponse.text);
    if (!text) {
        throw new Error("Failed to generate post text from AI.");
    }
    return text;
};

export const editSocialPostText = async (
    originalText: string,
    editPrompt: string,
    tone: ToneOption
): Promise<string> => {
    const prompt = `You are an expert social media copy editor. A user has provided text for a post and an edit request.
    
    **Original Text:**
    "${originalText}"

    **User's Edit Request:**
    "${editPrompt}"

    **Tone to maintain:**
    ${tone}

    **Your task:**
    Rewrite the original text to incorporate the user's request while maintaining the specified tone. The output MUST be only the new, edited text, ready to be copied and pasted. Do not include any preamble.`;

    const textResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
    });

    const text = cleanGeneratedText(textResponse.text);
    if (!text) {
        throw new Error("Failed to edit post text with AI.");
    }
    return text;
};


export const generateSocialPost = async (
    imageBase64Url: string, 
    style: StyleOption, 
    tone: ToneOption,
    dealershipName: string,
    customerName?: string,
    logoBase64Url?: string,
    initialText?: string,
): Promise<{ image: string; text: string }> => {
    const { mimeType, data: base64Data } = parseDataUrl(imageBase64Url);

    const imagePart = {
        inlineData: {
            mimeType,
            data: base64Data,
        },
    };

    let logoImagePart = null;
    if (logoBase64Url) {
        const { mimeType: logoMime, data: logoData } = parseDataUrl(logoBase64Url);
        logoImagePart = {
            inlineData: {
                mimeType: logoMime,
                data: logoData,
            },
        };
    }
    
    // Generate text (or use provided template/custom text) and the final image in parallel.
    const textPromise = initialText 
        ? Promise.resolve(initialText) 
        : generateSocialPostText(imageBase64Url, tone, dealershipName, customerName);

    const imagePrompt = generateImagePrompt(style, dealershipName, !!logoImagePart, initialText);
    const imageParts: (typeof imagePart | { text: string })[] = [imagePart, { text: imagePrompt }];
    if (logoImagePart) {
        imageParts.push(logoImagePart);
    }

    const imagePromise = ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: imageParts },
        config: { responseModalities: [Modality.IMAGE] }
    });

    const [textResult, imageResponse] = await Promise.all([textPromise, imagePromise]);
    
    let newImageBase64 = '';
    const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
    if (imageContentPart && imageContentPart.inlineData) {
        const generatedImageMime = imageContentPart.inlineData.mimeType;
        const generatedImageData = imageContentPart.inlineData.data;
        newImageBase64 = `data:${generatedImageMime};base64,${generatedImageData}`;
    }

    if (!textResult || !newImageBase64) {
        throw new Error("Failed to generate social post content from AI.");
    }

    return { image: newImageBase64, text: textResult };
};

const generateVideoPrompt = (style: VideoStyle): string => {
    const coreInstruction = "You are an AI motion graphics artist. You are given a static image of a person or people celebrating their new car. Your task is to transform this image into a short, dynamic, 4-second video clip. Do not change the subjects in the image; only add animation and effects based on the chosen theme.";

    let styleInstruction = "";
    switch(style) {
        case VideoStyle.EpicReveal:
            styleInstruction = "Theme: 'Epic Reveal'. Animate the image with a very slow, smooth cinematic zoom-in effect, focusing on the car and the happy customers. Add subtle, elegant lens flares that sweep across the screen. Introduce gentle, glowing light rays that emanate from behind the car. The overall mood should be premium, celebratory, and awe-inspiring.";
            break;
        case VideoStyle.PartyTime:
            styleInstruction = "Theme: 'Party Time'. Create a high-energy, celebratory video. Animate colorful, realistic confetti and streamers falling all around the scene. Add a subtle, rhythmic 'pulse' or 'bounce' to the image to give it a fun, party vibe. The motion should be upbeat and exciting.";
            break;
        case VideoStyle.VintageFilm:
            styleInstruction = "Theme: 'Vintage Film'. Give the video a nostalgic, retro 8mm or 16mm film look. Add a noticeable film grain overlay, subtle scratches, and dust specks. Create a gentle, slightly unsteady 'camera shake' effect. Incorporate warm-toned light leaks that occasionally flash in from the sides of the frame.";
            break;
        case VideoStyle.NeonPulse:
            styleInstruction = "Theme: 'Neon Pulse'. Transform the scene with a futuristic, high-tech aesthetic. Trace the main contours of the car and people with thin, glowing neon lines. Make these lines pulse rhythmically with a soft glow. Add a subtle 'glitch' or 'scan line' effect over the video for a digital feel. The mood is cool, modern, and electronic.";
            break;
        case VideoStyle.CometStrike:
            styleInstruction = "Theme: 'Comet Strike'. Create a magical and enchanting reveal. Animate a bright, sparkling streak of light, like a comet's tail, that gracefully swoops across the screen, revealing the image as it passes. The comet should leave a trail of glittering particles that gently fade away. The overall feel is magical, wondrous, and special.";
            break;
    }
    return `${coreInstruction} ${styleInstruction}`;
}

const getImageDimensions = (dataUrl: string): Promise<{width: number, height: number}> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => {
            reject(new Error("Could not load image to determine dimensions."));
        }
        img.src = dataUrl;
    });
};

export const generatePostVideo = async (imageBase64Url: string, style: VideoStyle): Promise<string> => {
    // Re-initialize 'ai' instance just before the call to ensure the latest key is used.
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const { mimeType, data: base64Data } = parseDataUrl(imageBase64Url);
    const image = { imageBytes: base64Data, mimeType };
    const prompt = generateVideoPrompt(style);

    const { width, height } = await getImageDimensions(imageBase64Url);
    const aspectRatio = width > height ? '16:9' : '9:16';

    // FIX: Replaced deprecated 'GenerateVideosOperationResponse' with 'GenerateVideosOperation' to align with the latest SDK.
    let operation: GenerateVideosOperation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        image: image,
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: aspectRatio
        }
    });

    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;

    if (!downloadLink) {
        throw new Error("Video generation succeeded, but no download link was provided.");
    }
    
    // Fetch the video as a blob and create a local URL.
    // This avoids needing the API key on the client-side for the video src tag.
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to download the generated video. Status: ${response.status}. Body: ${errorBody}`);
    }
    const videoBlob = await response.blob();
    return URL.createObjectURL(videoBlob);
}