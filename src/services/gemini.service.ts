import { Injectable } from '@angular/core';
import { GoogleGenAI, Type, GenerateContentResponse, Part } from '@google/genai';

export interface PromptGenerationRequest {
  context: string;
  objective: string;
  role: string;
  expectations: string;
  systemInstruction: string;
  promptBody: string;
  mediaInstruction: string;
  aiPlatform: string;
  outputType: string;
  file?: { data: string; mimeType: string };
  previewLanguage: string;
  masterPromptLanguages: string[];
  // New advanced params
  temperature: number;
  topP: number;
  aspectRatio: string;
}

export interface PromptGenerationResponse {
  masterPrompts: { language: string; prompt: string }[];
  preview: {
    type: 'text' | 'image' | 'video' | null;
    content: string; // Can be text, base64 image, or a data URL for video
  };
}

export interface PromptAnalysisResult {
  score: number;
  analysis: {
    context: string;
    objective: string;
    role: string;
    expectations: string;
  };
  suggestions: string;
}

const IMAGE_OUTPUT_TYPES = ['Image', 'Ảnh', 'Hình ảnh'];
const VIDEO_OUTPUT_TYPES = ['Video', 'Phim ngắn'];

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    if (!process.env.API_KEY) {
      console.warn("API_KEY environment variable not set.");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async generateProfessionalPrompt(
    data: PromptGenerationRequest
  ): Promise<PromptGenerationResponse> {
    const languagesString = data.masterPromptLanguages.join(', ');

    const metaPrompt = `
      You are a world-class prompt engineering expert AI. Your task is to create a "Master Prompt" based on the user's structured input using the C.O.R.E framework.
      The goal is to synthesize the provided components into a powerful, clear, and effective prompt tailored for the specified AI platform and desired output format.

      **User's Input Components (C.O.R.E Framework):**
      1.  **Context (Bối cảnh):** ${data.context}
      2.  **Objective (Mục tiêu):** ${data.objective}
      3.  **Role (Vai trò AI cần đảm nhận):** ${data.role}
      4.  **Expectations (Kỳ vọng về kết quả):** ${data.expectations}

      **Additional Instructions:**
      *   **System Instruction (Overall AI Persona):** ${data.systemInstruction}
      *   **Main Prompt Body (The Core Task):** ${data.promptBody}
      *   **Media Instructions (If any):** ${data.mediaInstruction || 'Không có'}
      *   **Target AI Platform:** ${data.aiPlatform}
      *   **Output Format:** ${data.outputType}

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
              language: { type: Type.STRING, description: "The language of the prompt (e.g., 'English', 'Vietnamese')." },
              prompt: { type: Type.STRING, description: "The master prompt text in the specified language." }
            },
            required: ['language', 'prompt']
          }
        }
      },
      required: ['prompts']
    };

    try {
      const promptGenerationResult = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: metaPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });

      const result = JSON.parse(promptGenerationResult.text.trim());
      const masterPrompts: { language: string; prompt: string }[] = result.prompts;

      if (!masterPrompts || masterPrompts.length === 0) {
        throw new Error("AI did not return any prompts.");
      }

      let preview: PromptGenerationResponse['preview'] = { type: null, content: '' };
      let basePromptForPreview = masterPrompts.find(p => p.language.toLowerCase() === 'english')?.prompt || masterPrompts[0].prompt;

      const previewPromptParts: Part[] = [{ text: basePromptForPreview }];
      if (data.file) {
         const [header, base64Data] = data.file.data.split(',');
         if (base64Data) {
            previewPromptParts.unshift({
              inlineData: { mimeType: data.file.mimeType, data: base64Data },
            });
         }
      }

      if (IMAGE_OUTPUT_TYPES.includes(data.outputType)) {
        const imageResponse = await this.ai.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: basePromptForPreview,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/png',
              aspectRatio: data.aspectRatio,
            },
        });
        const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
        preview = { type: 'image', content: `data:image/png;base64,${base64ImageBytes}` };
      } else if (VIDEO_OUTPUT_TYPES.includes(data.outputType)) {
          let videoGenParams: any = { model: 'veo-2.0-generate-001', prompt: basePromptForPreview, config: { numberOfVideos: 1 } };
          if (data.file && data.file.mimeType.startsWith('image/')) {
             const [_, base64Data] = data.file.data.split(',');
             videoGenParams.image = { imageBytes: base64Data, mimeType: data.file.mimeType };
          }
          let operation = await this.ai.models.generateVideos(videoGenParams);
          while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await this.ai.operations.getVideosOperation({ operation: operation });
          }
          const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
          if (downloadLink) {
              const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
              const videoBlob = await videoResponse.blob();
              const videoDataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(videoBlob);
              });
              preview = { type: 'video', content: videoDataUrl };
          } else { throw new Error('Không thể tạo video.'); }
      } else {
        const finalPromptForTextPreview = [...previewPromptParts];
        const lastPartIndex = finalPromptForTextPreview.length - 1;
        if (lastPartIndex >= 0 && 'text' in finalPromptForTextPreview[lastPartIndex]) {
            (finalPromptForTextPreview[lastPartIndex] as {text: string}).text += `\n\n--- IMPORTANT: Please provide your entire response in ${data.previewLanguage}. ---`;
        }
        const textPreviewResponse: GenerateContentResponse = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: finalPromptForTextPreview },
          config: { temperature: data.temperature, topP: data.topP }
        });
        preview = { type: 'text', content: textPreviewResponse.text };
      }

      return { masterPrompts, preview };
    } catch (error) {
      console.error('Error in generation process:', error);
      const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định.';
      throw new Error(`Không thể tạo prompt. Lỗi: ${errorMessage}`);
    }
  }

  async analyzePromptQuality(promptToAnalyze: string): Promise<PromptAnalysisResult> {
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
            score: { type: Type.NUMBER, description: "A score from 0 to 100 for the prompt's quality." },
            analysis: {
                type: Type.OBJECT,
                properties: {
                    context: { type: Type.STRING, description: "Analysis of the Context component." },
                    objective: { type: Type.STRING, description: "Analysis of the Objective component." },
                    role: { type: Type.STRING, description: "Analysis of the Role component." },
                    expectations: { type: Type.STRING, description: "Analysis of the Expectations component." }
                },
                required: ['context', 'objective', 'role', 'expectations']
            },
            suggestions: { type: Type.STRING, description: "A paragraph of actionable suggestions for improving the prompt." }
        },
        required: ['score', 'analysis', 'suggestions']
    };

    try {
        const result = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: metaPrompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: schema
            }
        });
        return JSON.parse(result.text.trim());
    } catch (error) {
        console.error('Error analyzing prompt:', error);
        const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định.';
        throw new Error(`Không thể phân tích prompt. Lỗi: ${errorMessage}`);
    }
  }
}
