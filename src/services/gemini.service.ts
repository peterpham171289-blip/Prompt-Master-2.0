import { Injectable } from '@angular/core';

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
  temperature: number;
  topP: number;
  aspectRatio: string;
}

export interface PromptGenerationResponse {
  masterPrompts: { language: string; prompt: string }[];
  preview: {
    type: 'text' | 'image' | 'video' | null;
    content: string;
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

@Injectable({
  providedIn: 'root',
})
export class GeminiService {

  private async postToProxy<T>(body: { type: string; payload: any }): Promise<T> {
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        // If the server returned an error (like API_KEY missing), throw it
        throw new Error(result.error || `Server error: ${response.statusText}`);
      }
      
      return result as T;
    } catch (error) {
       console.error(`Error calling proxy for type ${body.type}:`, error);
       const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định khi giao tiếp với server.';
       throw new Error(`Không thể thực hiện yêu cầu. Lỗi: ${errorMessage}`);
    }
  }

  async generateProfessionalPrompt(data: PromptGenerationRequest): Promise<PromptGenerationResponse> {
    return this.postToProxy<PromptGenerationResponse>({
      type: 'generate',
      payload: data,
    });
  }

  async analyzePromptQuality(promptToAnalyze: string): Promise<PromptAnalysisResult> {
    return this.postToProxy<PromptAnalysisResult>({
      type: 'analyze',
      payload: { promptToAnalyze },
    });
  }
}
