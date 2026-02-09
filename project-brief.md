# 📄 Project Brief: Neural Link (v2.0 Refined)

| 属性 | 内容 |
| :--- | :--- |
| **项目名称** | **Neural Link** (代号: Ghost Mate) |
| **版本** | v2.0 (Refined via Brainstorming) |
| **核心定位** | **The Social-Native AI Operating System** (社交原生 AI 操作系统) |
| **Slogan** | **Chat is your new Command Line.** (聊天即指令，好友即接口) |
| **状态** | ✅ 已确认 (Approved) |

---

## 1. 战略愿景 (Vision)

打造一个打破“通讯”与“工具”界限的下一代 IM 平台。
Neural Link 不仅仅是一个聊天软件，它通过将 **OpenClaw (Moltbot)** 的设备控制能力无缝融入社交界面，让用户在聊天窗口中不仅能与人交流，还能指挥自己的（或好友的）电脑完成复杂工作。

**核心理念：** 用户不需要在“微信”和“终端”之间切换。你的 Bot 是你的数字替身，它既能帮你回消息，也能帮你跑代码。

---

## 2. 核心痛点与解决方案 (Problem & Solution)

| 当前痛点 | Neural Link 解决方案 |
| :--- | :--- |
| **割裂的工作流** | 用户需要“一边在 IM 聊需求，一边切到 IDE/终端跑代码”。 | **All-in-Chat:** 聊天窗口即控制台。输入自然语言，Bot 直接在后台调用本地 Node 环境执行。 |
| **AI 恐惧感** | 害怕 AI 自动回复说错话，或自动操作删错文件。 | **Draft & Verify (草稿即正义):** Bot 永远只生成“草稿”或“建议”，必须由用户点击发送或确认。 |
| **配置门槛高** | OpenInterpreter/OpenClaw 需要复杂的本地环境配置。 | **SaaS + Thin Client:** 客户端仅需一个轻量级 Node 运行时，大脑和复杂逻辑全在云端。 |

---

## 3. 三大核心交互模式 (The "Holy Trinity" Experience)

这是本项目区别于传统 IM 和传统 Agent 的关键体验增量：

### 3.1 交互 A: 代理草稿 (Draft & Verify)
* **场景：** 用户通过手机 `@Bot` 下达指令（如“把电脑桌面的 Q3 财报发给王总”）。
* **行为：** Bot **不自动发送**。它会静默连接电脑读取文件，生成一段得体的回复文案，并将“文案 + 附件”挂载到输入框中。
* **用户动作：** 用户确认无误后，点击 **[发送]**。

### 3.2 交互 B: 耳语建议 (The Whisper)
* **场景：** 收到好友消息（如“今晚约饭吗？”）。
* **行为：** Bot 不抢话，不自动回复。它在输入框上方悬浮 **3 个建议回复气泡 (Chips)**（如 `[拒绝: 加班]` `[答应: 哪里?]`）。
* **用户动作：** 点击气泡即填入输入框，长按即发送。

### 3.3 交互 C: 预测执行 (Predictive Actions)
* **场景：** Bot 执行完一个任务后（如分析报错日志）。
* **行为：** Bot 自动预判用户的下一步需求，生成 **“下一步行动按钮”**（如 `[点击运行修复命令]`）。
* **用户动作：** 点击按钮，Bot 直接调用本地 Shell 执行。

---

## 4. 技术架构策略 (Technical Strategy)

采用 **"Cloud Brain + Local Hands" (云端大脑 + 本地傀儡)** 架构：

1.  **桌面端 (The Hand):**
    * **极简 Node.js Runtime:** 不安装完整的 OpenClaw/Python 开发环境。
    * **功能:** 仅作为一个 Socket 客户端，接收云端下发的 JSON 指令（如 `fs.readFile`, `child_process.exec`）。
    * **优势:** 实现“下载即用”，无环境依赖。

2.  **云端 (The Brain):**
    * **SaaS Core:** 托管所有 LLM 推理、Context 管理、User Prompt (`Soul.md`)。
    * **OpenClaw Logic:** 将复杂的 Agent 逻辑（工具调用、规划）封装在云端。

3.  **移动端 (The Remote):**
    * 纯粹的 UI 层。通过云端路由，向桌面端发送指令，并接收执行结果反馈。

---

## 5. 成功指标 (Success Metrics)

* **北极星指标 (North Star):** **每日跨设备指令数 (Daily Cross-Device Intents)**
    * 定义：用户用手机指挥电脑执行任务，或用 Bot 辅助发送消息的次数。
* **体验指标:** **Draft-to-Send Rate (草稿发送率)**
    * 定义：Bot 生成的草稿被用户实际采纳（点击发送）的比例。

---

## 6. 下一步行动 (Next Steps)

1.  **更新 PRD:** 将“三大核心交互”详细写入 `prd.md` 的功能需求章节。
2.  **UI 原型:** 为“草稿模式”和“悬浮气泡”设计高保真原型。
3.  **技术验证 (PoC):** 跑通 `手机 App -> 云端 -> 桌面 Node` 的最小链路。