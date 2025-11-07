import { GoogleGenAI, Type } from "@google/genai";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface DialogueTurn {
    speaker: string;
    text: string;
}

export type SpeakerMap = Map<string, string>;

interface DiarizationResult {
    updatedTurns: DialogueTurn[];
    updatedSpeakers: SpeakerMap;
}

const model = 'gemini-2.5-pro';

export async function processTranscriptForDiarization(
    fullTranscript: string,
    knownSpeakers: SpeakerMap
): Promise<DiarizationResult> {
    if (fullTranscript.trim().length < 10) {
        return { updatedTurns: [], updatedSpeakers: knownSpeakers };
    }

    // Create a string representation of known speakers to pass to the model
    const knownSpeakersPrompt = Array.from(knownSpeakers.entries())
        .map(([placeholder, name]) => `- ${placeholder}: ${name}`)
        .join('\n');

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: `You are an expert in conversation analysis, specializing in car sales dialogues. Your task is to process a raw transcript and accurately diarize it, identifying the "Salesperson" and the "Customer".

**Speaker Roles & Characteristics:**
*   **Salesperson:** Typically leads the conversation, asks qualifying questions (e.g., "What are you looking for in a car?", "What's your budget?"), presents vehicle features, discusses pricing and financing, and handles objections. Their language is often professional and persuasive.
*   **Customer:** Expresses their needs, preferences, and budget. Asks questions about the car, price, and trade-in value. May raise concerns or objections. Their language is typically more personal and inquisitive.

**Your Instructions:**
1.  **Analyze the entire transcript** to understand the context and flow of the conversation.
2.  **Assign each line of dialogue** to either "Salesperson" or "Customer" based on the content and role characteristics described above.
3.  **Identify Names:** If a name is mentioned (e.g., "Hi, I'm John," or "Thanks, Sarah"), you MUST associate that name with the correct speaker role.
4.  **CRITICAL RULE - Retroactive Name Application:** This is the most important rule. If you identify a name for a speaker (e.g., the customer says "my name is Sarah"), you MUST apply that name to EVERY SINGLE turn from that speaker, both past and present. For example, if turns 1, 3, and 8 are from the customer, and you identify her name in turn 5, your final output MUST label turns 1, 3, and 8 as "Customer (Sarah)". Do not revert to the generic "Customer" label for a speaker once their name is known.
5.  **Maintain Consistency:** Always use the identified name for a speaker throughout the entire transcript.

**Known Speaker Names (if any):**
${knownSpeakersPrompt || "None yet."}

**Full Transcript to Process:**
---
${fullTranscript}
---

**Output Format:**
Produce a JSON array of objects. Each object must have a "speaker" (e.g., "Salesperson", "Customer (John)") and a "text" key.
`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            speaker: { type: Type.STRING },
                            text: { type: Type.STRING }
                        },
                        required: ["speaker", "text"]
                    }
                }
            }
        });

        const jsonText = response.text.trim();
        const data = JSON.parse(jsonText) as DialogueTurn[];

        // Update the known speakers map from the results
        const newSpeakers = new Map(knownSpeakers);
        data.forEach(turn => {
            const nameMatch = turn.speaker.match(/\(([^)]+)\)/);
            if (nameMatch) {
                const name = nameMatch[1];
                if (turn.speaker.toLowerCase().includes('cust')) {
                    newSpeakers.set('Customer', name);
                } else if (turn.speaker.toLowerCase().includes('sales')) {
                    newSpeakers.set('Salesperson', name);
                }
            }
        });
        
        return { updatedTurns: data, updatedSpeakers: newSpeakers };

    } catch (error) {
        console.error("Error processing transcript for diarization:", error);
        return { 
            updatedTurns: [{ speaker: 'System', text: "Error analyzing transcript." }], 
            updatedSpeakers: knownSpeakers 
        };
    }
}