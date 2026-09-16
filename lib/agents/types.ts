export type AgentRole = 'planner' | 'worker' | 'verifier' | 'synthesizer';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface ModelCallRequest {
  model: string;
  input: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
}

export interface ModelCallResult {
  text: string;
  model: string;
  interactionId?: string;
  latencyMs: number;
  usage: TokenUsage;
}

export interface ModelProvider {
  generate(request: ModelCallRequest): Promise<ModelCallResult>;
}

export interface PlannedTask {
  id: string;
  objective: string;
  context?: string;
  risk: RiskLevel;
}

export interface AgentPlan {
  rationale: string;
  tasks: PlannedTask[];
}

export interface WorkerResult {
  task: PlannedTask;
  output: string;
  attempts: number;
  model: string;
  interactionId?: string;
}

export interface VerificationDecision {
  pass: boolean;
  confidence: number;
  issues: string[];
  retryWorkerIds: string[];
}

export interface AgentCallTrace {
  role: AgentRole;
  taskId?: string;
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  estimatedCostUsd: number;
  interactionId?: string;
}

export interface GraphModels {
  planner: string;
  worker: string;
  verifier: string;
  synthesizer: string;
}

export interface GraphRunOptions {
  workerCount?: number;
  concurrency?: number;
  maxRetries?: number;
  maxBudgetUsd?: number;
  models?: Partial<GraphModels>;
  plannerMaxOutputTokens?: number;
  workerMaxOutputTokens?: number;
  verifierMaxOutputTokens?: number;
  synthesizerMaxOutputTokens?: number;
}

export interface GraphRunResult {
  objective: string;
  plan: AgentPlan;
  workers: WorkerResult[];
  verification: VerificationDecision;
  answer: string;
  totalEstimatedCostUsd: number;
  calls: AgentCallTrace[];
  retriesUsed: number;
}
