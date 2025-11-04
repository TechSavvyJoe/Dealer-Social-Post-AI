import { GoogleGenAI, Modality, Type } from "@google/genai";
import { parseDataUrl } from '../utils/imageUtils';
import { StyleOption, ToneOption } from "../types";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface FaceBox {
    box: [number, number, number, number]; // [x_min, y_min, x_max, y_max]
}

/**
 * Uses a vision model to detect faces and return their bounding boxes.
 */
const detectFaces = async (imagePart: { inlineData: { mimeType: string, data: string } }): Promise<FaceBox[]> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [imagePart] },
            config: {
                systemInstruction: "You are a highly accurate face detection model. Analyze the user's image and identify all human faces. For each face, provide a bounding box with normalized coordinates (from 0.0 to 1.0) for [x_min, y_min, x_max, y_max]. If no faces are found, return an empty 'faces' array.",
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        faces: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    box: {
                                        type: Type.ARRAY,
                                        description: 'Bounding box with normalized coordinates [x_min, y_min, x_max, y_max].',
                                        items: { type: Type.NUMBER },
                                        minItems: 4,
                                        maxItems: 4
                                    }
                                },
                                required: ['box']
                            }
                        }
                    },
                    required: ['faces']
                },
            },
        });

        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);
        return result.faces || [];
    } catch (error) {
        console.error("Error detecting faces:", error);
        // If face detection fails, return an empty array to not block the main flow.
        // The image generator will fall back to its visual analysis.
        return [];
    }
};


