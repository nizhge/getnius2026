import {
  estimatePreflightCostUsd,
  estimateUsageCostUsd,
} from './cost';
import { GeminiInteractionsProvider } from './gemini-interactions';
import { parseJsonObject } from './json';
import type {
  AgentCallTrace,
  AgentPlan,
  GraphModels,
  GraphRunOptions,
  GraphRunResult,
  ModelCallResult,
  ModelProvider,
  PlannedTask,
  VerificationDecision,
  WorkerResult,
} from './types';

const DEFAULT_MODELS: GraphModels = {
  planner: 'gemini-3.8-flash',
  worker: 'gemini-2.5-flash-lite',
  verifier: 'gemini-3.8-flash',
  synthesizer: 'gemini-3.8-flash',
};

const DEFAULT_MAX_BUDGET_USD = 2;

export class AgentBudgetExceededError extends Error {
  constructor(
    public readonly budgetUsd: number,
    public readonly estimatedSpendUsd: number,
  ) {
    super(
      `Agent graph budget exceeded: $${estimatedSpendUsd.toFixed(4)} > $${budgetUsd.toFixed(4)}`,
    );
    this.name = 'AgentBudgetExceededError';
  }
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = value ?? fallback;
  return Math.max(min, Math.min(max, Math.floor(candidate)));
}

function clip(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await fn(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => consume()),
  );
  return results;
}

