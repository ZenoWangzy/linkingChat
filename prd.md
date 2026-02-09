

# 🚀 Project Neural Link: 产品需求文档 (PRD) v1.3

| 文档属性 | 内容 |
| --- | --- |
| **产品名称** | **Neural Link** (代号: Ghost Mate) |
| **版本号** | **v1.3 (Logic Hardening)** |
| **核心定位** | **The AI-Powered Remote Controller** (AI 驱动的超级遥控器) |
| **更新摘要** | **修复逻辑断层：** <br>

<br>1. 定义“桌面桥接”以实现社交功能。<br>

<br>2. 引入“引导式提权”流程。<br>

<br>3. 明确“第二屏草稿”交互逻辑。 |

---

## 1. 核心逻辑重构 (Logic Refactoring)

### 1.1 社交孤岛解决方案：桌面桥接 (Desktop Bridge)

* **旧逻辑 (v1.2):** 幻想 Neural Link 是一个独立的聊天软件，用户在这里聊天。
* **新逻辑 (v1.3):** Neural Link 是 **“第二屏控制器”**。
* 用户在手机 Neural Link App 上操作。
* 桌面端 Neural Link **“寄生”** 在 PC 版微信/Slack/Discord 上。
* **读取:** 通过 OCR/Accessibility API 读取桌面即时通讯软件的消息。
* **发送:** 通过模拟键盘/鼠标 (HID) 将生成的内容粘贴并发送。


* **用户价值:** 用户不需要迁移好友关系链，直接赋能现有社交软件。

### 1.2 权限策略：信任阶梯 (Trust Ladder)

* **旧逻辑 (v1.2):** 零配置，直接用。
* **新逻辑 (v1.3):** **引导式提权 (Guided Escalation)**。
* **Level 1 (默认):** 仅能查看文件列表，回复简单的模拟按键。
* **Level 2 (提权):** 当用户想执行 `pip install` 或读取受保护文件时，桌面端弹窗请求 `Admin/Sudo` 权限，并解释原因。



---

## 2. 功能需求 (Functional Requirements)

### 2.1 模块一：第二屏草稿 (The Second Screen Draft) [P0]

**场景：** 用户想给微信好友“王总”发文件，但人不在电脑前。

* **步骤 1 (手机端):**
* 用户在 Neural Link App 输入：“把 Q3 财报发给王总。”


* **步骤 2 (桌面端 - 桥接):**
* Agent 搜索本地文件 `Q3_Report.pdf`。
* Agent 唤起/聚焦 PC 版微信，搜索联系人“王总”。


* **步骤 3 (手机端 - 草稿确认):**
* **关键交互:** Neural Link App 弹出一个 **"Remote Draft" (远程草稿)** 卡片。
* 显示：`[目标: 微信 - 王总]` `[附件: Q3_Report.pdf]` `[附言: 王总请过目...]`
* 状态：**等待确认**。


* **步骤 4 (执行):**
* 用户点击手机上的 **[执行]** 按钮。
* 桌面端模拟操作：`Ctrl+C` (复制文件) -> `Switch Window` (切到微信) -> `Ctrl+V` (粘贴) -> `Enter` (发送)。
* **结果:** 用户看着手机，就像在变魔术一样，电脑上的微信把文件发了出去。



### 2.2 模块二：社交镜像与耳语 (Social Mirror & Whisper) [P1]

**场景：** 电脑开着微信，人躺在床上玩手机。

* **功能逻辑:**
* **镜像推送:** 桌面端通过 Accessibility 监听微信的新消息通知，通过 WebSocket **转发** 到 Neural Link App。
* **AI 介入:** 云端分析消息内容，生成 3 个建议回复 (Chips)。
* **远程回复:** 用户在 Neural Link App 点击气泡 -> 桌面端在微信窗口输入并发送。


* **价值:** 即使微信没开放 API，我们也能通过“外挂”方式实现 AI 辅助。

### 2.3 模块三：行为补全 (Action Autocomplete) [P0]

**场景：** 远程运维。

* **功能:** 保持不变。AI 分析 Shell 报错 -> 推送修复按钮 -> 用户点击 -> 桌面端执行。
* **新增:** **权限拦截 UI**。如果修复命令需要 `sudo`，手机端按钮会显示 `🔒 需要管理员权限`，点击后电脑端弹出 UAC 框，手机端提示“请在电脑上点击允许”。

---

## 3. 非功能需求 (Non-Functional Requirements)

### 3.1 兼容性 (Compatibility)

* **Target Apps:** 必须适配 Windows/Mac 主流版本的 **WeChat, Slack, Discord, DingTalk**。
* **Fail-Safe:** 如果目标应用（如微信）未运行，Agent 应反馈：“请先在电脑上打开微信”。

### 3.2 延迟 (Latency)

* **镜像延迟:** 桌面收到微信消息 -> 手机 Neural Link 收到推送，延迟 < 2秒。
* **操作延迟:** 手机点击发送 -> 电脑完成粘贴发送，延迟 < 3秒。

---

## 4. 商业模式修正

* **Pro 版权益更新:**
* **Starter (Free):** 仅支持文件管理、Shell 基础命令。**不支持** 社交桥接（因为开发适配成本高）。
* **Pro ($19/mo):** 解锁 **"Social Bridge"** 插件，支持微信/Slack 的 AI 托管与远程控制。