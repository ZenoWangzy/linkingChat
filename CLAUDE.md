# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

LinkingChat (codename: Ghost Mate) has completed **Sprint 0–2**. The platform has a working NestJS server with auth, device control, friends, 1-on-1 & group chat, bots framework, plus full Flutter mobile UI and Electron desktop UI. **Sprint 3 (AI module + OpenClaw integration)** is next.

### What's working:
- `pnpm install` — Turborepo v2 + pnpm 10 workspace (5 packages)
- `pnpm docker:up` — PostgreSQL:5440, Redis:6387, MinIO:9008, Adminer:8088, MailDev:1088
- `pnpm dev:server` — NestJS on http://localhost:3008/api/v1
- `pnpm dev:desktop` — Electron + electron-vite + React (full chat UI with group info panel)
- `pnpm dev:mobile` — Flutter mobile app (full chat UI, friends, groups, device control)
- `pnpm build` — All 4 packages compile (server, desktop, shared, ws-protocol)
- `pnpm test` — 7 suites, 102 tests passing (auth, friends, messages, presence, converses, bots, bot-init)
- `pnpm lint` / `pnpm type-check` — Code quality checks
- `pnpm db:migrate` / `pnpm db:seed` — Prisma migrations and seeding
- Prisma schema: 12 models (User, Device, Command, RefreshToken, FriendRequest, Friendship, UserBlock, Converse, ConverseMember, Message, Attachment, Bot)

### Environment Setup
Required `.env` in `apps/server/`:
- `DATABASE_URL` — PostgreSQL connection (e.g., `postgresql://user:pass@localhost:5440/linkingchat`)
- `REDIS_URL` — Redis connection (e.g., `redis://localhost:6387`)
- `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` — RS256 key pair (base64 encoded)
- `DEEPSEEK_API_KEY` / `KIMI_API_KEY` — LLM providers (Sprint 3+)

### Sprint completion:
- **Sprint 0** ✅ — Infrastructure setup (monorepo, Docker, Prisma, CI)
- **Sprint 1** ✅ — Auth (JWT RS256) + device registration + WS gateway + shell exec + full chain PoC
- **Sprint 2** ✅ — Friends, 1-on-1 chat, presence, read receipts, Bot framework (Bot-as-User), group chat CRUD + permissions, Flutter + Desktop full chat UI (~90 new files, ~8,500+ lines)
- **Sprint 3** 🔧 — AI module (LLM Router, Whisper, Draft & Verify, Predictive Actions) + OpenClaw Gateway + Supervisor notifications
  - **Phase 5** ✅ — OpenClaw Gateway 云端集成已完成 (2026-02-28)

### Sprint 2 deferred to Sprint 3:
- ~~OpenClaw Gateway integration~~ (Phase 5 ✅ 完成)
- Supervisor notification aggregation (Sprint 3 Phase 6)

Technical decisions are in `docs/decisions/decision-checklist.md` and `docs/decisions/tech-decisions-v2.md`.

## What This Project IS

LinkingChat is a **new AI-native social app** (similar in form to Discord/Telegram/WhatsApp) with deep integration of OpenClaw remote-control capabilities. It is **NOT** about attaching to or automating existing apps like WeChat/Slack.

> Note: The original design docs (prd.md, architecture.md) have been archived to `docs/_archive/` — they describe a superseded "parasitic Desktop Bridge" direction.

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

### OpenClaw Cloud Architecture (Phase 5)
OpenClaw Gateway 部署在 Cloud Brain（每用户一个实例），Desktop 使用 openclaw-node 客户端连接：
- Gateway Manager Service 管理多用户 Gateway 进程
- 动态端口分配 (18790-18889)
- JWT Token 认证集成
- Desktop 启动时自动连接，命令执行优先使用 OpenClaw，失败降级到 child_process

```
Flutter Mobile App  <--WSS-->  Cloud Brain (NestJS)  <--WSS-->  Electron Desktop Client
  (Controller)                   ├── WebSocket Gateway                 ├── Social UI (chat)
  ├── Social UI                  ├── Intent Planner                    ├── OpenClaw Worker
  ├── Send commands              ├── LLM Router                        ├── Shell Exec (fallback)
  └── Confirm drafts             ├── Draft State Machine               ├── File IO
                                 ├── OpenClaw Integration              └── Local task execution
                                 └── Gateway Manager (multi-tenant)
```

- **Mobile App (Flutter)**: Social interface + remote command issuer. iOS & Android from one codebase.
- **Cloud Brain (NestJS / TypeScript)**: WebSocket gateway, intent planning, LLM inference with multi-provider routing (cheap models like DeepSeek for simple tasks, powerful models like Kimi 2.5 for complex tasks). Hosts all Agent logic.
- **Desktop Client (Electron + Node.js/TypeScript)**: Full GUI social client (like Discord desktop) + local OpenClaw worker that receives and executes remote commands.

