import type { TokenUsage } from './types';

export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

// Paid Standard tier prices as of 2026-09-16. Keep this table small and
// configurable: unknown models can be supplied with AGENT_* pricing env vars.
const MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash-lite': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  'gemini-3.5-flash-lite': { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  'gemini-3.8-flash': { inputPerMillionUsd: 0.75, outputPerMillionUsd: 3.75 },
};

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function getModelPrice(model: string): ModelPrice {
  const known = MODEL_PRICES[model];
  if (known) return known;

  return {
    inputPerMillionUsd: envNumber('AGENT_FALLBACK_INPUT_USD_PER_MTOK') ?? 1,
    outputPerMillionUsd: envNumber('AGENT_FALLBACK_OUTPUT_USD_PER_MTOK') ?? 5,
  };
}

export function estimateUsageCostUsd(model: string, usage: TokenUsage): number {
  if (process.env.AGENT_ASSUME_FREE_TIER === 'true') return 0;
  const price = getModelPrice(model);
  const billedOutputTokens = usage.outputTokens + usage.thoughtTokens;
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMillionUsd +
    (billedOutputTokens / 1_000_000) * price.outputPerMillionUsd
  );
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.5));
}

export function estimatePreflightCostUsd(
  model: string,
  input: string,
  maxOutputTokens: number,
): number {
  return estimateUsageCostUsd(model, {
    inputTokens: estimateTextTokens(input),
    outputTokens: maxOutputTokens,
    thoughtTokens: 0,
    totalTokens: estimateTextTokens(input) + maxOutputTokens,
  });
}
