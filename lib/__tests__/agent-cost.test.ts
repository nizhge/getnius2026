import { describe, expect, it } from 'vitest';
import { estimateUsageCostUsd } from '../agents/cost';

describe('agent cost estimator', () => {
  it('prices Gemini 3.8 Flash input/output usage', () => {
    expect(
      estimateUsageCostUsd('gemini-3.8-flash', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        thoughtTokens: 0,
        totalTokens: 2_000_000,
      }),
    ).toBeCloseTo(4.5, 8);
  });

  it('includes thought tokens in billed output estimate', () => {
    expect(
      estimateUsageCostUsd('gemini-2.5-flash-lite', {
        inputTokens: 0,
        outputTokens: 100_000,
        thoughtTokens: 100_000,
        totalTokens: 200_000,
      }),
    ).toBeCloseTo(0.08, 8);
  });
});
