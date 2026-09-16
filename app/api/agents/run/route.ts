import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentBudgetExceededError, runAgentGraph } from '@/lib/agents/graph';

export const runtime = 'nodejs';
export const maxDuration = 300;

const requestSchema = z.object({
  objective: z.string().min(3).max(20_000),
  workerCount: z.number().int().min(1).max(100).optional(),
  concurrency: z.number().int().min(1).max(25).optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
  maxBudgetUsd: z.number().positive().max(100).optional(),
  models: z
    .object({
      planner: z.string().min(1).optional(),
      worker: z.string().min(1).optional(),
      verifier: z.string().min(1).optional(),
      synthesizer: z.string().min(1).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server' },
      { status: 503 },
    );
  }

  try {
    const body = requestSchema.parse(await request.json());
    const result = await runAgentGraph(body.objective, {
      workerCount: body.workerCount,
      concurrency: body.concurrency,
      maxRetries: body.maxRetries,
      maxBudgetUsd: body.maxBudgetUsd,
      models: body.models,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof AgentBudgetExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          budgetUsd: error.budgetUsd,
          estimatedSpendUsd: error.estimatedSpendUsd,
        },
        { status: 402 },
      );
    }

    console.error('[agents/run]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent graph failed' },
      { status: 500 },
    );
  }
}
