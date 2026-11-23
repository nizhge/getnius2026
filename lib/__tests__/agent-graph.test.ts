import { describe, expect, it, vi } from 'vitest';
import { AgentBudgetExceededError, runAgentGraph } from '../agents/graph';
import type {
  ModelCallRequest,
  ModelCallResult,
  ModelProvider,
} from '../agents/types';

class FakeProvider implements ModelProvider {
  calls: ModelCallRequest[] = [];

  async generate(request: ModelCallRequest): Promise<ModelCallResult> {
    this.calls.push(request);
    const call = this.calls.length;
    let text = 'worker output';
    if (call === 1) {
      text = JSON.stringify({
        rationale: 'split into two branches',
        tasks: [
          { id: 'worker-1', objective: 'branch one', risk: 'low' },
          { id: 'worker-2', objective: 'branch two', risk: 'medium' },
        ],
      });
    } else if (call === 4) {
      text = JSON.stringify({
        pass: true,
        confidence: 0.9,
        issues: [],
        retryWorkerIds: [],
      });
    } else if (call === 5) {
      text = 'final synthesis';
    }

    return {
      text,
      model: request.model,
      interactionId: `fake-${call}`,
      latencyMs: 1,
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        thoughtTokens: 0,
        totalTokens: 20,
      },
    };
  }
}

describe('agent graph', () => {
  it('plans, fans out, verifies, and synthesizes', async () => {
    const provider = new FakeProvider();
    const result = await runAgentGraph(
      'test objective',
      {
        workerCount: 2,
        concurrency: 2,
        maxRetries: 0,
        maxBudgetUsd: 5,
      },
      provider,
    );

    expect(result.plan.tasks).toHaveLength(2);
    expect(result.workers).toHaveLength(2);
    expect(result.verification.pass).toBe(true);
    expect(result.answer).toBe('final synthesis');
    expect(provider.calls).toHaveLength(5);
  });
  it('blocks oversubscribed parallel worker admissions while the first call is in flight', async () => {
    vi.stubEnv('AGENT_ASSUME_FREE_TIER', 'false');
    try {
      class SlowWorkers implements ModelProvider {
        calls: ModelCallRequest[] = [];
        async generate(request: ModelCallRequest): Promise<ModelCallResult> {
          this.calls.push(request);
          if (request.model === 'gemini-2.5-flash-lite') {
            // Hold the first worker in flight while the second tries to enter.
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
          return {
            text: this.calls.length === 1
              ? JSON.stringify({
                  rationale: 'two independent tasks',
                  tasks: [
                    { id: 'w1', objective: 'first', risk: 'low' },
                    { id: 'w2', objective: 'second', risk: 'low' },
                  ],
                })
              : 'worker output',
            model: request.model,
            latencyMs: 1,
            usage: { inputTokens: 10, outputTokens: 10, thoughtTokens: 0, totalTokens: 20 },
          };
        }
      }
      const provider = new SlowWorkers();
      await expect(runAgentGraph('test', {
        workerCount: 2,
        concurrency: 2,
        maxRetries: 0,
        maxBudgetUsd: 0.001,
        plannerMaxOutputTokens: 1,
        workerMaxOutputTokens: 1536,
        verifierMaxOutputTokens: 1,
        synthesizerMaxOutputTokens: 1,
      }, provider)).rejects.toBeInstanceOf(AgentBudgetExceededError);
      // Without an in-flight reservation, both workers would be sent to the provider.
      expect(provider.calls.filter((call) => call.model === 'gemini-2.5-flash-lite')).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});