## Key Data Architecture (Sprint 2+)

### Converse model (unified conversation container)
- `type` enum: `DIRECT` (1-on-1), `GROUP`, `BOT` (user-bot conversation)
- Groups use `ConverseMember` with `GroupRole` enum: `OWNER`, `ADMIN`, `MEMBER`
- Permission checks are role-based (not string permission lists)

### REST endpoint patterns
- Auth: `/api/v1/auth/*`
- Users: `/api/v1/users/*`
- Devices: `/api/v1/devices/*`
- Friends: `/api/v1/friends/*`
- Converses: `/api/v1/converses/*`
- Groups: `/api/v1/converses/groups/*` (groups are a sub-resource of converses)
- Messages: `/api/v1/messages/*`
- Bots: `/api/v1/bots/*`
- Commands: `/api/v1/commands/*`
- OpenClaw: `/api/v1/openclaw/gateway/*` (connect, start, stop, status)

### WebSocket namespaces
- `/device` — device control (register, heartbeat, command send/execute/result)
- `/chat` — messaging (message send/receive, typing, read receipts, presence)

## Confirmed Tech Decisions

| Decision | Choice |
|---|---|
| Implementation strategy | Full-chain minimal PoC (all 3 components simultaneously) |
| Language | TypeScript everywhere (Dart for mobile) |
| Cloud framework | NestJS 11 (Node.js 22+ / TypeScript 5.7+) |
| Mobile framework | Flutter (Dart) |
| Desktop framework | Electron 35 + electron-vite 3 + React 19 |
| Database | PostgreSQL 16 + Prisma 6 ORM |
| Cache/PubSub | Redis 7 |
| File storage | MinIO (S3-compatible) |
| Repo structure | Turborepo v2 monorepo with pnpm 10 workspaces |
| LLM | Multi-provider with routing (DeepSeek for cheap, Kimi 2.5 for complex) |
| WebSocket | Socket.IO with typed events (@linkingchat/ws-protocol) |
| Auth | JWT RS256 asymmetric keys (access + refresh token pair) |
| Testing | Jest (unit tests from day one) |
| CI | GitHub Actions (lint + type-check + test) |
| Dev platform priority | Both macOS and Windows; macOS first if forced to choose |
| Port scheme | All +8 to avoid conflicts (NestJS:3008, PG:5440, Redis:6387, etc.) |

## First Milestone ✅

> "手机 App 发送一个干活的指令给电脑端，电脑直接干活并且将任务交付，发回给手机端回复已经做完任务"

Mobile sends a work command → Desktop executes → Desktop reports completion back to mobile. **Achieved in Sprint 1.**

## Three Core Interaction Patterns

1. **Draft & Verify (代理草稿)** [P0]: User sends intent → bot generates draft → user confirms before execution. Bot **never** acts autonomously.
2. **The Whisper (耳语建议)** [P1]: User triggers via `@ai` → cloud generates 1 best reply (pre-filled in input) + `···` to expand 2 alternatives. Auto-push chips **rejected** (too generic). Ghost text completion planned for v2+ (local small model).
3. **Predictive Actions (预测执行)** [P0]: Bot analyzes context (e.g., shell errors) → generates action card → dangerous commands blocked or flagged.

## Performance Targets

- Message mirror latency: <2 seconds
- Remote action execution: <3 seconds
- @ai reply generation: <2 seconds (user-triggered, has wait expectation)

## Mobile UI Direction

- WeChat/WhatsApp style, less is more
- Bot = fixed pinned system contact (like WeChat "File Transfer Assistant")
- Multi-bot framework from MVP, but only remote execution capability initially
- Each bot maps to an OpenClaw agent config

## Multi-Bot Architecture

- MVP: bot CRUD + routing framework, only remote execution capability
- Auto-create on registration: Supervisor Bot (pinned, undeletable) + Coding Bot (pinned, configurable)
- v1.x: add bot types per demand (social media, data analysis, etc.)
- v2.0: open custom bot creation
- Supervisor Bot = notification aggregator + smart concierge (not the only entry point)
- Supervisor chat UI: normal chat flow + BOT_NOTIFICATION cards (no tabs)

## Bot Communication Rules

- All bots can communicate with each other (OpenClaw multi-agent orchestration)
- Each bot notifies user in its own chat window
- Cross-bot triggered messages MUST indicate trigger source (e.g., "[From Coding Bot]")
- Supervisor aggregates all bot events as notification cards
- Draft & Verify still applies: bots cannot auto-execute actions
- In group chats: bots can be added as members (Telegram model), @specificBot for direct call, @ai = Supervisor fallback