const generateImagePrompt = (style: StyleOption, dealershipName: string, faces: FaceBox[], hasLogo: boolean): string => {
    let faceAvoidanceInstruction = ``;

    if (faces && faces.length > 0) {
        const faceBoxesString = faces.map(f => `[${f.box.join(', ')}]`).join(', ');
        faceAvoidanceInstruction = `
1.  **Programmatically Identified No-Fly Zones:** This image has been pre-analyzed. The following bounding boxes contain human faces and are ABSOLUTE NO-FLY ZONES.
    *   Face Bounding Boxes (normalized coordinates [x_min, y_min, x_max, y_max]): ${faceBoxesString}
    *   You MUST NOT place any text or graphic elements within these boxes.
    *   You MUST add a significant buffer zone (at least 15% of the box height/width) around each of these boxes to ensure text is not crowded near faces.
    *   This is the most critical instruction. Failure to adhere to it will result in a failed task.

2.  **Visual Unsafe Zone Identification:** In addition to the boxes above, visually identify other key vehicle features (grille, headlights, logos). These are also No-Fly Zones.`;
    } else {
        faceAvoidanceInstruction = `
1.  **Identify Unsafe Zones (No-Fly Zones):** Before you do anything else, you MUST analyze the image and identify all areas that are off-limits. These are your "No-Fly Zones".
    *   **Human Faces:** Locate ALL human faces in the photograph. These are the most critical No-Fly Zones.
    *   **Key Vehicle Features:** Identify the car's grille, headlights, and any brand logos. These are also No-Fly Zones.`;
    }
    
    const watermarkInstruction = hasLogo
        ? `*   **WATERMARK:** A second image has been provided - this is the dealership's logo. You MUST place this logo image as a small, tasteful watermark in a lower corner of the final image, inside a Safe Zone. Do not distort it. Do NOT use the dealership name text as a watermark.`
        : `*   **WATERMARK:** The dealership name, '${dealershipName}', MUST be used as a text watermark. Use the *exact* spelling provided and place it tastefully in a lower corner within a Safe Zone.`;

    const coreInstruction = `Act as a world-class graphic designer with an infallible eye for composition. Your mission is to create a viral-worthy social media post by enhancing a photo and adding text overlays. You have been provided a primary photo of a customer and their car. You may also have been provided a second image which is a company logo. You must follow a strict, mandatory 2-phase process.

**MANDATORY 2-PHASE PROCESS**

**Phase 1: SAFE ZONE ANALYSIS & PHOTO ENHANCEMENT (Perform this first!)**

${faceAvoidanceInstruction}

3.  **Identify Safe Zones:** After you have definitively identified all No-Fly Zones (both programmatically and visually), you MUST find large, open areas suitable for text. These "Safe Zones" are your canvas.
    *   Good examples include: The open sky, the empty ground, a blank building wall, or the upper/lower thirds of the image IF AND ONLY IF they are clear of people and key vehicle features.

4.  **Professional Photo Enhancement:** Simultaneously, perform a full photo enhancement on the original image.
    *   **Auto-Correction:** Automatically adjust brightness, contrast, and saturation.
    *   **Lighting & Shadow Balancing:** Subtly lighten harsh shadows on the people and car.
    *   **Color Grading & Sharpening:** Apply a professional color grade and a touch of sharpening.

**Phase 2: INTELLIGENT TEXT OVERLAY (Restricted to Safe Zones)**

**CRITICAL RULE: ALL text and graphic elements MUST be placed exclusively within the "Safe Zones" you identified in Phase 1.**

*   **ABSOLUTE FAILURE CONDITION:** Placing ANY text over a human face is an immediate and total failure. Adherence to the "No-Fly Zone" rule is the most important part of your task.
*   **DYNAMIC COMPOSITION:** Within the Safe Zones, create a dynamic, visually engaging composition. Use varied angles and creative positioning.
*   **SPELLING ACCURACY:** The text must be spelled *exactly* as provided: "Congratulations!".
*   **3D & REALISM:** Render the main text as a bold, chunky, 3D object that casts realistic shadows and reflects the scene's lighting.
${watermarkInstruction}`;
    
    const mainText = "Congratulations!";
    const subText = `Welcome to the ${dealershipName} Family`;

    let styleInstruction = "";
    switch (style) {
        case StyleOption.Luxury:
            styleInstruction = `
                - Style: Luxury & Elegance. Think high-end automotive brands.
                - Photo Enhancement: Apply a subtle warm color grade for a premium feel. Enhance reflections on the car's paint and chrome. Soften any harsh sunlight shadows.
                - Main Text Font: Use a sophisticated serif font or a flowing script. Apply a premium effect like a metallic gold/silver sheen with realistic reflections, an elegant bevel, or a soft, classy glow.
                - Sub-Text Font: Use a clean, smaller serif font in a soft white or cream.
                - Overall Feel: Refined, prestigious, celebratory.`;
            break;
        case StyleOption.Modern:
            styleInstruction = `
                - Style: Modern & Bold. Think tech company announcement.
                - Photo Enhancement: Boost vibrance and contrast for a sharp, clean, high-impact look. Apply a subtle cool color tint.
                - Main Text Font: Use a strong, clean sans-serif font (like Helvetica Neue Bold or Montserrat). Make it pop with a vibrant color gradient, a sharp drop shadow, or a bold vector outline.
                - Sub-Text Font: A lighter weight of the main sans-serif font.
                - Overall Feel: Energetic, fresh, and exciting.`;
            break;
        case StyleOption.Friendly:
            styleInstruction = `
                - Style: Fun & Friendly. Think local community event.
                - Photo Enhancement: Add a touch of warmth and brightness to create a happy, inviting atmosphere. Make colors feel welcoming.
                - Main Text Font: Use a rounded, playful, or casual handwritten-style font. Apply bright, happy colors, maybe with a 3D "bubble" effect, a colorful outline, or placed on a semi-transparent colored shape.
                - Sub-Text Font: A simple, clean sans-serif font.
                - Overall Feel: Welcoming, cheerful, and personal.`;
            break;
        case StyleOption.Sporty:
            styleInstruction = `
                - Style: Sporty & Dynamic. Think racing advertisement.
                - Photo Enhancement: Increase contrast and apply a cool, slightly desaturated color grade to enhance the dynamic, aggressive feel.
                - Main Text Font: Use an italicized, forward-slanting sans-serif to imply speed. Apply effects like a brushed metal texture, carbon fiber overlay, or motion lines. Use high-energy colors like racing red or electric blue.
                - Sub-Text Font: A sleek, modern sans-serif.
                - Overall Feel: Fast, powerful, and thrilling.`;
            break;
    }

    return `${coreInstruction}
        - Main Text: '${mainText}' should be the most prominent text element.
        - Sub-Text: '${subText}' should be smaller and placed thoughtfully in relation to the main text.
        ${styleInstruction}
        The final output must be a single, high-resolution image ready for social media.`;
};


