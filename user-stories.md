
# 📝 深度验收标准 (Advanced Acceptance Criteria) - BDD 格式

## 🕹️ Epic 2: 核心交互 A - 代理草稿 (Draft & Verify)

这个功能最怕的是：用户以为发了但没发，或者 AI 还没准备好用户就点了。

### Story: US-201 指令转草稿

**As a** 用户
**I want to** 看到 AI 生成的草稿和附件
**So that** 我能确认无误后发送

#### ✅ Scenario 1: 快乐路径 (Happy Path) - 文件存在

* **Given** 用户手机端与电脑端 WebSocket 连接正常
* **And** 电脑桌面上存在文件 `Q3_Report.pdf`
* **When** 用户输入指令 “把 Q3 报表发出来”
* **Then** [电脑端] 应在 2秒内上传文件并返回 `file_url`
* **And** [手机端] 输入框应自动填充文案 “这是 Q3 报表...”
* **And** [手机端] 输入框下方应挂载 `[附件: Q3_Report.pdf]` 卡片
* **And** [状态] 发送按钮应处于 **可用 (Active)** 状态，但**不自动触发**。

#### ⚠️ Scenario 2: 异常路径 - 文件未找到 (File Not Found)

* **Given** 电脑桌面上**不**存在 `Q3_Report.pdf`
* **When** 用户输入指令 “把 Q3 报表发出来”
* **Then** [电脑端] 返回错误码 `ERR_FILE_NOT_FOUND`
* **And** [手机端] **不**填充草稿
* **And** [手机端] Bot 应回复一条仅用户可见的消息 (Ephemeral Message): “🚫 在桌面上没找到‘Q3 报表’，是否需要我运行全盘搜索？”

#### ⚠️ Scenario 3: 异常路径 - 电脑离线 (Desktop Offline)

* **Given** 电脑端未运行或断网
* **When** 用户输入指令
* **Then** [手机端] 立即弹出 Toast 提示：“无法连接到电脑 (Ghost Offline)”
* **And** 建议用户：“是否通过云端短信唤醒？”（预留功能）

---

## 🔮 Epic 3: 核心交互 B - 行为预判 (Predictive Actions)

这个功能最怕的是：乱推荐（False Positive），或者推荐了用户不敢点的命令（如 `rm -rf`）。

### Story: US-301 错误修复建议

**As a** 开发者
**I want to** 一键执行修复命令
**So that** 我不需要手动敲代码

#### ✅ Scenario 1: 高置信度推荐

* **Given** 用户刚刚运行的脚本报错 `ModuleNotFoundError: No module named 'numpy'`
* **And** 云端预测模型判断“安装 numpy”的置信度 > 90%
* **When** Bot 推送错误日志
* **Then** 日志下方应紧贴一个 Action Card: `[ 🛠️ 修复: pip install numpy ]`
* **And** 卡片背景色应为**绿色**（表示安全操作）。

#### 🛑 Scenario 2: 高危操作拦截 (Safety Net)

* **Given** 用户运行脚本报错，AI 判断需要清理缓存
* **And** 预测生成的命令包含 `rm -rf /` 或敏感路径
* **When** Bot 准备推送建议
* **Then** 系统应**强制拦截**该建议，不予显示
* **Or** 显示为红色高危卡片，并标记 `[需要 FaceID]`。

---

## 🤫 Epic 4: 核心交互 C - 耳语建议 (The Whisper)

这个功能最怕的是：卡顿。如果气泡 3秒后才出来，用户早就自己打完字了。

### Story: US-401 实时气泡生成

**As a** 社交用户
**I want to** 毫秒级看到回复建议
**So that** 交流不中断

#### ⚡ Scenario 1: 性能阈值 (Performance SLA)

* **Given** 用户收到一条新消息
* **When** 消息到达手机端
* **Then** 云端必须在 **800ms** 内返回 `suggestion_chips` 数据
* **If** 超过 1000ms 未返回
* **Then** 客户端应**放弃**显示气泡（宁缺毋滥，防止UI跳变）。

#### 🔄 Scenario 2: 动态更新

* **Given** 气泡已显示 `[拒绝]` `[答应]`
* **When** 用户开始自己在输入框打字（如输入了 “我没空”）
* **Then** 气泡应**立即消失**，以免遮挡视线或造成困扰。

---

## 🛠️ 技术类故事 (Technical Stories) - 给后端的任务

为了支撑上述体验，后端必须完成以下基建：

1. **[Tech] WebSocket 心跳保活机制**
* **AC:** 实现 Ping/Pong 机制，每 30s 检测一次。若 3次未响应，标记设备为 `Offline` 并推送给手机端。


2. **[Tech] 差异化鉴权系统 (Scope Guard)**
* **AC:** 区分 `Read-Only Token` (手机端) 和 `Full-Access Token` (桌面端)。手机端发起的 `EXEC_SHELL` 指令必须携带 `user_confirm_signature`。


3. **[Tech] 预测模型延迟优化**
* **AC:** 引入 `Groq` 或 `vLLM` 推理加速，确保 Action Card 生成耗时 < 500ms。


