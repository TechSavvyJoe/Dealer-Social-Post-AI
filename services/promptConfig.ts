import { StyleOption, ToneOption, VideoStyle, VideoRequestOptions } from "../types";

export const generateImagePrompt = (
    style: StyleOption,
    dealershipName: string,
    hasLogo: boolean,
    customMessage?: string,
    creativeBrief?: string
): string => {
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
*   Examples of BAD places: on the car if it's near a person, anywhere near a person's head or body.

**RULE #3: HUMAN PROXIMITY SAFEGUARD**
*   After tentatively placing ANY text, logo, banner, or decorative element, run a segmentation / detection pass to locate every person and face in the frame and build tight bounding boxes around them.
*   Enforce a minimum clear margin of 32px (and at least 12% of the shorter image dimension) between any person bounding box and the nearest edge of every text/logo/badge element. If the margin cannot be respected, relocate or redesign the element (e.g., convert it into a banner or badge) until it does.
*   Under no circumstances may text, logos, or graphics cross into these exclusion zones.`;

    const watermarkInstruction = hasLogo
        ? `*   **MANDATORY LOGO PLACEMENT:** A second image has been provided—this is the dealership's logo. It is a CRITICAL REQUIREMENT that you place this logo as a small, tasteful watermark in a lower corner of the final image, inside a Safe Zone. Do not distort it. Do NOT use the dealership name as a text watermark if the logo image is present. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `*   **WATERMARK:** The dealership name, '${dealershipName}', MUST be used as a text watermark. Use the *exact* spelling provided and place it tastefully in a lower corner within a Safe Zone.`;

    const varietyInstruction = `**CRITICAL CREATIVE MANDATE: VIRAL-WORTHY DESIGN.** Your goal is not just to make a post, but to create a visually stunning, one-of-a-kind piece of art that stops people from scrolling. For this specific generation, you MUST create a completely unique and fresh design. Do not default to a standard template. You are a creative director, so be bold! Experiment with the following elements within the chosen style guide below:
- **Font Artistry:** Choose a unique pair of complementary fonts that make a statement. Don't just place text; treat it like a design element itself.
- **Harmonious Color Palette:** Select a dynamic color palette. You MUST derive the primary colors from the car, the background scene, or the customer's clothing to create a professional, harmonious, and striking design.
- **Dynamic Layout:** Experiment with unconventional layouts. Consider angled text, text that wraps around parts of the car (without touching people), stacked words, or integrating text with the scene's lines, while ALWAYS staying in the Safe Zones.
- **High-Impact Text Effects:** Apply a unique and tasteful text effect that makes the text 'pop'. Examples include a vibrant neon glow, a realistic 3D metallic sheen, a bold graphic drop shadow, an elegant outline, or text that appears to be part of the environment itself. The goal is to make every post look like a custom, high-end design.`;

    const creativeBriefInstruction = creativeBrief
        ? `
**USER CREATIVE INPUT:**
“${creativeBrief}”
Translate this into visual storytelling decisions (color palette, typography, supporting graphics) while still obeying every rule above.
`
        : '';

    const coreInstruction = `Act as a world-class graphic designer with an infallible eye for composition. Your mission is to create a viral-worthy social media post by enhancing a photo and adding text overlays. You have been provided a primary photo of a customer and their car. You may also have been provided a second image which is a company logo.

${criticalRules}
${creativeBriefInstruction}

You must follow this process:

**Step 1: PHOTO ENHANCEMENT**
Perform a full, professional-grade photo enhancement on the original image to make it significantly brighter, more vibrant, and visually appealing.
*   **BRIGHTEN & ENHANCE:** Significantly increase the overall brightness and vibrancy. The goal is a bright, clear, and eye-catching image that pops.
*   **FLATTERING LIGHTING:** Intelligently balance lighting. Eliminate harsh shadows on people and the car, adding a soft 'fill light' effect for a professional studio look.
*   **COLOR GRADING & POLISH:** Apply a rich, appealing color grade. Add a final touch of sharpening to make details crisp and clear.

**Step 2: INTELLIGENT TEXT OVERLAY (Restricted to Safe Zones)**
After enhancing the photo, you will add text elements based on the provided instructions.
*   **ABSOLUTE SPELLING & CONTENT ACCURACY:** The text you add to the image must be spelled *perfectly* and use the *exact* wording provided in the text instructions. DO NOT add, omit, or change any words. Any spelling error is a task failure.
*   **DYNAMIC COMPOSITION:** Within the Safe Zones, create a dynamic, visually engaging composition based on your Creative Mandate. Use varied angles and creative positioning. If you cannot find a valid Safe Zone that respects the exclusion margins, create a banner or ribbon that sits fully outside of all person bounding boxes.
*   **3D & REALISM:** When appropriate for the style, render the main text as a bold, chunky, 3D object that casts realistic shadows and reflects the scene's lighting.
${watermarkInstruction}

**Step 3: HUMAN SAFETY VERIFICATION**
*   Re-run the segmentation / detection pass from **RULE #3** on the finished composition. If ANY margin is violated or an overlap is detected, reposition the offending element and repeat this step until full compliance is achieved.

**Step 4: FINAL COMPLIANCE REVIEW**
*   Confirm that all text, logos, and decorations remain inside the image boundaries, respect the required margins, and look intentional.
*   If a violation is discovered, adjust the layout and repeat Steps 2-3 before delivering the final image.`;

    let textInstruction = '';
    if (customMessage && customMessage.trim()) {
        textInstruction = `
        **Custom Text Overlay:**
        *   The user has provided a custom message that MUST be used for the text overlay.
        *   **EXACT TEXT TO USE:** "${customMessage.trim()}"
        *   **Your task:** Intelligently and creatively display this exact text on the image. You have creative freedom to split it into a main headline and a smaller sub-text for better design, or use it as a single block if that looks better. The most important words should be emphasized. Do not add any text that isn't in the provided message, except for the dealership watermark/logo if applicable. Ensure every word from the user's message is included.`;
    } else {
        textInstruction = `
        - Craft a headline (1-3 words) that celebrates the moment. Avoid defaulting to the single word "Congratulations" unless the creative brief explicitly requires it.
        - Add a supporting sub-text that warmly references '${dealershipName}' (keep it under 8 words).
        - Use hierarchy, scale, and spacing so the headline feels hero-level while the sub-text feels supportive.
        - Ensure both lines respect every exclusion zone and margin rule above.`;
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


export const generateTextPrompt = (
    tone: ToneOption,
    dealershipName: string,
    customerName?: string,
    isRegeneration = false,
    creativeBrief?: string,
): string => {
    const nameInfo = customerName
        ? `The customer's first name is ${customerName}. Personalize the post by addressing them directly.`
        : "The customer's name was not provided, so refer to them as 'our latest happy customer' or a similar friendly phrase.";

    let toneInstruction = "";
    switch (tone) {
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
        case ToneOption.Promotional:
            toneInstruction = "Write in a compelling, promotional, and urgent tone. Create a sense of excitement and encourage people to visit the dealership soon. You can hint at great deals or a limited-time opportunity without mentioning specifics.";
            break;
    }

    const regenerationInstruction = isRegeneration ? "CRITICAL: The user is asking for a new version. This caption MUST be different from any previous one you've generated. Use a fresh angle." : "";

    const creativeBriefInstruction = creativeBrief
        ? `
**Creative focus supplied by the user:**
“${creativeBrief}”
Reflect this direction in the imagery you describe, the emotion you convey, and the vocabulary you choose.
`
        : '';

    return `You are an expert social media copywriter and viral marketing strategist for a car dealership. Your task is to write a short, vibrant, and highly engaging caption for the provided photo that will stop people from scrolling.

**ABSOLUTE, NON-NEGOTIABLE REQUIREMENTS:**
1.  **DEEP IMAGE ANALYSIS:** This is your most important task. Meticulously analyze the provided photo to identify:
    *   **The Car:** Analyze the vehicle with extreme care. **Accuracy is your top priority.** If, and only if, you can identify the **exact make and model with over 99% certainty**, you may mention it (e.g., "this awesome Ford Mustang"). **If you have ANY uncertainty**, DO NOT guess the make or model. Instead, fall back to describing its certain characteristics, such as its **type** (e.g., "their new family-ready SUV", "this sleek sports car"), its **color** ("this stunning red truck"), or a general catchy phrase ("this beautiful new ride"). A correct generic description is infinitely better than an incorrect specific one.
    *   **The scene's vibe:** Is it a family, a solo adventurer, a first-time car owner? Is the background urban, suburban, sunny, etc.?
2.  **GENERATE A COMPLETE POST:** You MUST write a complete social media post (2-4 sentences), NOT just hashtags or a single sentence.
3.  **USE EMOJIS:** You MUST strategically use 2-4 relevant emojis to add personality and visual appeal.
4.  **FORMAT:** Your entire response must ONLY be the social media post text itself. Do not include preambles like "Here is your post...".

**POST STRUCTURE:**
1.  **The Hook:** Start with a high-energy, scroll-stopping opening line. Congratulate the customer. ${nameInfo} Avoid generic intros like "Congratulations"—invent something memorable.
2.  **The Story:** Briefly mention the specific car you identified (or its characteristics). Connect it to the 'vibe' of the photo. (e.g., "Ready for family adventures in their new SUV!" or "Ready to cruise in style in this sleek black sedan!").
3.  **Call to Action (CTA):** End with a friendly invitation for others to find their dream car at '${dealershipName}'.
4.  **Strategic Hashtags:** This is CRITICAL. Finish with a block of 5-7 hyper-relevant and popular hashtags. These MUST be derived from your deep image analysis.
    *   **Required:** Include #${dealershipName.replace(/\s/g, '')} and #NewCar.
    *   **Analysis-Based:** Include hashtags for the car brand (if certain), model (if certain), type, and color (e.g., #Ford, #Mustang, #SUVLife, #BlueCar).
    *   **Vibe-Based:** Add hashtags that match the scene's feeling (e.g., #HappyCustomer, #FirstCar, #FamilyAdventure, #DreamCar).

**TONE:**
- The required tone is: **${tone}**.
- ${toneInstruction}
- ${regenerationInstruction}
- ${regenerationInstruction}
${creativeBriefInstruction}

Now, write the eye-catching post.`;
}

export const funStyles = [
    { id: 'superhero', name: "Superhero Comic Book", prompt: "Redraw the entire scene in a classic American superhero comic book style. Use bold, dynamic ink lines, vibrant primary colors, and halftone dots for shading. The people should look like powerful heroes, and the car should look like their iconic vehicle." },
    { id: 'anime', name: "Japanese Anime/Manga", prompt: "Transform the photo into a vibrant, high-quality Japanese anime scene. Give the people expressive, large eyes and stylized hair. Use clean lines and crisp cel-shading. The car should look sleek and futuristic." },
    { id: 'action', name: "Action Movie Poster", prompt: "Recreate the photo as a gritty, high-octane action movie poster. Use dramatic, high-contrast lighting with deep shadows. The people should have determined, heroic expressions. The car should look tough and ready for action. Add a fiery, explosive, or smoke-filled background." },
    { id: 'pixar', name: "3D Animated Movie (Pixar-style)", prompt: "Reimagine the scene as if it's from a modern 3D animated family film. Give the people and car soft, appealing, rounded features. The lighting should be warm, friendly, and magical. The overall feeling must be charming and heartwarming." },
    { id: 'gta', name: "Grand Theft Auto Art Style", prompt: "Recreate the image in the iconic, stylized art style of a Grand Theft Auto loading screen. Use heavy, distinct black outlines, a semi-realistic but illustrated look, and a vibrant color palette. The scene should feel cool, edgy, and stylish." },
    { id: 'vintage', name: "Vintage 1930s Cartoon", prompt: "Redraw the scene in the 'rubber hose' style of a 1930s cartoon. Use black and white, simple circular shapes, pie eyes for the characters, and noodle-like limbs that bend in curves. The mood should be nostalgic and playful." },
    { id: 'claymation', name: "Claymation Stop-Motion", prompt: "Reimagine the scene as a claymation stop-motion animation. Characters and the car should have a tangible, slightly imperfect, finger-printed clay texture. The lighting should be dramatic and studio-like." },
    { id: 'lego', name: "LEGO Brick Creation", prompt: "Reconstruct the entire scene using only LEGO bricks. The people should be LEGO minifigures that resemble the real people, and the car should be a detailed LEGO model. The background should also be made of LEGOs." },
    { id: 'impressionist', name: "Impressionist Oil Painting", prompt: "Recreate the photo as an Impressionist oil painting. Use visible, expressive brushstrokes, focus on the play of light and color, and create a sense of movement and atmosphere, like a Monet or Renoir." },
    { id: 'egyptian', name: "Ancient Egyptian Hieroglyphs", prompt: "Transform the scene into an Ancient Egyptian hieroglyphic wall painting. The people should be depicted in the classic flat, side-profile style, and the car stylized as a royal chariot. Use a limited, earthy color palette on a stone or papyrus texture." },
    { id: 'stainedglass', name: "Gothic Stained Glass Window", prompt: "Recreate the image as a medieval Gothic stained glass window. Use thick, bold black lines to separate vibrant, jewel-toned sections of colored glass. The composition should be formal and reverent." },
    { id: 'graffiti', name: "Vibrant Graffiti Street Art", prompt: "Reimagine the scene as a large, vibrant graffiti mural on a brick wall. Use spray paint textures, bold bubble letters for the text, and a dynamic, edgy composition with drips and splatters." },
    { id: 'artdeco', name: "Elegant Art Deco Poster", prompt: "Redesign the photo as a sleek Art Deco travel or automobile poster from the 1920s. Use strong geometric shapes, streamlined forms, luxurious metallic accents (gold, chrome), and a sophisticated font." },
    { id: '8bit', name: "8-Bit Pixel Art", prompt: "Convert the entire scene into 8-bit pixel art, as if from a classic Nintendo game. Use a limited color palette and blocky, pixelated forms for the people, car, and background. The resolution should be visibly low." },
    { id: 'blueprint', name: "Blueprint Technical Drawing", prompt: "Redraw the scene as a technical blueprint. Use crisp white lines on a blue background. The car should be shown with callouts and measurements, and the people should be rendered as simple schematic figures." },
    { id: 'chalkboard', name: "Chalkboard Art", prompt: "Illustrate the scene as a detailed and whimsical piece of chalkboard art. Use varying chalk textures, from fine lines to smudged shading, on a dark chalkboard background. The style should be charming and handcrafted." },
    { id: 'psychedelic', name: "Psychedelic 60s Poster", prompt: "Transform the photo into a psychedelic rock poster from the late 1960s. Use swirling, distorted forms, vibrant, clashing colors, and bubble-like, hard-to-read typography that flows with the artwork." },
    { id: 'papercraft', name: "Papercraft Diorama", prompt: "Recreate the scene as a 3D papercraft diorama. All elements—people, car, background—should appear to be constructed from folded, layered, and cut colored paper, giving it a tangible, handcrafted depth." },
    { id: 'fantasy', name: "Fantasy Map (Lord of the Rings style)", prompt: "Reimagine the scene as a location on a hand-drawn fantasy map. The dealership could be a castle, the car a noble steed, and the people adventurers. Use sepia tones and elegant calligraphy." },
    { id: 'watercolor', name: "Luminous Watercolor Painting", prompt: "Recreate the photo as a soft and luminous watercolor painting. Use translucent washes of color, let colors bleed into each other, and leave some white of the paper showing through for highlights. The feel should be light and airy." },
    { id: 'cyberpunk', name: "Cyberpunk Neon Noir", prompt: "Transform the scene into a cyberpunk cityscape. The car should be futuristic and augmented, the people should have cybernetic elements, and the background should be a rainy, neon-drenched city at night." },
    { id: 'ukiyoe', name: "Ukiyo-e Japanese Woodblock Print", prompt: "Recreate the photo in the style of a traditional Japanese Ukiyo-e woodblock print. Use flat areas of color, strong outlines, and a stylized, elegant composition reminiscent of artists like Hokusai." },
    { id: 'storybook', name: "Children's Storybook Illustration", prompt: "Redraw the scene in the charming and simple style of a classic children's storybook. Use soft colors, friendly character designs with big smiles, and a gentle, whimsical atmosphere." },
    { id: 'lowpoly', name: "Low-Poly 3D Render", prompt: "Reconstruct the scene using a low-poly 3D art style. All objects and people should be represented by a mesh of visible, flat-shaded polygons. The look should be stylized and geometric." },
    { id: 'thermal', name: "Thermal Imaging Scan", prompt: "Reimagine the image as if viewed through a thermal imaging camera. Use a vibrant color gradient from blue (cold) to red/yellow (hot) to represent the heat signatures of the people, the car's engine, and the environment." },
    { id: 'silhouette', name: "Fairy Tale Silhouette", prompt: "Depict the scene as a black silhouette against a magical, colorful sunset or moonlit sky. The intricate shapes of the people and car should be clearly defined, creating a dramatic and enchanting storybook feel." },
    { id: 'steampunk', name: "Steampunk Invention", prompt: "Transform the photo into a steampunk-themed creation. The car should be a fantastic contraption of brass, copper, gears, and steam pipes. The people's clothing should be Victorian with futuristic goggles and gadgets." },
    { id: 'vaporwave', name: "Vaporwave Aesthetic", prompt: "Recreate the scene with a Vaporwave aesthetic. Use a palette of pinks, teals, and purples. Incorporate elements like Roman busts, checkerboard grids, palm trees, and a hazy, nostalgic 90s digital feel." },
    { id: 'tribal', name: "Tribal Tattoo Art", prompt: "Redraw the entire scene using the bold, black, flowing lines and patterns of Polynesian or Maori tribal tattoo art. The forms of the people and car should be abstracted into powerful, symbolic shapes." },
    { id: 'coloringbook', name: "Detailed Coloring Book Page", prompt: "Transform the photo into a detailed, black and white coloring book page for adults. Use clean, intricate lines to outline the people, the car, and add complex patterns to the background. The image should be entirely line art, with no shading." },
    { id: 'filmnoir', name: "Film Noir Scene", prompt: "Recreate the photo in a black and white Film Noir style. Use high-contrast lighting, deep dramatic shadows, and a mysterious, cinematic mood like a 1940s detective movie." },
    { id: 'popart', name: "Pop Art (Warhol Style)", prompt: "Transform the image into an Andy Warhol-style Pop Art piece. Use bright, saturated, unnatural colors in bold blocks with a screen-printed texture. The image could be repeated in a grid with different color schemes." },
    { id: 'pointillism', name: "Pointillism Painting", prompt: "Recreate the photo in the style of Pointillism, constructed from thousands of tiny, distinct dots of color that blend together in the viewer's eye." },
    { id: 'surrealist', name: "Surrealist Painting (Dali Style)", prompt: "Reimagine the scene as a dreamlike Surrealist painting. Feature melting objects, illogical juxtapositions, and a bizarre, subconscious landscape." },
    { id: 'cubist', name: "Cubist Painting (Picasso Style)", prompt: "Deconstruct and reassemble the subjects in a Cubist style, showing them from multiple viewpoints simultaneously using geometric shapes and fragmented forms." },
    { id: 'romanmosaic', name: "Ancient Roman Mosaic", prompt: "Recreate the image as a detailed Roman mosaic, as if constructed from thousands of small, colored stone tiles (tesserae)." },
    { id: 'mayancodex', name: "Mayan Codex Glyphs", prompt: "Illustrate the scene in the style of an ancient Mayan codex, with stylized figures, intricate glyphs, and a limited color palette on a fig-bark paper texture." },
    { id: 'artnouveau', name: "Art Nouveau Poster", prompt: "Redesign the photo as an elegant Art Nouveau poster. Use flowing, organic lines, decorative floral patterns, and a graceful, stylized aesthetic reminiscent of Alphonse Mucha." },
    { id: 'victorianetching', name: "Victorian Etching", prompt: "Render the scene as a fine, detailed black-and-white Victorian etching, with intricate cross-hatching for shading, like an illustration from an old book." },
    { id: '80strapper', name: "1980s Trapper Keeper Art", prompt: "Transform the scene into 80s Trapper Keeper art. Use airbrushed neon colors, laser grids, chrome text, and a futuristic, radical aesthetic." },
    { id: 'tiedye', name: "Tie-Dye Fabric Pattern", prompt: "Reimagine the entire image as a vibrant, swirling tie-dye pattern. The forms of the people and car should be visible within the psychedelic colors." },
    { id: 'scifi', name: "Golden Age Sci-Fi Book Cover", prompt: "Recreate the photo as a 1950s pulp sci-fi book cover. The car is a retro rocket ship, the people are space adventurers, and the background is a colorful alien planet." },
    { id: 'knitted', name: "Knitted Wool Sweater Pattern", prompt: "Render the image as if it were a cozy, knitted pattern on a wool sweater, complete with a visible yarn texture." },
    { id: 'crossstitch', name: "Cross-Stitch Embroidery", prompt: "Transform the scene into a charming cross-stitch embroidery piece, with visible 'X' stitches and a fabric canvas texture." },
    { id: 'sandsculpture', name: "Sand Sculpture", prompt: "Reimagine the scene as a massive, incredibly detailed sand sculpture on a sunny beach." },
    { id: 'icesculpture', name: "Ice Sculpture", prompt: "Recreate the scene as a dramatic, crystal-clear ice sculpture, complete with internal refractions and cool-toned lighting." },
    { id: 'topiary', name: "Topiary Garden Sculpture", prompt: "Depict the scene as if it were meticulously crafted from living topiary bushes in a formal garden." },
    { id: 'woodcarving', name: "Carved Wooden Sculpture", prompt: "Illustrate the entire scene as if it were carved from a single piece of polished wood, emphasizing the natural grain and texture." },
    { id: 'risograph', name: "Risograph Print", prompt: "Recreate the image with the aesthetic of a Risograph print. Use a limited palette of bright, overlapping, slightly misaligned colors with a characteristic grainy texture." },
    { id: 'cavepainting', name: "Cave Painting", prompt: "Redraw the scene in the style of ancient cave paintings. Use simple, primitive figures, earthy pigments (red ochre, charcoal), and a rough stone wall texture." },
    { id: 'botanical', name: "Botanical Illustration", prompt: "Render the image in the style of an antique botanical illustration, with precise lines, delicate watercolor washes, and scientific labels pointing to parts of the car." },
    { id: 'minimalist', name: "Minimalist Line Art", prompt: "Capture the entire scene using only a single, continuous, elegant black line on a white background." },
    { id: 'heavymetal', name: "Heavy Metal Album Cover", prompt: "Transform the photo into an epic, dark fantasy heavy metal album cover. The car should be monstrous, the people heroic warriors, and the sky filled with lightning." },
    { id: 'abstractexpress', name: "Abstract Expressionism", prompt: "Reinterpret the scene in the style of Abstract Expressionism, focusing on emotion and energy through drips, splatters, and bold, non-representational brushstrokes." },
    { id: 'spygadget', name: "Spy Movie Gadget Blueprint", prompt: "Redraw the car as a secret agent's gadget-filled vehicle blueprint, revealing hidden weapons, oil slicks, and an ejector seat." },
    { id: 'banknote', name: "Banknote Engraving", prompt: "Recreate the image in the intricate, fine-line engraving style found on currency, complete with guilloché patterns and a portrait-like quality." },
    { id: 'casino', name: "Casino Slot Machine Theme", prompt: "Reimagine the scene as the bright, flashy, chrome-and-neon art of a casino slot machine, incorporating lucky 7s and jackpot symbols." },
    { id: 'archmodel', name: "Architectural Model", prompt: "Reconstruct the scene as a miniature architectural model made of white cardboard, balsa wood, and tiny plastic figures." },
    { id: 'timburton', name: "Tim Burton Style", prompt: "Redraw the scene in the gothic, quirky, and whimsical style of Tim Burton, with spindly characters, large expressive eyes, and a dark, fantastical atmosphere." },
    { id: 'etchasketch', name: "Etch A Sketch Drawing", prompt: "Render the entire image as if it were drawn on an Etch A Sketch, using a single, continuous gray line with no breaks." },
    { id: 'sugarskull', name: "Sugar Skull Art", prompt: "Transform the people and car with the intricate, colorful patterns of Dia de los Muertos (Day of the Dead) sugar skulls." },
    { id: 'hologram', name: "Holographic Projection", prompt: "Depict the scene as a shimmering, semi-transparent, blue-green holographic projection with visible scan lines." },
    { id: 'circuitboard', name: "Circuit Board", prompt: "Illustrate the scene as if it were a design on a computer circuit board, with people and the car made of traces, capacitors, and resistors." },
    { id: 'constellation', name: "Constellation Star Map", prompt: "Reimagine the scene as a celestial constellation map, where the main outlines are formed by shining stars connected by faint lines against a dark night sky." },
    { id: 'nauticalchart', name: "Old World Nautical Chart", prompt: "Draw the scene on aged parchment in the style of an old nautical chart, complete with a compass rose, sea monsters, and rhumb lines." },
    { id: 'constructivist', name: "Russian Constructivist Poster", prompt: "Recreate the image as a bold Russian Constructivist propaganda poster, using strong diagonal lines, geometric shapes, and a limited color palette of red, black, and beige." },
    { id: 'dinermenu', name: "1950s Diner Menu Illustration", prompt: "Redraw the scene in the cheerful, retro cartoon style of a 1950s American diner menu, with bright, happy colors and a friendly vibe." },
    { id: 'trainset', name: "Miniature Train Set Scenery", prompt: "Recreate the entire scene as a tiny, detailed landscape from a model railroad set, with a focus on miniature realism." },
    { id: 'foodart', name: "Food Art", prompt: "Construct the scene entirely out of different food items, like a landscape made of vegetables, a car from bread, and people from fruit." },
    { id: 'baroquefresco', name: "Baroque Ceiling Fresco", prompt: "Reimagine the scene as a dramatic Baroque ceiling fresco, with heroic figures, swirling clouds, and a sense of divine, upward motion." },
    { id: 'simpsons', name: "The Simpsons Cartoon Style", prompt: "Redraw the people and car as if they were characters appearing in an episode of The Simpsons, complete with the show's signature art style." },
    { id: 'southpark', name: "South Park Paper Cutout Style", prompt: "Recreate the scene using the simple, construction-paper-cutout animation style of South Park." },
    { id: 'xray', name: "X-Ray Scan", prompt: "Transform the image into a monochrome X-ray scan, showing the skeletons of the people and the internal mechanics of the car." },
    { id: 'solarized', name: "Solarized Photograph", prompt: "Apply a solarization effect to the photo, reversing some of the tones for a surreal, high-contrast, and metallic appearance." },
    { id: 'tintype', name: "Tintype Photograph", prompt: "Give the image the look of an antique tintype photograph from the 19th century, with a metallic sheen, imperfections, and a desaturated, sepia tone." },
    { id: 'vanair brush', name: "1970s Airbrush Van Art", prompt: "Recreate the scene as a fantasy mural airbrushed on the side of a 1970s van, featuring wizards, majestic landscapes, or cosmic themes." },
    { id: 'newspaper', name: "Newspaper Dot Matrix Print", prompt: "Render the image as a black-and-white photo from an old newspaper, composed of visible, coarse dots (halftone)." },
    { id: 'bauhaus', name: "Bauhaus Poster Design", prompt: "Redesign the image as a clean, functional Bauhaus poster, emphasizing geometric shapes, primary colors, and sans-serif typography." },
    { id: 'shadowpuppet', name: "Shadow Puppet Theater", prompt: "Depict the scene as a performance of shadow puppets, showing only the black silhouettes of the subjects against a brightly lit screen." },
    { id: 'blacklight', name: "Fuzzy Blacklight Poster", prompt: "Transform the image into a psychedelic blacklight poster on black velvet, with vibrant, glowing fluorescent colors." },
    { id: 'rubberstamp', name: "Rubber Stamp Art", prompt: "Reconstruct the image as if it were created by layering impressions from different rubber stamps, giving it a handcrafted, slightly imperfect texture." },
    { id: 'anaglyph', name: "Anaglyph 3D", prompt: "Recreate the image with a retro anaglyph 3D effect, offsetting red and cyan color channels to be viewed with 3D glasses." },
    { id: 'jackolantern', name: "Carved Jack-o'-Lantern", prompt: "Illustrate the scene as if it were intricately carved into the surface of a glowing jack-o'-lantern for Halloween." },
    { id: 'tshirt', name: "Rock Band Tour T-Shirt", prompt: "Design the image in the distressed, graphic style of a vintage concert t-shirt for a fictional rock band." },
    { id: 'infographic', name: "Infographic", prompt: "Break down the scene into a clean, modern infographic, using charts, callouts, and clean vector illustrations to represent the elements." },
    { id: 'stickerbomb', name: "Sticker Bomb", prompt: "Recreate the image as a collage made from hundreds of overlapping, brightly colored, and custom-shaped stickers." },
    { id: 'dutchmaster', name: "Dutch Master Oil Painting", prompt: "Reimagine the scene as a dramatic Dutch Master oil painting, with deep shadows, rich colors, and a single, focused light source (chiaroscuro)." },
    { id: 'tattooflash', name: "Tattoo Flash Sheet", prompt: "Redraw the scene in the classic American traditional tattoo style, with bold black outlines, a limited color palette (red, green, yellow), and iconic motifs." },
    { id: 'rorschach', name: "Rorschach Inkblot", prompt: "Transform the scene into a symmetrical, abstract Rorschach inkblot that vaguely resembles the original subjects." },
    { id: 'celticknotwork', name: "Celtic Knotwork", prompt: "Weave the outlines of the car and people into an intricate, seamless pattern of Celtic knotwork." },
    { id: 'microscope', name: "Scientific Microscope View", prompt: "Reimagine the scene as if viewed through a microscope, with all elements appearing as cells, amoebas, or other microorganisms." },
    { id: 'persianrug', name: "Antique Persian Rug", prompt: "Illustrate the scene as if it were the central medallion woven into the intricate patterns and borders of a traditional Persian rug." },
    { id: 'illuminated', name: "Illuminated Manuscript", prompt: "Recreate the scene as a medieval illuminated manuscript page, with ornate, decorative borders, gold leaf details, and elegant calligraphy." },
];

export const generateFunPrompt = (
    dealershipName: string,
    logoBase64Url?: string,
    requestedStyle?: string
): string => {
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
*   Examples of BAD places: on the car if it's near a person, anywhere near a person's head or body.

**RULE #3: HUMAN PROXIMITY SAFEGUARD**
*   After tentatively placing ANY new graphic, badge, or text, run a segmentation / detection pass to locate every person in the frame.
*   Maintain a buffer of at least 32px (and 12% of the shorter image dimension) between every person bounding box and the nearest edge of any added element. Relocate or redesign the element if the margin is violated.
*   Do not output the final image until ALL elements satisfy these margins.`;

    const watermarkInstruction = logoBase64Url
        ? `A dealership logo has been provided as a second image. It is a MANDATORY REQUIREMENT to place this logo as a small, tasteful watermark in a lower corner of the final image. It must be styled to match the overall artistic theme but remain clearly legible and unobtrusive. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `The dealership name is '${dealershipName}'. You MUST use this EXACT name as a small, tasteful text watermark in a lower corner. Style it to match the aesthetic but keep it discreet. Double-check your spelling of '${dealershipName}'.`;

    // Select style based on request
    let selectedStyle;
    if (requestedStyle && requestedStyle !== 'random') {
        // Find style by ID
        selectedStyle = funStyles.find(s => s.id === requestedStyle) || funStyles[Math.floor(Math.random() * funStyles.length)];
    } else {
        // Random selection
        selectedStyle = funStyles[Math.floor(Math.random() * funStyles.length)];
    }

    return `You are a master illustrator. Your task is to create a completely new piece of digital art from scratch. You have been given a reference photo, but you must NOT edit it.

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
4.  **SAFETY CHECK:** After placing the text/branding, re-run the human proximity safeguard from **RULE #3**. If any element violates the required margin, relocate it and repeat this verification.

**FINAL COMPLIANCE REVIEW**
*   Confirm zero overlap with people, perfect spelling, and clean boundaries. If any violation is detected, adjust the layout and repeat the safety check before returning the final image.

The final output must be a single, high-resolution, fully-composed image in the assigned artistic style, complete with integrated text.`;
};

export const editImagePrompt = (
    editPrompt: string,
    dealershipName: string,
    logoBase64Url?: string
): string => {
    const criticalRulesForEditing = `
**CRITICAL, NON-NEGOTIABLE CORE DIRECTIVES FOR EDITING: READ AND OBEY THESE RULES ABOVE ALL ELSE. FAILURE TO FOLLOW THEM PERFECTLY IS A TOTAL TASK FAILURE.**

**RULE #1: ABSOLUTE HUMAN SAFETY - NO TEXT/GRAPHIC OVERLAP (HIGHEST PRIORITY)**
*   Your highest priority is to follow the user's edit request *without* placing any new text or elements over any part of the people in the photo.
*   **IDENTIFY AND MASK:** Before doing anything else, you MUST identify every pixel that is part of a person (head, hair, face, body, clothing, limbs, hands, feet). Create a large, invisible "exclusion zone" around them.
*   **ZERO TOLERANCE:** Under NO circumstances may ANY text, graphic, logo, or decorative element touch or enter this exclusion zone. This is a non-negotiable, zero-tolerance rule. Any violation is a task failure.

**RULE #2: ABSOLUTE BOUNDARY ADHERENCE**
*   All text and graphic elements you add or modify MUST be 100% contained within the visible boundaries of the image. Nothing can be cropped or cut off by the edge.

**SAFE ZONES FOR TEXT PLACEMENT:**
*   The ONLY valid places for text and logos are "Safe Zones"—large, open areas far away from people and edges (e.g., empty sky, open ground, blank walls).

**RULE #3: HUMAN PROXIMITY SAFEGUARD**
*   After every edit, run a segmentation / detection pass to map every person and face.
*   Maintain a buffer of at least 32px (and 12% of the shorter image dimension) between those bounding boxes and any text/logo/graphic element.
*   If a margin is violated, relocate the element and re-run this safeguard before delivering the final image.`;

    const watermarkInstruction = logoBase64Url
        ? `A dealership logo has been provided as a second image. It is a CRITICAL REQUIREMENT to ensure this logo is present and tastefully placed in a corner of the final edited image. Do not distort it. If the logo was missing from the original image, you MUST add it now. **FAILURE TO INCLUDE THE PROVIDED LOGO IMAGE IS A TASK FAILURE.**`
        : `The dealership name is '${dealershipName}'. If a text watermark with this name was on the original image, ensure it remains or is tastefully reapplied.`;

    return `Act as a world-class photo editor and graphic designer. You have been provided an image that was previously generated for a social media post. The user wants you to make specific edits.

${criticalRulesForEditing}

    **USER'S EDIT REQUEST:** "${editPrompt}"

    **YOUR TASK:**
    1.  Carefully analyze the user's request.
    2.  Apply the requested changes to the provided image, strictly following the Core Directives above.
    3.  **MAINTAIN QUALITY:** Ensure the final image is high-resolution and looks professional.
    4.  **WATERMARK/LOGO:** ${watermarkInstruction}
    5.  **PERFECT WORDING:** If the user asks to change or add text, you MUST use the exact spelling and wording they provide. Do not add, omit, or change any words from their request.
    6.  **SAFETY CHECK:** Re-run the proximity safeguard from **RULE #3**. If any text/logo/banner violates the required margin, adjust the layout and repeat this check before returning the image.

    The final output must be only the edited image.`;
};

export const editTextPrompt = (
    originalText: string,
    editPrompt: string,
    tone: ToneOption
): string => {
    return `You are an expert social media copy editor. A user has provided text for a post and an edit request.
    
    **Original Text:**
    "${originalText}"

    **User's Edit Request:**
    "${editPrompt}"

    **Tone to maintain:**
    ${tone}

    **Your task:**
    Rewrite the original text to incorporate the user's request while maintaining the specified tone. The output MUST be only the new, edited text, ready to be copied and pasted. Do not include any preamble.`;
};

export const generateVideoPrompt = (style: VideoStyle, options: VideoRequestOptions): string => {
    const coreInstruction = `You are an AI motion graphics artist. You are given a static image of a person or people celebrating their new car. Your task is to transform this image into a short, dynamic video clip that runs for approximately ${options.durationSeconds} seconds. Do not change the subjects in the image; only add animation and effects based on the chosen theme. Keep the framing clean and avoid cutting off the car or people.`;

    const soundtrackInstruction = options.soundtrack === 'none'
        ? 'No background audio is required; focus on crisp visuals that can loop cleanly without sound.'
        : options.soundtrack === 'celebration'
            ? 'Incorporate rhythmic motion that matches an upbeat, celebratory clap-driven track.'
            : options.soundtrack === 'cinematic'
                ? 'Design the animation with smooth, cinematic pacing that swells in sync with an ambient score.'
                : options.soundtrack === 'anthemic'
                    ? 'Sync motion to an anthemedic stadium beat with big hits and lifts; make it feel heroic.'
                    : 'Lean into groove-forward motion that matches a funky, bass-led track.';

    const pacingInstruction = options.pacing === 'snappy'
        ? 'Use quick cuts, energetic reveals, and punchy easing. Keep moves brisk and impactful.'
        : 'Use smooth easing, longer ramps, and graceful transitions for a polished cinematic feel.';

    const resolutionInstruction = options.resolution === '1080p'
        ? 'Render details sharply as if delivering a 1080p export.'
        : 'Favor lightweight motion that still looks clean at 720p.';

    const aspectInstruction = options.aspectPreference === 'auto'
        ? 'Match the source photo orientation; do not crop out the main subject.'
        : `Compose for a ${options.aspectPreference} frame and keep the car and people centered. If the source photo does not match, use subtle letterboxing or pillarboxing instead of cropping faces or the vehicle.`;

    let styleInstruction = "";
    switch (style) {
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
        case VideoStyle.HappyDance:
            styleInstruction = "Theme: 'Happy Dance'. Your primary task is to isolate the main customer in the photo. Animate them doing a simple, joyful dance in place. This should be a subtle shoulder groove and a gentle sway, capturing a moment of pure happiness. The car and the background should remain completely static to focus all attention on the customer's celebration.";
            break;
        case VideoStyle.JumpingForJoy:
            styleInstruction = "Theme: 'Jumping for Joy'. Isolate the primary customer in the photo. Animate them performing a single, energetic 'jump for joy'. They should leap up slightly, arms raised in excitement, and land back in their original position. To add impact, create a very slight camera shake effect the moment they land. The car and background must remain static.";
            break;
        case VideoStyle.SpeedLines:
            styleInstruction = "Theme: 'Speed Lines'. Keep the car and customer perfectly still, but create a powerful illusion of speed. Animate stylized, dynamic speed lines and motion blur effects that rush past the car, moving from the front towards the back. The effect should feel energetic and suggest high speed and performance.";
            break;
        case VideoStyle.CarSketch:
            styleInstruction = "Theme: 'Car Sketch'. Create an artistic reveal. Animate the scene as if it is being drawn by a charcoal pencil on textured paper. Start with rough outlines that quickly sketch themselves in, then have the color and detail fill in, transitioning smoothly into the final, full-color photo by the end of the clip.";
            break;
        case VideoStyle.GoldenRadiance:
            styleInstruction = "Theme: 'Golden Radiance'. Create a luxurious and premium effect. Animate a brilliant, warm golden light that sweeps across the car from one side to the other. This light should create intense, shimmering highlights on the car's body and windows, accompanied by elegant, subtle lens flares. The mood should be classy and awe-inspiring.";
            break;
        case VideoStyle.GlitchPop:
            styleInstruction = "Theme: 'Glitch Pop'. Create a modern, energetic, and digital animation. Use quick, stylish 'glitch' effects, momentary flashes of colorful digital static, and slight RGB channel separation that quickly resolves. This should feel like a cool, trendy video effect, not a technical error.";
            break;
        case VideoStyle.SmokeReveal:
            styleInstruction = "Theme: 'Smoke Reveal'. Create a dramatic and cool reveal. The video starts with a screen filled with thick, billowing colored smoke (e.g., blue or red). The smoke should then gracefully swirl and dissipate over the 4 seconds to dramatically unveil the car and happy customers behind it.";
            break;
        case VideoStyle.Spotlight:
            styleInstruction = "Theme: 'Spotlight'. Create a theatrical, 'big reveal' effect. The video begins with a mostly dark screen. A bright, clean spotlight then sweeps into the frame, scans around for a moment, and then comes to rest, perfectly illuminating the car and customers, making them the star of the show.";
            break;
        case VideoStyle.FireEmbers:
            styleInstruction = "Theme: 'Fire & Embers'. Create a powerful and epic mood. Animate glowing, fiery embers and soft-focus particles of fire that gently rise from the bottom of the screen. These particles should drift upwards in front of the subjects, adding a sense of intensity and prestige. The effect should be beautiful, not dangerous.";
            break;
        case VideoStyle.LiquidChrome:
            styleInstruction = "Theme: 'Liquid Chrome'. Create a sleek, futuristic reveal. Animate liquid metal or chrome that flows and swirls across the screen, gradually conforming to the shape of the car and solidifying to reveal the final, polished image. The effect should be smooth, reflective, and high-end.";
            break;
        case VideoStyle.StickerSlap:
            styleInstruction = "Theme: 'Sticker Slap'. Create a fun, energetic, and scrapbook-style animation. Have 2-3 colorful, cartoonish stickers (like stars, thumbs-ups, or 'SOLD!') animate and 'slap' onto the screen in the open spaces around the car and people. The image itself should have a slight jiggle effect when a sticker hits.";
            break;
        case VideoStyle.GraffitiReveal:
            styleInstruction = "Theme: 'Graffiti Reveal'. Start the video with a stylized brick wall filling the screen. Animate a burst of colorful spray paint that creates a graffiti-style outline of the car, which then transitions into the full, real photo, as if the graffiti art has come to life. The mood is urban, cool, and artistic.";
            break;
        case VideoStyle.HolographicScan:
            styleInstruction = "Theme: 'Holographic Scan'. Make the image appear as a flickering, blue-tinted hologram. Animate horizontal scan lines that move up and down the image. The hologram should briefly glitch and then resolve into the stable, full-color photo by the end of the clip. The feel is modern and tech-focused.";
            break;
        case VideoStyle.RoadTrip:
            styleInstruction = "Theme: 'Road Trip'. Create a sense of adventure. Animate a stylized, dashed line that draws itself on screen, representing a map route. The line should loop around the happy customers and car. Overlay subtle, semi-transparent animated scenery (like mountains or trees) passing by on the sides of the frame.";
            break;
        case VideoStyle.Blueprint:
            styleInstruction = "Theme: 'Blueprint'. Begin with a blue background. Animate white blueprint lines that quickly draw the technical schematic of the car on screen. Once the drawing is complete, have it seamlessly fade and transition into the final, full-color photograph of the car and customers.";
            break;
    }
    return `${coreInstruction}

${soundtrackInstruction}

${pacingInstruction}

${resolutionInstruction}

${aspectInstruction}

${styleInstruction}`;
}
