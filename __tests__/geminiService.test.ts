import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSocialPost, generatePostVideo } from '../services/geminiService';
import { StyleOption, ToneOption, VideoStyle } from '../types';

// Mock the GoogleGenAI SDK
const mockGenerateContent = vi.fn();
const mockGenerateVideos = vi.fn();
const mockGetVideosOperation = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
        generateVideos: mockGenerateVideos,
      },
      operations: {
        getVideosOperation: mockGetVideosOperation
      }
    })),
    Modality: {
      IMAGE: 'IMAGE'
    }
  };
});

// Mock dependencies
vi.mock('../services/geminiClient', () => ({
  getGeminiClient: () => new (require('@google/genai').GoogleGenAI)(),
  requireGeminiApiKey: () => 'fake-api-key',
}));

vi.mock('../utils/imageUtils', () => ({
  parseDataUrl: () => ({ mimeType: 'image/jpeg', data: 'fake-data' }),
  urlToDataUrl: () => Promise.resolve('data:image/jpeg;base64,fake-data'),
}));

describe('GeminiService Model Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default successful responses
    mockGenerateContent.mockResolvedValue({
      text: 'Generated text',
      candidates: [{
        content: {
          parts: [{
            inlineData: { mimeType: 'image/png', data: 'generated-image-data' }
          }]
        }
      }]
    });

    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [{ video: { uri: 'http://fake-video-url.com/video.mp4' } }]
      }
    });
  });

  it('should use gemini-3-pro-preview for text generation', async () => {
    await generateSocialPost(
      'data:image/jpeg;base64,fake',
      StyleOption.Modern,
      ToneOption.Professional,
      'Test Dealer'
    );

    const textCall = mockGenerateContent.mock.calls.find(call => 
      call[0].model === 'gemini-3-pro-preview'
    );
    
    expect(textCall).toBeDefined();
    expect(textCall[0].model).toBe('gemini-3-pro-preview');
  });

  it('should use gemini-3-pro-image-preview for image generation', async () => {
    await generateSocialPost(
      'data:image/jpeg;base64,fake',
      StyleOption.Modern,
      ToneOption.Professional,
      'Test Dealer'
    );

    const imageCall = mockGenerateContent.mock.calls.find(call => 
      call[0].model === 'gemini-3-pro-image-preview'
    );
    
    expect(imageCall).toBeDefined();
    expect(imageCall[0].model).toBe('gemini-3-pro-image-preview');
  });

  it('should use veo-3.1-generate-preview for video generation', async () => {
    // Mock fetch for video download
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-video'])),
    });
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-video-url');
    
    // Mock Image loading for dimensions
    global.Image = class {
      onload: () => void = () => {};
      src: string = '';
      width: number = 100;
      height: number = 100;
      constructor() {
        setTimeout(() => this.onload(), 10);
      }
    } as any;

    await generatePostVideo(
      'data:image/jpeg;base64,fake',
      VideoStyle.EpicReveal,
      { durationSeconds: 5, aspectPreference: 'auto', resolution: '720p', soundtrack: 'none', pacing: 'snappy' }
    );

    expect(mockGenerateVideos).toHaveBeenCalledWith(expect.objectContaining({
      model: 'veo-3.1-generate-preview'
    }));
  });
});
