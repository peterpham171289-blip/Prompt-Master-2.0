// File: functions/api/[[proxy]].ts

import { GoogleGenAI, GenerateContentResponse, Part, Type } from '@google/genai';

// Define the environment variables expected by the function
interface Env {
  API_KEY: string;
}

// Define the structure of the request body from the client
interface ProxyRequestBody {
    type: 'generate' | 'analyze' | 'generate-image' | 'generate-video';
    payload: any;
}

// Helper to create a JSON response
const jsonResponse = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
};

// Helper function to convert ArrayBuffer to Base64 string in a non-browser environment
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// FIX: Add a minimal type definition for Cloudflare Pages functions to resolve the 'PagesFunction' not found error.
type PagesFunction<Env = unknown> = (context: { request: Request; env: Env; }) => Promise<Response>;

// Main serverless function handler
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request, env } = context;
    const apiKey = env.API_KEY;

    if (!apiKey) {
        return jsonResponse({ error: 'API_KEY is not configured on the server.' }, 500);
    }

    try {
        const body: ProxyRequestBody = await request.json();
        const ai = new GoogleGenAI({ apiKey });

        switch (body.type) {
            case 'generate':
                // Forward the request to the actual Gemini service logic
                return await handleGenerate(ai, body.payload, apiKey);
            case 'analyze':
                 return await handleAnalyze(ai, body.payload);
            default:
                return jsonResponse({ error: 'Invalid request type' }, 400);
        }
    } catch (error) {
        console.error('Error in proxy function:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        return jsonResponse({ error: errorMessage }, 500);
    }
};


// --- Handler Functions for different API calls ---

async function handleGenerate(ai: GoogleGenAI, data: any, apiKey: string) {
    const {
        context, objective, role, expectations,
        systemInstruction, promptBody, mediaInstruction,
        aiPlatform, outputType, file, previewLanguage,
        masterPromptLanguages, temperature, topP, aspectRatio
    } = data;

    const languagesString = masterPromptLanguages.join(', ');
    const metaPrompt = `
      You are a world-class prompt engineering expert AI. Your task is to create a "Master Prompt" based on the user's structured input using the C.O.R.E framework.
      The goal is to synthesize the provided components into a powerful, clear, and effective prompt tailored for the specified AI platform and desired output format.

      **User's Input Components (C.O.R.E Framework):**
      1.  **Context (Bối cảnh):** ${context}
      2.  **Objective (Mục tiêu):** ${objective}
      3.  **Role (Vai trò AI cần đảm nhận):** ${role}
      4.  **Expectations (Kỳ vọng về kết quả):** ${expectations}

      **Additional Instructions:**
      *   **System Instruction (Overall AI Persona):** ${systemInstruction}
      *   **Main Prompt Body (The Core Task):** ${promptBody}
      *   **Media Instructions (If any):** ${mediaInstruction || 'Không có'}
      *   **Target AI Platform:** ${aiPlatform}
      *   **Output Format:** ${outputType}

      **Your Instructions:**
      1.  Analyze all components to understand the user's ultimate goal. Use the **Objective** to understand the *purpose* and the **Output Format** to determine the structure and style of the final product.
      2.  Combine and refine the components into a single, cohesive "Master Prompt".
      3.  The Master Prompt should start with the Role, then integrate Context, Objective, and Expectations clearly.
      4.  Ensure the prompt uses advanced techniques to guide the AI model effectively.
      5.  Provide the final Master Prompt in the following languages: ${languagesString}.
      6.  Your response MUST be a valid JSON object. Do not include any text, comments, or markdown formatting (like \`\`\`json) before or after the JSON object.
    `;
    const schema = {
      type: Type.OBJECT,
      properties: {
        prompts: {
          type: Type.ARRAY,
          description: "An array of master prompts, one for each requested language.",
          items: {
            type: Type.OBJECT,
            properties: {
              language: { type: Type.STRING },
              prompt: { type: Type.STRING }
            },
            required: ['language', 'prompt']
          }
        }
      },
      required: ['prompts']
    };

    const promptGenerationResult = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: metaPrompt,
        config: { responseMimeType: 'application/json', responseSchema: schema },
    });

    const result = JSON.parse(promptGenerationResult.text.trim());
    const masterPrompts: { language: string; prompt: string }[] = result.prompts;
    if (!masterPrompts || masterPrompts.length === 0) {
        throw new Error("AI did not return any prompts.");
    }
    
    let preview: any = { type: null, content: '' };
    let basePromptForPreview = masterPrompts.find(p => p.language.toLowerCase() === 'english')?.prompt || masterPrompts[0].prompt;
    
    const previewPromptParts: Part[] = [{ text: basePromptForPreview }];
    if (file) {
        const [header, base64Data] = file.data.split(',');
        if (base64Data) {
            previewPromptParts.unshift({ inlineData: { mimeType: file.mimeType, data: base64Data } });
        }
    }

    const IMAGE_OUTPUT_TYPES = ['Image', 'Ảnh', 'Hình ảnh'];
    const VIDEO_OUTPUT_TYPES = ['Video', 'Phim ngắn'];

    if (IMAGE_OUTPUT_TYPES.includes(outputType)) {
        const imageResponse = await ai.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: basePromptForPreview,
            config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: aspectRatio },
        });
        const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
        preview = { type: 'image', content: `data:image/png;base64,${base64ImageBytes}` };
    } else if (VIDEO_OUTPUT_TYPES.includes(outputType)) {
        let videoGenParams: any = { model: 'veo-2.0-generate-001', prompt: basePromptForPreview, config: { numberOfVideos: 1 } };
        if (file && file.mimeType.startsWith('image/')) {
            const [_, base64Data] = file.data.split(',');
            videoGenParams.image = { imageBytes: base64Data, mimeType: file.mimeType };
        }
        let operation = await ai.models.generateVideos(videoGenParams);
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Poll less aggressively
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (downloadLink) {
            // NOTE: The client will need to fetch this securely if the URL is protected.
            // For simplicity, we pass the signed URL back.
             const videoResponse = await fetch(`${downloadLink}&key=${apiKey}`);
              // FIX: Replace browser-only FileReader with a server-compatible method to convert blob to data URL.
              const videoBlob = await videoResponse.blob();
              const videoArrayBuffer = await videoBlob.arrayBuffer();
              const videoBase64 = arrayBufferToBase64(videoArrayBuffer);
              const videoDataUrl = `data:${videoBlob.type};base64,${videoBase64}`;
              preview = { type: 'video', content: videoDataUrl };
        } else { throw new Error('Could not generate video.'); }
    } else {
        const finalPromptForTextPreview = [...previewPromptParts];
        const lastPartIndex = finalPromptForTextPreview.length - 1;
        if (lastPartIndex >= 0 && 'text' in finalPromptForTextPreview[lastPartIndex]) {
            (finalPromptForTextPreview[lastPartIndex] as {text: string}).text += `\n\n--- IMPORTANT: Please provide your entire response in ${previewLanguage}. ---`;
        }
        const textPreviewResponse: GenerateContentResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: finalPromptForTextPreview },
          config: { temperature, topP }
        });
        preview = { type: 'text', content: textPreviewResponse.text };
    }

    return jsonResponse({ masterPrompts, preview });
}