const generateTextPrompt = (tone: ToneOption, dealershipName: string, customerName?: string): string => {
    const nameInfo = customerName 
        ? `The customer's first name is ${customerName}. Personalize the post by addressing them directly.` 
        : "The customer's name was not provided, so refer to them as 'our latest happy customer'.";
    
    let toneInstruction = "";
    switch(tone) {
        case ToneOption.Excited:
            toneInstruction = "Write in an upbeat, energetic, and celebratory tone. Use exclamation points to convey excitement!";
            break;
        case ToneOption.Professional:
            toneInstruction = "Write in a more formal, polished, and professional tone. The language should be refined and focused on quality and customer satisfaction.";
            break;
        case ToneOption.Family:
            toneInstruction = "Write in a warm, welcoming, and friendly tone, as if talking to a new member of the family. Keep it heartfelt and personal.";
            break;
    }

    return `Analyze this image of a happy customer with their new car. Identify the car's make, model, and approximate year. 
        ${nameInfo}
        Our dealership is named '${dealershipName}'.
        ${toneInstruction}
        Craft a compelling social media post that congratulates the customer. Include a call-to-action like 'Visit us at ${dealershipName} to find your dream car!'. 
        End with relevant hashtags, including #NewCar, #HappyCustomer, #${dealershipName.replace(/\s/g, '')}, and specific hashtags for the car's make and model you identified.

IMPORTANT: Your entire response must ONLY be the social media post text itself. Do not include any introductory phrases like "Here is a social media post..." or "Sure, here's a post...". The response should be ready to be copied and pasted directly.`;
}


export const generateSocialPost = async (
    imageBase64Url: string, 
    style: StyleOption, 
    tone: ToneOption,
    dealershipName: string,
    customerName?: string,
    logoBase64Url?: string
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
    
    // Step 1: Detect faces to create "no-fly zones".
    const detectedFaces = await detectFaces(imagePart);

    // Step 2: Generate text and the final image in parallel, using the face data.
    const textPrompt = generateTextPrompt(tone, dealershipName, customerName);
    const imagePrompt = generateImagePrompt(style, dealershipName, detectedFaces, !!logoImagePart);

    const textPromise = ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: {
            parts: [
                imagePart,
                { text: textPrompt }
            ]
        }
    });

    const imageParts: (typeof imagePart | { text: string })[] = [imagePart, { text: imagePrompt }];
    if (logoImagePart) {
        imageParts.push(logoImagePart);
    }

    const imagePromise = ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: imageParts,
        },
        config: {
            responseModalities: [Modality.IMAGE],
        }
    });

    const [textResponse, imageResponse] = await Promise.all([textPromise, imagePromise]);

    const rawText = textResponse.text;
    
    // Clean the generated text to remove any potential AI preamble.
    const cleanText = (inputText: string): string => {
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

    const text = cleanText(rawText);
    
    let newImageBase64 = '';
    const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
    if (imageContentPart && imageContentPart.inlineData) {
        const generatedImageMime = imageContentPart.inlineData.mimeType;
        const generatedImageData = imageContentPart.inlineData.data;
        newImageBase64 = `data:${generatedImageMime};base64,${generatedImageData}`;
    }

    if (!text || !newImageBase64) {
        throw new Error("Failed to generate social post content from AI.");
    }

    return { image: newImageBase64, text };
};