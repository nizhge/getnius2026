import type { ModelCallRequest, ModelCallResult, ModelProvider, TokenUsage } from './types';

interface InteractionResponse {
  id?: string;
  model?: string;
  status?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

function extractText(payload: InteractionResponse): string {
  const chunks: string[] = [];
  for (const step of payload.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content ?? []) {
      if (part.type === 'text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function extractUsage(payload: InteractionResponse): TokenUsage {
  const inputTokens = payload.usage?.total_input_tokens ?? 0;
  const outputTokens = payload.usage?.total_output_tokens ?? 0;
  const thoughtTokens = payload.usage?.total_thought_tokens ?? 0;
  const totalTokens = payload.usage?.total_tokens ?? inputTokens + outputTokens + thoughtTokens;
  return { inputTokens, outputTokens, thoughtTokens, totalTokens };
}

export class GeminiInteractionsProvider implements ModelProvider {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly timeoutMs = 90_000,
  ) {}

  async generate(request: ModelCallRequest): Promise<ModelCallResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: request.model,
          input: request.input,
          system_instruction: request.systemInstruction,
          store: false,
          generation_config: {
            max_output_tokens: request.maxOutputTokens ?? 2_048,
          },
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as InteractionResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message || `Gemini Interactions API returned ${response.status}`);
      }

      const text = extractText(payload);
      if (!text) {
        throw new Error(`Gemini returned no model_output text (status=${payload.status ?? 'unknown'})`);
      }

      return {
        text,
        model: payload.model ?? request.model,
        interactionId: payload.id,
        latencyMs: Date.now() - startedAt,
        usage: extractUsage(payload),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
