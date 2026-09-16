# Getnius Agent Graph

Budget-aware parallel agent orchestration for Getnius.

## Architecture

```text
objective
   |
planner (Gemini 3.8 Flash)
   |
   +--> worker 1 --+
   +--> worker 2 --+
   +--> ...        +--> verifier --> targeted retry(s) --> synthesizer --> answer
   +--> worker N --+
```

Workers are logical LLM calls, not servers. The graph supports up to 100 worker branches, while `concurrency` limits how many model requests are in flight at once.

The verifier does **selective retry**: if only two worker branches are weak, only those branches are rerun. This is much cheaper than restarting the whole graph.

## Defaults

- Planner: `gemini-3.8-flash`
- Worker: `gemini-2.5-flash-lite`
- Verifier: `gemini-3.8-flash`
- Synthesizer: `gemini-3.8-flash`
- Worker branches: 8
- Maximum worker branches: 100
- Parallel request cap: 8 by default, 25 maximum
- Verification retries: 1 by default, 3 maximum
- Per-run cost ceiling: `$2.00` by default
- Gemini request storage: disabled (`store=false`)

The current pricing constants live in `lib/agents/cost.ts` and should be reviewed when Google changes model pricing. Unknown models use the fallback prices from environment variables.

## Setup

Set the API key only on the server. Never expose it as `NEXT_PUBLIC_*`.

```bash
GEMINI_API_KEY=...
AGENT_FALLBACK_INPUT_USD_PER_MTOK=1
AGENT_FALLBACK_OUTPUT_USD_PER_MTOK=5
```

If the project is intentionally running on Gemini's Free Tier, you can set:

```bash
AGENT_ASSUME_FREE_TIER=true
```

This makes the dollar cost estimator report zero; it does **not** remove API rate limits or quotas.

## Run

Start Getnius normally and call:

```bash
curl -X POST http://localhost:3000/api/agents/run \
  -H 'Content-Type: application/json' \
  -d '{
    "objective": "Map the competitive landscape for AI market-intelligence platforms and identify evidence-backed gaps",
    "workerCount": 12,
    "concurrency": 8,
    "maxRetries": 1,
    "maxBudgetUsd": 0.50
  }'
```

The response contains the final answer plus the plan, every worker result, verification decision, retry count, per-call token telemetry, interaction IDs, latency, and estimated USD cost.

## High-volume / low-cost mode

For large fan-out jobs, keep the expensive model in planning and verification and use a cheap model for workers:

```json
{
  "workerCount": 100,
  "concurrency": 20,
  "maxRetries": 1,
  "maxBudgetUsd": 1,
  "models": {
    "planner": "gemini-3.8-flash",
    "worker": "gemini-2.5-flash-lite",
    "verifier": "gemini-3.8-flash",
    "synthesizer": "gemini-3.8-flash"
  }
}
```

Do not set 100 workers merely because the system allows it. More workers improve coverage only when the objective decomposes into genuinely independent branches; otherwise they create duplicate context and token spend.

## Budget safety

Before every model call, the graph reserves an estimated worst-case amount based on the prompt and maximum output. If the next call would cross `maxBudgetUsd`, execution stops with HTTP `402` rather than silently overspending. After each successful call, the estimate is replaced by token usage returned by Gemini.

## Reliability

The graph reduces errors through decomposition, independent execution, verification, selective retries, and explicit uncertainty preservation. It does **not** guarantee zero errors. High-consequence outputs still need deterministic validation or human review where appropriate.

## Scaling

For interactive jobs, the Next.js route is sufficient. For long-running jobs, very large fan-out, browser/tool agents, or workloads that may exceed hosting request-duration limits, keep this graph logic but move execution into a durable worker/queue (for example Cloud Run workers plus a queue) and persist run state in Supabase.

The provider is isolated behind `ModelProvider`, so another API or a local model can be added without rewriting the graph.
