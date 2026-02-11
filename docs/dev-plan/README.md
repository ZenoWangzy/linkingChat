# LinkingChat 开发计划

本目录包含 LinkingChat 项目的技术设计和实施计划文档。

## 文档索引

| 文档 | 内容 |
|------|------|
| [project-skeleton.md](./project-skeleton.md) | Monorepo 项目骨架结构、目录布局、模块设计 |
| [sprint-1-plan.md](./sprint-1-plan.md) | 第一个 Sprint 详细实施计划（最小 PoC） |
| [websocket-protocol.md](./websocket-protocol.md) | WebSocket 协议设计（聊天 + 设备控制 + AI 事件） |
| [database-schema.md](./database-schema.md) | 数据库 Entity 设计（PostgreSQL + TypeORM） |
| [dev-environment-setup.md](./dev-environment-setup.md) | 开发环境搭建指南 |
| [research-tinode.md](./research-tinode.md) | Tinode Chat 深度调研报告（许可证、协议、对比分析） |

## 设计依据

- 主脚手架：[brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate) (MIT)
- 聊天领域模型参考：[sentrionic/Valkyrie v1](https://github.com/sentrionic/Valkyrie/tree/v1) (MIT)
- WebSocket 架构参考：[mahdi-vajdi/nestjs-chat](https://github.com/mahdi-vajdi/nestjs-chat) (MIT)
- 设备控制集成：[OpenClaw](https://github.com/openclaw/openclaw) (MIT)
- IM 协议参考：[tinode/chat](https://github.com/tinode/chat) (GPL-3.0，仅参考协议设计，不直接使用)

详细调研结论见项目根目录 `tech-decisions-v2.md`。
