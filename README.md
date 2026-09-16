# Getnius: AI-Assisted Research and Market Intelligence

Getnius is an open-source platform for AI-assisted research workflows, evidence collection, and structured decision support. It explores reliable multi-agent systems, information verification, and selective audit strategies.

## Overview

Getnius provides infrastructure and tooling for:

- **Multi-Agent Research Workflows**: Decompose complex research tasks into collaborative agent workflows
- **Evidence Collection & Structuring**: Gather and organize information from heterogeneous sources
- **Verification & Provenance**: Track evidence origins, implement selective verification strategies, and manage audit budgets
- **Risk-Adaptive Assurance**: Allocate limited verification capacity based on task criticality and estimated downstream impact
- **Reproducible Experiments**: Run controlled evaluations comparing different verification strategies

## Research Focus

The core research question is: **How should a multi-agent system allocate limited verification resources across intermediate claims and agent actions to minimize consequential errors without incurring exhaustive audit costs?**

This project studies selective assurance policies based on signals including:
- Model confidence and calibration
- Inter-agent disagreement
- Provenance quality
- Task criticality
- Historical agent reliability
- Estimated downstream error impact

## Current Status

This is an early-stage research and infrastructure project. The codebase includes:
- Experimental workflows and multi-agent orchestration
- Evidence collection and structuring components
- Verification and audit infrastructure
- Benchmarking and evaluation tools

## Development

### Prerequisites
- Node.js and npm
- Docker and Supabase (for local development)
- Environment variables configured for external API access

### Setup

See the setup guides in the repository:
- [API Configuration](./README_API_SETUP.md)
- [Supabase Setup](./SUPABASE_SETUP.md)
- [Extended Extraction](./README_EXTRUCT_SETUP.md)
- [Parallel Agent Graph](./AGENT_GRAPH.md)

### Local Development

`\bash
npm install
npm run dev
`

## Parallel Agent Graph

Getnius includes a budget-aware fan-out/fan-in agent graph using the Gemini Interactions API. A planner decomposes the objective, cheap workers execute independent branches in parallel, a stronger verifier selectively retries only weak branches, and a synthesizer produces the final result. The API exposes per-call token/cost telemetry and enforces a hard per-run budget ceiling.

See [AGENT_GRAPH.md](./AGENT_GRAPH.md) for configuration, Docker usage, scaling guidance, and the `/api/agents/run` endpoint.

## Contributing

Contributions are welcome! This project focuses on building reusable open-source infrastructure for reliable multi-agent research systems.

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Citation

If you use Getnius in your research, please cite this repository:

`\bibtex
@software{nizhnichenko2026getnius,
  title = {Getnius: Open-Source Infrastructure for Reliable Multi-Agent Research Systems},
  author = {Nizhnichenko, Georgy},
  year = {2026},
  url = {https://github.com/nizhge/getnius2026}
}
`

## Contact

For questions or collaboration opportunities, please open an issue or contact the maintainer.
