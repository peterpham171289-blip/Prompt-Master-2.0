import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService, PromptAnalysisResult, PromptGenerationResponse } from './services/gemini.service';

interface GenerationState {
  masterPrompts: { language: string; prompt: string }[];
  preview: {
    type: 'text' | 'image' | 'video' | null;
    content: string;
  };
  isLoading: boolean;
  error: string | null;
  loadingMessage: string;
}

interface AnalysisState {
    result: PromptAnalysisResult | null;
    isLoading: boolean;
    error: string | null;
}

// Interface for project data export/import - API key removed
interface PromptProject {
  context: string;
  objective: string;
  role: string;
  expectations: string;
  systemInstruction: string;
  promptBody: string;
  mediaInstruction: string;
  aiPlatform: string;
  outputType: string;
  uploadedFile: { data: string; mimeType: string; name: string } | null;
  previewLanguage: string;
  masterLanguages: { [key: string]: boolean };
  temperature: number;
  topP: number;
  aspectRatio: string;
  generationState: GenerationState;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
})
export class AppComponent {
  private geminiService = inject(GeminiService);

  // --- UI State ---
  activeTab = signal<'create' | 'analyze'>('create');
  
  // --- Create Tab: Input Signals ---
  context = signal('');
  objective = signal('');
  role = signal('');
  expectations = signal('');
  systemInstruction = signal('');
  promptBody = signal('');
  mediaInstruction = signal('');
  aiPlatform = signal('Gemini');
  outputType = signal('Image');
  uploadedFile = signal<{ data: string; mimeType: string; name: string } | null>(null);
  previewLanguage = signal('Vietnamese');
  masterLanguages = signal<{ [key: string]: boolean }>({ 'English': true, 'Vietnamese': true, 'Chinese': false, 'French': false, 'Japanese': false, 'Spanish': false });
  temperature = signal(0.7);
  topP = signal(0.95);
  aspectRatio = signal('1:1');
  
  // --- Create Tab: Output State Signal ---
  generationState = signal<GenerationState>({ masterPrompts: [], preview: { type: null, content: '' }, isLoading: false, error: null, loadingMessage: '...' });
  
  // --- Analyze Tab: State Signals ---
  promptToAnalyze = signal('');
  analysisState = signal<AnalysisState>({ result: null, isLoading: false, error: null });

  // --- Computed Signals ---
  isMediaOutput = computed(() => ['Image', 'Video'].includes(this.outputType()));
  scoreColorClass = computed(() => {
      const score = this.analysisState().result?.score;
      if (score === null || score === undefined) return 'text-gray-400';
      if (score >= 85) return 'text-green-400';
      if (score >= 60) return 'text-yellow-400';
      return 'text-red-400';
  });

  // --- Static Data ---
  readonly platforms = ['Gemini', 'ChatGPT', 'Claude', 'Midjourney', 'DALL-E 3', 'Stable Diffusion'];
  readonly outputTypes = ['Image', 'Video', 'App', 'Landing Page', 'Web', 'Bài viết Blog', 'Code Snippet', 'Kịch bản', 'Email'];
  readonly languages = ['English', 'Vietnamese', 'Chinese', 'French', 'Japanese', 'Spanish'];
  readonly aspectRatios = { '1:1': 'Vuông', '16:9': 'Ngang (Video)', '9:16': 'Dọc (Story)', '4:3': 'Ngang (Ảnh)', '3:4': 'Dọc (Ảnh)' };
  readonly aspectRatioKeys: string[];

  constructor() {
    this.aspectRatioKeys = Object.keys(this.aspectRatios);
  }

  async generatePrompt() {
    const selectedLanguages = Object.keys(this.masterLanguages()).filter(lang => this.masterLanguages()[lang]);
    if (selectedLanguages.length === 0) {
        this.generationState.update(state => ({ ...state, error: 'Vui lòng chọn ít nhất một ngôn ngữ cho Prompt Master.' }));
        return;
    }
    this.generationState.update(s => ({ ...s, isLoading: true, error: null, loadingMessage: this.isMediaOutput() ? 'Đang tạo media... Quá trình này có thể mất vài phút.' : 'AI đang sáng tạo prompt và kết quả...' }));
    try {
      const response = await this.geminiService.generateProfessionalPrompt({
        context: this.context(), objective: this.objective(), role: this.role(), expectations: this.expectations(),
        systemInstruction: this.systemInstruction(), promptBody: this.promptBody(), mediaInstruction: this.mediaInstruction(),
        aiPlatform: this.aiPlatform(), outputType: this.outputType(), file: this.uploadedFile() ?? undefined,
        previewLanguage: this.previewLanguage(), masterPromptLanguages: selectedLanguages,
        temperature: this.temperature(), topP: this.topP(), aspectRatio: this.aspectRatio(),
      });
      this.generationState.set({ masterPrompts: response.masterPrompts, preview: response.preview, isLoading: false, error: null, loadingMessage: '' });
    } catch (error: any) {
       this.generationState.update(state => ({ ...state, isLoading: false, error: error.message }));
    }
  }