## Backend: NestJS Confirmed, Rust Rejected (2026-02-13)

Scalability through architecture (horizontal scaling + Redis + Nginx LB), not language. Rust reconsidered only if data shows specific hot-path bottlenecks post-product-validation.

## Documentation Map

```
docs/
├── decisions/                          # Strategic & technical decisions
│   ├── project-brief.md                — Strategic vision v2.0, core interaction patterns
│   ├── decision-checklist.md           — Team's confirmed technical decisions
│   ├── follow-up-questions.md          — Architect follow-up questions v1
│   ├── follow-up-questions-v2.md       — Architect follow-up questions v2 with team answers
│   ├── tech-decisions-v2.md            — ★ Core: OpenClaw, IM protocol, scaffold, execution path
│   ├── zeroclaw-evaluation.md          — ZeroClaw vs OpenClaw evaluation (2026-02-16)
│   └── user-stories.md                 — BDD acceptance criteria
│
├── research/                           # Technical research & analysis
│   ├── research-report.md              — Technical research report for project references
│   ├── research-projects-detailed.md   — Detailed reference project analysis
│   ├── research-im-protocols.md        — Open source IM protocol/platform research
│   ├── research-tinode.md              — Tinode Chat deep-dive
│   ├── research-gemini-projects.md     — Gemini-recommended projects analysis
│   ├── fork-vs-build-analysis.md       — Fork Tailchat vs self-build evaluation
│   └── tech-route-final-comparison.md  — Route A (fork) vs Route C (build) final comparison
│
├── dev-plan/                           # Implementation plans & specs
│   ├── reference-architecture-guide.md — ★ "Copy homework" guide from Valkyrie/nestjs-chat/Tailchat
│   ├── project-skeleton.md             — Monorepo structure & module design
│   ├── sprint-1-plan.md                — Sprint 1 detailed plan (minimal PoC)
│   ├── websocket-protocol.md           — WebSocket protocol design
│   ├── database-schema.md              — Database entity design
│   └── dev-environment-setup.md        — Dev environment setup guide
│
├── dev/                                # Sprint implementation guides
│   ├── sprint0_implement.md            — Sprint 0: Infrastructure setup (✅ DONE)
│   ├── sprint0_implement_mark.md       — Sprint 0 implementation record
│   ├── sprint1_implement.md            — Sprint 1: Auth + device + WS + shell exec (✅ DONE)
│   ├── sprint1_implement_mark.md       — Sprint 1 implementation record
│   ├── sprint2_implement.md            — Sprint 2: Friends, chat, bots, groups, UI (✅ DONE)
│   ├── sprint2_implement_mark.md       — Sprint 2 implementation record
│   ├── sprint3_implement.md            — Sprint 3: AI module + OpenClaw + enhancements (🔧 NEXT)
│   └── sprint4_implement.md            — Sprint 4: Polish + production readiness
│
├── plans/                              # Phase-specific design documents
│   ├── 2026-02-28-phase5-openclaw-design.md        — Phase 5 OpenClaw 架构设计
│   └── 2026-02-28-phase5-implementation.md         — Phase 5 实施计划
│
└── _archive/                           # Superseded documents
    ├── architecture.md                 — Old "parasitic Desktop Bridge" direction
    ├── prd.md                          — Old product requirements
    └── gemini-research.md              — Original Gemini report (errors corrected in research/)
```

## Open Questions

Most blocking questions have been resolved in `docs/decisions/tech-decisions-v2.md`.

- ~~**F1**: Scope of Desktop Bridge~~ → Resolved: OpenClaw Node as independent process
- ~~**F2**: What is OpenClaw?~~ → Resolved: Open-source AI Agent Gateway (TypeScript, MIT), see tech-decisions-v2.md §2
- ~~**F3**: "Control own desktop" vs "control friend's desktop"~~ → MVP: control own desktop
- ~~**F4**: MVP social feature boundary~~ → Resolved: All features except voice/video calls, see tech-decisions-v2.md §1.2
- ~~**F7**: Electron desktop app positioning~~ → Resolved: Social client + OpenClaw executor (confirmed by Sprint 1-2 implementation)

## Key File Locations (Phase 5+)

### OpenClaw Integration
- Server: `apps/server/src/openclaw/` — Gateway Manager, Controller, Module
- Desktop: `apps/desktop/src/main/services/openclaw-client.service.ts` — OpenClaw 客户端
- Desktop: `apps/desktop/src/main/services/command-executor.service.ts` — 双模式命令执行器
- Tests: `apps/server/src/openclaw/__tests__/gateway-manager.service.spec.ts`

### Test Files Location
- Server tests: `apps/server/src/<module>/__tests__/` (colocated with source)
