# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Neural Link (codename: Ghost Mate) is in **pre-development / design phase**. No implementation code exists yet — only architectural documentation at the repository root. The team's technical decisions are captured in `decision-checklist.md`. Open questions pending team answers are in `follow-up-questions.md`.

## What This Project IS

Neural Link is a **new AI-native social app** (similar in form to Discord/Telegram/WhatsApp) with deep integration of OpenClaw remote-control capabilities. It is **NOT** about attaching to or automating existing apps like WeChat/Slack.

> Note: The original design docs (prd.md, architecture.md) describe a "parasitic Desktop Bridge" controlling WeChat — this direction has been superseded by the decision-checklist. The team has clarified the product is an independent social app. These docs need updating to reflect the current vision.

**Dual functionality:**
1. **Social**: Chat, groups, friends — a standalone messaging platform
2. **Remote Control**: Cloud-integrated OpenClaw can command desktop workers to execute tasks (shell, file ops, automation)

**AI-native features:**
- Smart reply suggestions (The Whisper)
- Draft & Verify — bot generates drafts, user confirms before sending
- Predictive Actions — bot anticipates next steps from context (e.g., error → fix command)
- Proactive reminders and recommendations

## Architecture Overview

Three-tier distributed system: "Cloud Brain + Local Hands"

```
Flutter Mobile App  <--WSS-->  Cloud Brain (Node.js/TS)  <--WSS-->  Electron Desktop Client
  (Controller)                   ├── WebSocket Gateway                 ├── Social UI (chat)
  ├── Social UI                  ├── Intent Planner                    ├── OpenClaw Worker
  ├── Send commands              ├── LLM Router                        ├── Shell Exec
  └── Confirm drafts             ├── Draft State Machine               ├── File IO
                                 └── OpenClaw Integration              └── Local task execution
```

- **Mobile App (Flutter)**: Social interface + remote command issuer. iOS & Android from one codebase.
- **Cloud Brain (Node.js/TypeScript)**: WebSocket gateway, intent planning, LLM inference with multi-provider routing (cheap models like DeepSeek for simple tasks, powerful models like Kimi 2.5 for complex tasks). Hosts all Agent logic.
- **Desktop Client (Electron + Node.js/TypeScript)**: Full GUI social client (like Discord desktop) + local OpenClaw worker that receives and executes remote commands.

## Confirmed Tech Decisions

| Decision | Choice |
|---|---|
| Implementation strategy | Full-chain minimal PoC (all 3 components simultaneously) |
| Language | TypeScript everywhere |
| Cloud framework | Node.js / TypeScript |
| Mobile framework | Flutter |
| Desktop framework | Electron |
| Database | PostgreSQL |
| Repo structure | Monorepo (pnpm workspace or turborepo), split later if needed |
| LLM | Multi-provider with routing (DeepSeek for cheap, Kimi 2.5 for complex) |
| Testing | Unit tests from day one (Jest or Vitest) |
| Dev platform priority | Both macOS and Windows; macOS first if forced to choose |
| Doc framework | Bmad v6 going forward |
| Team | 2-3 developers, front/back separated |

## First Milestone

> "手机 App 发送一个干活的指令给电脑端，电脑直接干活并且将任务交付，发回给手机端回复已经做完任务"

Mobile sends a work command → Desktop executes → Desktop reports completion back to mobile.

## Three Core Interaction Patterns

1. **Draft & Verify (代理草稿)** [P0]: User sends intent → bot generates draft → user confirms before execution. Bot **never** acts autonomously.
2. **The Whisper (耳语建议)** [P1]: On incoming message, cloud generates 3 reply suggestions in <800ms. If >1000ms, client abandons display.
3. **Predictive Actions (预测执行)** [P0]: Bot analyzes context (e.g., shell errors) → generates action card → dangerous commands blocked or flagged.

## Performance Targets

- Message mirror latency: <2 seconds
- Remote action execution: <3 seconds
- AI suggestion chips: <800ms

## Documentation Map

All docs are at repository root:

- `project-brief.md` — Strategic vision v2.0, core interaction patterns, success metrics
- `prd.md` — Product requirements v1.3 (⚠️ describes old "parasitic" direction, needs update)
- `architecture.md` — System architecture v1.2 (⚠️ describes old Desktop Bridge, needs update)
- `user-stories.md` — BDD acceptance criteria with happy/error/edge paths
- `decision-checklist.md` — Team's confirmed technical decisions
- `follow-up-questions.md` — Open questions pending team answers

## Open Questions (Blocking)

Key decisions still needed (see `follow-up-questions.md` for full list):

- **F1**: Scope of Desktop Bridge in new direction (just local work execution, or also third-party app control?)
- **F2**: What is OpenClaw? (Own project? Third-party? Core capabilities? Existing code?)
- **F3**: "Control own desktop" vs "control friend's desktop" — which is MVP?
- **F4**: MVP social feature boundary (registration, friends, 1:1 chat, groups, push notifications?)
- **F7**: Electron desktop app positioning (pure social client? Social + executor? Primarily executor?)
