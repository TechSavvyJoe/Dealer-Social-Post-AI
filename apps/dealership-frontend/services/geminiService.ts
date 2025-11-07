import { GoogleGenAI, Type } from "@google/genai";
import { PerformanceReport } from "../types";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface CoachingAlertItem {
    severity: 'Critical' | 'Opportunity' | 'Suggestion';
    issue: string;
    suggestion: string;
}

export interface ManagerDashboardData {
    suggestions: string;
    liveSummary: string;
    overallSummary: string;
    keyTopics: string[];
    sentiment: 'Positive' | 'Neutral' | 'Negative' | 'Unknown';
    coachingAlerts: CoachingAlertItem[];
    currentSalesStep: 'Greeting' | 'Building a Profile' | 'Appraisal' | 'Selection & Demonstration' | 'Write Up & Presentation' | 'Delivery & Follow Up' | 'Unknown';
    saleSuccessProbability: number;
}

export async function getSummary(transcript: string): Promise<string> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: `You are an expert sales analyst for a car dealership. Based on the following sales conversation transcript, provide a concise summary.
First, identify the participants by name if mentioned (e.g., Salesperson: David, Customer: Sarah). **Use these names throughout your summary.**
Then, provide the summary including:
1.  Customer's key needs and preferences.
2.  Salesperson's key selling points.
3.  Customer's main objections or concerns.
4.  The final outcome or next steps.
5.  A sentiment analysis score (1-10, where 10 is very positive).
Format the output as clean markdown.

Transcript:
---
${transcript}
---
`
        });
        return response.text;
    } catch (error) {
        console.error("Error generating summary:", error);
        return "Sorry, I couldn't generate a summary for this conversation.";
    }
}

export async function getPerformanceReport(transcript: string): Promise<PerformanceReport | null> {
    if (transcript.trim().length < 150) return null;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: `You are a world-class, expert automotive sales trainer AI. Your task is to analyze a sales conversation transcript and provide a detailed, step-by-step performance report based on the "6 Steps to the Sale" methodology.

**The 6 Steps of the Sale:**
1.  **The Greeting:** Welcome the buyer, put them at ease. Use friendly, agreeable language. Avoid high-pressure questions.
2.  **Building a Profile:** Ask friendly questions about their current vehicle, needs, and wants. Discover their "hot buttons" (Price, Trade Value, Rate). NEVER ask direct financial questions like "How much can you put down?".
3.  **Appraisal:** Turn the buyer into a seller of their own trade-in vehicle. This should happen EARLY, before vehicle selection, to build excitement and ensure a write-up.
4.  **Selection & Demonstration:** Offer alternatives (Model Up/Down, Trim Level Down). Involve all the buyer's senses. Use a 5-point walk-around. End with a Trial Close.
5.  **Write Up & Presentation:** Present figures clearly. Start negotiations with your proposal, not by asking the buyer for an offer. Handle objections using the techniques provided (e.g., turn price objections into payment discussions).
6.  **Delivery & Follow Up:** Ensure a smooth paperwork process and a thorough vehicle handover. This is the last impression.

**Your Instructions:**
Analyze the entire transcript and provide a JSON object containing two main keys: "stepByStepAnalysis" and "overallCoachingSummary".

1.  **"stepByStepAnalysis":** This must be an array of 6 objects, one for each step of the sale. For each step, provide:
    *   **stepName:** The name of the step (e.g., "Greeting").
    *   **score:** An integer score from 1 to 10 evaluating the salesperson's performance *in that specific step*.
    *   **positiveFeedback:** A concise sentence highlighting what the salesperson did well in this step, based on the methodology.
    *   **areaForImprovement:** A concise, actionable sentence on what the salesperson could do better next time, directly related to the methodology.

2.  **"overallCoachingSummary":** Write a brief, insightful summary (in Markdown) of the salesperson's overall performance, identifying their single biggest strength and their most critical area for improvement across the entire sales process.

**Transcript to Analyze:**
---
${transcript}
---
`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        stepByStepAnalysis: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    stepName: { type: Type.STRING },
                                    score: { type: Type.INTEGER },
                                    positiveFeedback: { type: Type.STRING },
                                    areaForImprovement: { type: Type.STRING }
                                },
                                required: ["stepName", "score", "positiveFeedback", "areaForImprovement"]
                            }
                        },
                        overallCoachingSummary: { type: Type.STRING, description: "A Markdown-formatted summary of overall performance." }
                    },
                    required: ["stepByStepAnalysis", "overallCoachingSummary"]
                }
            }
        });
        
        const jsonText = response.text.trim();
        const data = JSON.parse(jsonText);
        return data as PerformanceReport;

    // FIX: Corrected the catch block syntax and variable usage.
    } catch (error) {
        console.error("Error generating performance report:", error, (error as any).response?.candidates?.[0]?.finishReason);
        return null;
    }
}