function normalizePlan(raw: Partial<AgentPlan>, workerCount: number): AgentPlan {
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks.slice(0, workerCount) : [];
  const tasks: PlannedTask[] = rawTasks
    .filter((task): task is PlannedTask => Boolean(task && typeof task.objective === 'string'))
    .map((task, index) => ({
      id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : `worker-${index + 1}`,
      objective: task.objective.trim(),
      context: typeof task.context === 'string' ? task.context.trim() : undefined,
      risk: task.risk === 'high' || task.risk === 'medium' ? task.risk : 'low',
    }));

  if (tasks.length === 0) {
    tasks.push({
      id: 'worker-1',
      objective: 'Solve the objective directly and return the strongest evidence-backed result.',
      risk: 'medium',
    });
  }

  const seen = new Set<string>();
  for (let index = 0; index < tasks.length; index += 1) {
    let id = tasks[index].id;
    if (seen.has(id)) id = `worker-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    tasks[index].id = id;
    seen.add(id);
  }

  return {
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    tasks,
  };
}

function normalizeVerification(
  raw: Partial<VerificationDecision>,
  validWorkerIds: Set<string>,
): VerificationDecision {
  const retryWorkerIds = Array.isArray(raw.retryWorkerIds)
    ? raw.retryWorkerIds.filter(
        (id): id is string => typeof id === 'string' && validWorkerIds.has(id),
      )
    : [];

  const confidence = Number(raw.confidence);
  return {
    pass: raw.pass === true,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    issues: Array.isArray(raw.issues)
      ? raw.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 20)
      : [],
    retryWorkerIds: [...new Set(retryWorkerIds)],
  };
}

export async function runAgentGraph(
  objective: string,
  options: GraphRunOptions = {},
  provider: ModelProvider = new GeminiInteractionsProvider(),
): Promise<GraphRunResult> {
  const workerCount = clamp(options.workerCount, 8, 1, 100);
  const concurrency = clamp(options.concurrency, 8, 1, 25);
  const maxRetries = clamp(options.maxRetries, 1, 0, 3);
  const maxBudgetUsd = Math.max(0.001, options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD);
  const models: GraphModels = { ...DEFAULT_MODELS, ...options.models };

  const plannerMaxOutputTokens = options.plannerMaxOutputTokens ?? 2_048;
  const workerMaxOutputTokens = options.workerMaxOutputTokens ?? 1_536;
  const verifierMaxOutputTokens = options.verifierMaxOutputTokens ?? 2_048;
  const synthesizerMaxOutputTokens = options.synthesizerMaxOutputTokens ?? 3_072;

  const calls: AgentCallTrace[] = [];
  let spentUsd = 0;

  async function invoke(
    role: AgentCallTrace['role'],
    model: string,
    input: string,
    maxOutputTokens: number,
    taskId?: string,
    systemInstruction?: string,
  ): Promise<ModelCallResult> {
    const reserve = estimatePreflightCostUsd(model, input, maxOutputTokens);
    if (spentUsd + reserve > maxBudgetUsd) {
      throw new AgentBudgetExceededError(maxBudgetUsd, spentUsd + reserve);
    }

    const result = await provider.generate({
      model,
      input,
      systemInstruction,
      maxOutputTokens,
    });
    const estimatedCostUsd = estimateUsageCostUsd(result.model || model, result.usage);
    spentUsd += estimatedCostUsd;
    calls.push({
      role,
      taskId,
      model: result.model || model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      estimatedCostUsd,
      interactionId: result.interactionId,
    });
    return result;
  }

  const plannerPrompt = `You are the planner for a parallel research/analysis graph.\n\nOBJECTIVE:\n${objective}\n\nCreate at most ${workerCount} non-overlapping worker tasks. Prefer fewer tasks when more would be redundant. Each worker must be independently executable. Mark factual, financial, legal, safety, or high-consequence claims as higher risk.\n\nReturn JSON only in this schema:\n{"rationale":"short explanation","tasks":[{"id":"worker-1","objective":"specific task","context":"optional context","risk":"low|medium|high"}]}`;
  const planner = await invoke(
    'planner',
    models.planner,
    plannerPrompt,
    plannerMaxOutputTokens,
    undefined,
    'Decompose work precisely. Do not fabricate facts. Return valid JSON only.',
  );
  const plan = normalizePlan(parseJsonObject<AgentPlan>(planner.text), workerCount);

  async function runWorker(task: PlannedTask, attempts: number): Promise<WorkerResult> {
    const input = `Parent objective:\n${objective}\n\nYour assigned task (${task.id}):\n${task.objective}\n${task.context ? `\nContext:\n${task.context}\n` : ''}\nRisk level: ${task.risk}.\n\nProduce a compact, evidence-conscious result. Explicitly distinguish facts, assumptions, and uncertainty. Do not claim you verified something you did not verify.`;
    const call = await invoke(
      'worker',
      models.worker,
      input,
      workerMaxOutputTokens,
      task.id,
      'Execute only your assigned branch. Be concise and preserve provenance/uncertainty.',
    );
    return {
      task,
      output: call.text,
      attempts,
      model: call.model,
      interactionId: call.interactionId,
    };
  }

  let workers = await mapWithConcurrency(plan.tasks, concurrency, (task) => runWorker(task, 1));
  let retriesUsed = 0;

  async function verify(currentWorkers: WorkerResult[]): Promise<VerificationDecision> {
    const workerPayload = currentWorkers
      .map(
        (worker) =>
          `### ${worker.task.id} (risk=${worker.task.risk}, attempts=${worker.attempts})\n${clip(worker.output, 1_800)}`,
      )
      .join('\n\n');
    const verifierPrompt = `Verify the parallel workers against the parent objective.\n\nOBJECTIVE:\n${objective}\n\nWORKER RESULTS:\n${workerPayload}\n\nFail if there are material contradictions, unsupported high-risk claims, missing critical coverage, or obvious reasoning errors. Request retries only for branches that need correction; do not rerun sound work.\n\nReturn JSON only:\n{"pass":true,"confidence":0.0,"issues":["issue"],"retryWorkerIds":["worker-id"]}`;
    const call = await invoke(
      'verifier',
      models.verifier,
      verifierPrompt,
      verifierMaxOutputTokens,
      undefined,
      'Audit aggressively but economically. Return valid JSON only.',
    );
    return normalizeVerification(
      parseJsonObject<VerificationDecision>(call.text),
      new Set(currentWorkers.map((worker) => worker.task.id)),
    );
  }

  let verification = await verify(workers);
  while (!verification.pass && retriesUsed < maxRetries) {
    const requested = new Set(
      verification.retryWorkerIds.length > 0
        ? verification.retryWorkerIds
        : workers.map((worker) => worker.task.id),
    );
    const retryTargets = workers.filter((worker) => requested.has(worker.task.id));
    const replacements = await mapWithConcurrency(retryTargets, concurrency, (worker) =>
      runWorker(worker.task, worker.attempts + 1),
    );
    const replacementMap = new Map(replacements.map((worker) => [worker.task.id, worker]));
    workers = workers.map((worker) => replacementMap.get(worker.task.id) ?? worker);
    retriesUsed += 1;
    verification = await verify(workers);
  }

  const synthesisPayload = workers
    .map((worker) => `### ${worker.task.id}\n${clip(worker.output, 2_200)}`)
    .join('\n\n');
  const synthesisPrompt = `Synthesize a final answer for the parent objective using the worker results and verifier outcome.\n\nOBJECTIVE:\n${objective}\n\nVERIFIER:\npass=${verification.pass}; confidence=${verification.confidence}; issues=${verification.issues.join(' | ') || 'none'}\n\nWORKER RESULTS:\n${synthesisPayload}\n\nDo not hide unresolved uncertainty or verifier issues. Prefer a direct, decision-useful answer over repetition.`;
  const synthesis = await invoke(
    'synthesizer',
    models.synthesizer,
    synthesisPrompt,
    synthesizerMaxOutputTokens,
    undefined,
    'Combine validated branches faithfully. Never invent evidence.',
  );

  return {
    objective,
    plan,
    workers,
    verification,
    answer: synthesis.text,
    totalEstimatedCostUsd: Number(spentUsd.toFixed(8)),
    calls,
    retriesUsed,
  };
}