async function handleAnalyze(ai: GoogleGenAI, data: any) {
    const { promptToAnalyze } = data;
    const metaPrompt = `
      You are a world-class prompt engineering expert AI. Your task is to analyze and evaluate the quality of a given prompt based on the C.O.R.E framework (Context, Objective, Role, Expectations).

      **User's Prompt to Analyze:**
      """
      ${promptToAnalyze}
      """

      **Your Instructions:**
      1.  **Deconstruct the Prompt:** Break down the provided prompt and identify elements that correspond to Context, Objective, Role, and Expectations. If a component is missing or weak, state that clearly.
      2.  **Score the Prompt:** Provide a numerical score from 0 to 100, where 100 is a perfect, highly effective prompt. The score should be based on the clarity, completeness, and effectiveness of the C.O.R.E components.
      3.  **Provide Detailed Analysis:** For each C.O.R.E component, give a brief analysis of its quality in the provided prompt.
      4.  **Give Actionable Suggestions:** Offer concrete, actionable suggestions for how to improve the prompt.
      5.  Your response MUST be a valid JSON object. Do not include any text, comments, or markdown formatting (like \`\`\`json) before or after the JSON object.
    `;
    const schema = {
        type: Type.OBJECT,
        properties: {
            score: { type: Type.NUMBER },
            analysis: {
                type: Type.OBJECT,
                properties: {
                    context: { type: Type.STRING },
                    objective: { type: Type.STRING },
                    role: { type: Type.STRING },
                    expectations: { type: Type.STRING }
                },
                required: ['context', 'objective', 'role', 'expectations']
            },
            suggestions: { type: Type.STRING }
        },
        required: ['score', 'analysis', 'suggestions']
    };
    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: metaPrompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schema
        }
    });
    return jsonResponse(JSON.parse(result.text.trim()));
}