export async function getPrecallBriefing(customerInfo: { name: string; vehicle: string; budget: string; tradeIn: string; notes: string }): Promise<string> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are a veteran car sales manager preparing a salesperson for an upcoming appointment. Create a concise, strategic "Pre-call Briefing" in Markdown format based on the following customer information.

**Customer Information:**
- **Name:** ${customerInfo.name}
- **Vehicle of Interest:** ${customerInfo.vehicle}
- **Budget:** ${customerInfo.budget}
- **Trade-In:** ${customerInfo.tradeIn}
- **Additional Notes:** ${customerInfo.notes}

**Briefing Structure:**
1.  **Objective:** State the primary goal of the meeting.
2.  **Key Talking Points:** List 3-4 bullet points highlighting vehicle features that align with the customer's likely needs.
3.  **Strategic Questions:** Suggest 2-3 open-ended questions to uncover deeper needs and motivations.
4.  **Anticipated Objections:** Identify 1-2 potential objections (e.g., price, trade-in value) and suggest a preparatory response for each.
5.  **Rapport Building:** Offer a personalized tip for building rapport based on the provided notes.
`
        });
        return response.text;
    } catch (error) {
        console.error("Error generating pre-call briefing:", error);
        return "Could not generate a briefing at this time. Please try again.";
    }
}

export async function getManagerDashboardData(transcript: string): Promise<ManagerDashboardData | null> {
    if (transcript.trim().length < 50) { 
        return null;
    }
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are a world-class automotive sales coaching AI. You understand the "6 Steps of the Sale": 1. Greeting, 2. Building a Profile, 3. Appraisal, 4. Selection & Demonstration, 5. Write Up & Presentation, 6. Delivery & Follow Up.

Analyze the following live car sale transcript snippet. Provide a JSON object with eight keys: "suggestions", "liveSummary", "overallSummary", "keyTopics", "sentiment", "coachingAlerts", "currentSalesStep", and "saleSuccessProbability".

1.  **"saleSuccessProbability"**: Based on the conversation so far, including the salesperson's adherence to the sales process, the customer's sentiment, and any buying signals or objections, provide a "saleSuccessProbability" as an integer between 0 and 100 representing the likelihood of a sale. A high score means the sale is progressing well. A low score indicates significant roadblocks.
2.  **"currentSalesStep"**: Based on the conversation, identify which of the 6 sales steps the salesperson is currently in. If it's unclear, return "Unknown".
3.  **"suggestions"**: 2-3 concise, actionable bullet points for the sales manager, relevant to the current sales step.
4.  **"liveSummary"**: A very concise, one-sentence summary focusing ONLY on the most recent developments.
5.  **"overallSummary"**: A 3-4 sentence summary of the entire conversation up to now.
6.  **"keyTopics"**: An array of 3-5 important keywords or topics mentioned.
7.  **"sentiment"**: The overall sentiment of the latest part of the conversation. Must be one of: "Positive", "Neutral", "Negative".
8.  **"coachingAlerts"**: An array of objects for time-sensitive alerts. Focus on unhandled objections or missed opportunities based on sales best practices. If none, return an empty array. Each object must have three string keys:
    a. "severity": "Critical" for unhandled objections, "Opportunity" for missed buying signals.
    b. "issue": A concise description of the problem (e.g., "Customer mentioned budget twice, wasn't acknowledged.").
    c. "suggestion": A clear, actionable next step for the salesperson (e.g., "Pivot to a 'Model Down' selection alternative.").

Transcript:
---
${transcript}
---
`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        saleSuccessProbability: { type: Type.INTEGER, description: "An integer from 0 to 100."},
                        suggestions: { type: Type.STRING },
                        liveSummary: { type: Type.STRING },
                        overallSummary: { type: Type.STRING },
                        keyTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        },
                        sentiment: { type: Type.STRING },
                        coachingAlerts: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    severity: { type: Type.STRING },
                                    issue: { type: Type.STRING },
                                    suggestion: { type: Type.STRING }
                                },
                                required: ["severity", "issue", "suggestion"]
                            }
                        },
                        currentSalesStep: { type: Type.STRING, description: "One of the 6 sales steps or 'Unknown'."}
                    },
                    required: ["saleSuccessProbability", "suggestions", "liveSummary", "overallSummary", "keyTopics", "sentiment", "coachingAlerts", "currentSalesStep"]
                }
            }
        });
        
        const jsonText = response.text.trim();
        const data = JSON.parse(jsonText);
        return data as ManagerDashboardData;

    } catch (error) {
        console.error("Error generating manager dashboard data:", error);
        return {
            suggestions: "Could not generate suggestions at this time.",
            liveSummary: "Could not generate a live summary.",
            overallSummary: "Could not generate an overall summary.",
            keyTopics: [],
            sentiment: 'Unknown',
            coachingAlerts: [],
            currentSalesStep: 'Unknown',
            saleSuccessProbability: 0
        };
    }
}