  async analyzePrompt() {
      if (!this.promptToAnalyze().trim()) {
          this.analysisState.update(s => ({...s, error: 'Vui lòng nhập một prompt để phân tích.'}));
          return;
      }
      this.analysisState.set({ result: null, isLoading: true, error: null });
      try {
          const result = await this.geminiService.analyzePromptQuality(this.promptToAnalyze());
          this.analysisState.set({ result, isLoading: false, error: null });
      } catch (error: any) {
          this.analysisState.update(s => ({ ...s, isLoading: false, error: error.message }));
      }
  }

  exportProject() {
    const project: PromptProject = {
      context: this.context(), objective: this.objective(), role: this.role(), expectations: this.expectations(),
      systemInstruction: this.systemInstruction(), promptBody: this.promptBody(), mediaInstruction: this.mediaInstruction(),
      aiPlatform: this.aiPlatform(), outputType: this.outputType(), uploadedFile: this.uploadedFile(),
      previewLanguage: this.previewLanguage(), masterLanguages: this.masterLanguages(),
      temperature: this.temperature(), topP: this.topP(), aspectRatio: this.aspectRatio(),
      generationState: this.generationState(),
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-project-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  onProjectImport(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project: PromptProject = JSON.parse(reader.result as string);
        this.context.set(project.context ?? '');
        this.objective.set(project.objective ?? '');
        this.role.set(project.role ?? '');
        this.expectations.set(project.expectations ?? '');
        this.systemInstruction.set(project.systemInstruction ?? '');
        this.promptBody.set(project.promptBody ?? '');
        this.mediaInstruction.set(project.mediaInstruction ?? '');
        this.aiPlatform.set(project.aiPlatform ?? 'Gemini');
        this.outputType.set(project.outputType ?? 'Image');
        this.uploadedFile.set(project.uploadedFile ?? null);
        this.previewLanguage.set(project.previewLanguage ?? 'Vietnamese');
        this.masterLanguages.set(project.masterLanguages ?? { 'English': true, 'Vietnamese': true, 'Chinese': false, 'French': false, 'Japanese': false, 'Spanish': false });
        this.temperature.set(project.temperature ?? 0.7);
        this.topP.set(project.topP ?? 0.95);
        this.aspectRatio.set(project.aspectRatio ?? '1:1');
        this.generationState.set(project.generationState ?? { masterPrompts: [], preview: { type: null, content: '' }, isLoading: false, error: null, loadingMessage: '...' });
        
        this.activeTab.set('create');
      } catch (e) {
        this.generationState.update(s => ({ ...s, error: "Tệp dự án không hợp lệ hoặc bị hỏng." }));
        this.activeTab.set('create');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e: any) => this.uploadedFile.set({ data: e.target.result, mimeType: file.type, name: file.name });
      reader.readAsDataURL(file);
    }
  }

  removeFile(): void {
    this.uploadedFile.set(null);
    const fileInput = document.getElementById('fileUpload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

  toggleMasterLanguage(lang: string): void {
    this.masterLanguages.update(langs => ({ ...langs, [lang]: !langs[lang] }));
  }
  
  copyToClipboard(text: string): void {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy: ', err));
      }
  }

  fillExample(): void {
    this.context.set('Một công ty công nghệ sắp ra mắt một ứng dụng quản lý dự án mới dựa trên AI có tên là "SynergizeAI".');
    this.objective.set('Viết một bài blog thông báo chi tiết về sự ra mắt, nêu bật các tính năng chính (như tự động phân công nhiệm vụ, dự báo tiến độ), lợi ích cho người dùng, và cách nó giải quyết các vấn đề phổ biến trong quản lý dự án.');
    this.role.set('Hãy hành động như một nhà văn công nghệ chuyên nghiệp và một người đam mê năng suất.');
    this.expectations.set("Bài viết phải dài khoảng 800-1000 từ, có cấu trúc rõ ràng với các tiêu đề phụ, giọng văn chuyên nghiệp nhưng dễ tiếp cận, và kết thúc bằng lời kêu gọi hành động để người dùng đăng ký dùng thử bản beta.");
    this.systemInstruction.set('Bạn là một AI chuyên viết nội dung marketing cho các sản phẩm SaaS B2B, có khả năng biến các tính năng kỹ thuật thành lợi ích hấp dẫn cho khách hàng.');
    this.promptBody.set('Viết một bài blog giới thiệu ứng dụng quản lý dự án mới của chúng tôi, SynergizeAI.');
    this.mediaInstruction.set('Không có.');
    this.aiPlatform.set('Gemini');
    this.outputType.set('Bài viết Blog');
    this.uploadedFile.set(null);
    this.previewLanguage.set('Vietnamese');
    this.masterLanguages.set({ 'English': true, 'Vietnamese': true, 'Chinese': false, 'French': false, 'Japanese': false, 'Spanish': false });
    this.temperature.set(0.7);
    this.topP.set(0.95);
    this.aspectRatio.set('1:1');
  }
}
