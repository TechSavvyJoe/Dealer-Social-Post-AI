import { GoogleGenAI, Modality, Type } from "@google/genai";
import { parseDataUrl } from '../utils/imageUtils';
import { StyleOption, ToneOption, VideoStyle } from "../types";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const generateImagePrompt = (style: StyleOption, dealershipName: string, hasLogo: boolean, customMessage?: string): string => {
    const faceAvoidanceInstruction = `
**THE ABSOLUTE #1 MOST IMPORTANT RULE: ZERO OVERLAP WITH PEOPLE.**
- **NON-NEGOTIABLE CORE DIRECTIVE:** Under NO circumstances may ANY text, graphic element, logo, or decorative flourish overlap with ANY part of a human being in the photo. This is a zero-tolerance, absolute rule.
- **EXTENDED DEFINITION OF "PERSON":** This rule includes the entire person: head, hair, face, neck, shoulders, body, arms, legs, and hands.
- **MANDATORY SAFETY BUFFER:** You MUST create an invisible "safety buffer" of empty space around each person. No text or element can even touch this buffer.
- **IMMEDIATE TASK FAILURE:** Any violation, no matter how small—even a single pixel of text touching a strand of hair—constitutes a complete and total failure of the task. The entire image will be rejected. You MUST prioritize this rule above all other stylistic instructions.
- **SAFE ZONES:** The only acceptable places for text and logos are "Safe Zones," which are large, open areas like the sky, empty ground, or blank walls, far away from any people.`;
    
    const watermarkInstruction = hasLogo
        ? `*   **MANDATORY LOGO PLACEMENT:** A second image has been provided—this is the dealership's logo. It is a CRITICAL REQUIREMENT that you place this logo as a small, tasteful watermark in a lower corner of the final image, inside a Safe Zone. Do not distort it. Do NOT use the dealership name as a text watermark if the logo image is present. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `*   **WATERMARK:** The dealership name, '${dealershipName}', MUST be used as a text watermark. Use the *exact* spelling provided and place it tastefully in a lower corner within a Safe Zone.`;

    const varietyInstruction = `**CRITICAL CREATIVE MANDATE:** For this specific generation, you MUST create a unique and visually fresh design. Do not default to a standard template. You are a creative designer, so be creative! Experiment with the following elements within the chosen style guide below:
- **Font Combination:** Choose a unique pair of complementary fonts (one for the main text, one for the sub-text) that fit the selected style.
- **Color Palette:** Select a dynamic color palette. You should derive the primary colors from the car, the background scene, or the customer's clothing to create a harmonious and professional design.
- **Text Layout:** Experiment with creative layouts. Consider angled text, stacked words, curved text, or integrating text with the car's lines, while ALWAYS staying in the Safe Zones.
- **Text Effects:** Apply a unique and tasteful text effect. Examples include a subtle neon glow, a realistic metallic sheen, a bold drop shadow, an elegant outline, or a 3D effect. The goal is to make every post look like a custom, one-of-a-kind design.`;

    const coreInstruction = `Act as a world-class graphic designer with an infallible eye for composition. Your mission is to create a viral-worthy social media post by enhancing a photo and adding text overlays. You have been provided a primary photo of a customer and their car. You may also have been provided a second image which is a company logo.

${faceAvoidanceInstruction}

You must follow this process:

**Step 1: PHOTO ENHANCEMENT**
Perform a full, professional-grade photo enhancement on the original image to make it significantly brighter, more vibrant, and visually appealing.
*   **BRIGHTEN & ENHANCE:** Significantly increase the overall brightness and vibrancy. The goal is a bright, clear, and eye-catching image that pops.
*   **FLATTERING LIGHTING:** Intelligently balance lighting. Eliminate harsh shadows on people and the car, adding a soft 'fill light' effect for a professional studio look.
*   **COLOR GRADING & POLISH:** Apply a rich, appealing color grade. Add a final touch of sharpening to make details crisp and clear.

**Step 2: INTELLIGENT TEXT OVERLAY (Restricted to Safe Zones)**
After enhancing the photo, you will add text elements.
*   **DYNAMIC COMPOSITION:** Within the Safe Zones, create a dynamic, visually engaging composition based on your Creative Mandate. Use varied angles and creative positioning.
*   **SPELLING ACCURACY:** The text must be spelled *exactly* as provided.
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
    
    const regenerationInstruction = isRegeneration ? "You are generating a NEW version of a caption. It MUST be different from the previous one. Be creative and come up with a fresh angle." : "";

    return `You are a creative social media manager for a car dealership. Your task is to write a compelling and varied social media post caption based on an image of a happy customer with their new car.
${regenerationInstruction}

**Image Analysis:**
First, analyze the provided image to identify the car's make, model, and approximate year.

**Core Information:**
- ${nameInfo}
- Our dealership is named '${dealershipName}'.
- ${toneInstruction}

**CREATIVE WRITING INSTRUCTIONS:**
You MUST make each post unique. Do not use repetitive phrasing.
1.  **Unique Opening Hook:** Start the post with an engaging opening line. DO NOT use the same one every time.
    *   *Examples:* "And just like that, another dream car hits the road!", "From our showroom to their driveway! Huge congratulations to ${customerName || 'our newest customer'}!", "It's more than a car, it's a new chapter! We're so thrilled for...", "That new car feeling is unbeatable! We were so excited to help ${customerName || 'our latest happy customer'} get the keys to this beauty.", "Putting smiles on miles! Check out ${customerName || 'our latest happy customer'} with their incredible new ride."
2.  **Varied Call-to-Action (CTA):** Your call-to-action at the end should also be varied.
    *   *Examples:* "Who's next? Come find your perfect ride!", "Ready for an upgrade? Your dream car is waiting for you at ${dealershipName}!", "Experience the ${dealershipName} difference for yourself. Visit us today!", "Want a dealership experience this good? You know where to find us!"
3.  **Engage with a Question:** When appropriate for the tone, consider ending with a question to encourage comments.
    *   *Examples:* "What's the first road trip you'd take in this?", "What do you love most about this model?", "Let us know in the comments what you think of this color!"

**Task:**
Craft the social media post. Keep the caption concise and punchy, ideally 2-3 sentences plus hashtags. The goal is maximum engagement on platforms with character limits. Include details about the car you identified. Congratulate the customer. End with a strong CTA and relevant hashtags. The hashtags should include #NewCar, #HappyCustomer, #${dealershipName.replace(/\s/g, '')}, and specific hashtags for the car's make and model.

**Output Format:**
Your entire response must ONLY be the social media post text itself. Do not include any introductory phrases like "Here is a social media post..." or "Sure, here's a post...". The response should be ready to be copied and pasted directly.`;
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

    const faceAvoidanceInstruction = `
**THE ABSOLUTE #1 MOST IMPORTANT RULE: ZERO OVERLAP WITH PEOPLE.**
- **NON-NEGOTIABLE CORE DIRECTIVE:** Under NO circumstances may ANY text, graphic element, logo, or decorative flourish overlap with ANY part of a human being in the photo. This is a zero-tolerance, absolute rule.
- **EXTENDED DEFINITION OF "PERSON":** This rule includes the entire person: head, hair, face, neck, shoulders, body, arms, legs, and hands.
- **MANDATORY SAFETY BUFFER:** You MUST create an invisible "safety buffer" of empty space around each person. No text or element can even touch this buffer.
- **IMMEDIATE TASK FAILURE:** Any violation, no matter how small—even a single pixel of text touching a strand of hair—constitutes a complete and total failure of the task. The entire image will be rejected. You MUST prioritize this rule above all other stylistic instructions.`;

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

    const funPrompt = `You are a world-class concept artist and digital illustrator.

**NON-NEGOTIABLE CORE DIRECTIVE: TOTAL RE-ILLUSTRATION REQUIRED.**
You are being tasked to perform a radical, family-friendly, and fun artistic transformation. This is NOT a filtering or editing job. It is a full-scale re-illustration. You MUST completely redraw the entire image from a blank canvas in the new artistic style provided below. The original photo is ONLY a reference for the subjects (people, car), their poses, and their likeness. Any result that looks like the original photo with an effect applied is an IMMEDIATE and TOTAL FAILURE of the task. The final pixels must be 100% generated by you. This is the most important rule.

${faceAvoidanceInstruction}

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

    const watermarkInstruction = logoBase64Url
        ? `A dealership logo has been provided as a second image. It is a CRITICAL REQUIREMENT to ensure this logo is present and tastefully placed in a corner of the final edited image. Do not distort it. If the logo was missing from the original image, you MUST add it now. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `The dealership name is '${dealershipName}'. If a text watermark with this name was on the original image, ensure it remains or is tastefully reapplied.`;

    const editInstruction = `Act as a world-class photo editor and graphic designer. You have been provided an image that was previously generated for a social media post. The user wants you to make specific edits.

    **THE ABSOLUTE #1 MOST IMPORTANT RULE: ZERO OVERLAP WITH PEOPLE.**
    - Your highest priority is to follow the user's edit request *without* placing any new text or elements over any part of the people in the photo. 
    - This is a non-negotiable, zero-tolerance rule that includes their heads, faces, hair, and bodies. Any violation is a task failure.

    **USER'S EDIT REQUEST:** "${editPrompt}"

    **YOUR TASK:**
    1.  Carefully analyze the user's request.
    2.  Apply the requested changes to the provided image, strictly following the "ZERO OVERLAP" rule above.
    3.  **MAINTAIN QUALITY:** Ensure the final image is high-resolution and looks professional.
    4.  **WATERMARK/LOGO:** ${watermarkInstruction}

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
): Promise<string> => {
    const { mimeType, data: base64Data } = parseDataUrl(imageBase64Url);
    const imagePart = { inlineData: { mimeType, data: base64Data } };
    const textPrompt = generateTextPrompt(tone, dealershipName, customerName, true);

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

export const generateAnimatedPost = async (
    imageBase64Url: string,
    style: VideoStyle,
): Promise<string> => {
    // Per guideline: Create a new GoogleGenAI instance right before making a VEO API call
    // to ensure it always uses the most up-to-date API key from the selection dialog.
    const videoAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const { mimeType, data: base64Data } = parseDataUrl(imageBase64Url);
    
    const videoPrompts: Record<VideoStyle, { name: string; prompt: string; }> = {
        [VideoStyle.EpicReveal]: {
            name: "Epic Reveal",
            prompt: "Create an ultra-luxurious, cinematic 4-second video reveal. The camera starts with a close-up and performs a slow, elegant dolly zoom backward. As it zooms, animate subtle, brilliant light glints sweeping across the car's bodywork and chrome. High-quality, anamorphic lens flares should gracefully wipe across the screen. The person in the photo should have a subtle animation, like a slow, proud smile forming. The 'Congratulations' text fades in smoothly with a soft glow. The final shot must feel prestigious, awe-inspiring, and worthy of a high-end car commercial.",
        },
        [VideoStyle.PartyTime]: {
            name: "Party Time",
            prompt: "Generate an explosive, high-energy 4-second celebratory video. Animate the people into a joyful jump or cheer. As they do, trigger a vibrant burst of multi-colored, metallic, slow-motion confetti that fills the air. The camera should perform a quick, energetic 'punch-in' zoom and have a very slight celebratory shake. The 'Congratulations' text should bounce into frame with a playful, springy animation. The entire video must feel like an exhilarating, fun-filled party moment.",
        },
        [VideoStyle.VintageFilm]: {
            name: "Vintage Film",
            prompt: "Produce an authentic, nostalgic 4-second video with a Super 8mm vintage film aesthetic. The colors must be warm and desaturated. The video should feature realistic film grain, a subtle vignette, soft focus, and occasional light leaks flickering from the edges. Animate a slight 'film gate weave' and a gentle, hand-cranked camera jitter. The text on the image should flicker subtly, as if part of the original film projection. The mood should be warm, timeless, and deeply nostalgic.",
        },
        [VideoStyle.NeonPulse]: {
            name: "Neon Pulse",
            prompt: "Create a slick, high-tech 4-second animation with a cyberpunk aesthetic. Animate vibrant neon lines that trace the car's contours, pulsing in sync with an imagined electronic beat. The ground should be reflective, as if rain-slicked, mirroring the neon glow. The text on the image should animate as if it's a flickering, holographic sign. The background should have a subtle digital glitch effect. The overall mood must be cool, futuristic, and stylish.",
        },
        [VideoStyle.CometStrike]: {
            name: "Comet Strike",
            prompt: "Generate a magical and enchanting 4-second video. Animate a brilliant comet of light, with a trail of sparkling, ethereal particles, arcing across the screen. The comet's color should complement the car's color. As the comet passes, it should magically animate the people to wave happily. The camera should pan slightly to follow the comet's path. The 'Congratulations' text should materialize with a beautiful sparkle effect, leaving a faint, lingering magical glow. The scene should feel wondrous and eye-catching.",
        }
    };

    const selectedPrompt = videoPrompts[style].prompt;
    
    let operation = await videoAi.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: selectedPrompt,
        image: {
            imageBytes: base64Data,
            mimeType: mimeType,
        },
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '1:1'
        }
    });

    while (!operation.done) {
        await sleep(5000); // Poll every 5 seconds for faster status updates
        operation = await videoAi.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation completed, but no download link was found.");
    }

    // Per guideline: The download link requires the API key to be appended for authorization.
    const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    if (!videoResponse.ok) {
        throw new Error(`Failed to download the generated video. Status: ${videoResponse.statusText}`);
    }
    
    const videoBlob = await videoResponse.blob();
    const videoObjectUrl = URL.createObjectURL(videoBlob);
    
    return videoObjectUrl;
};