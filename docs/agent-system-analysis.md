# NoteGen Agent 系统架构分析报告

> 生成日期：2026-06-03
> 基于分支：`feature/source-mode-switch`

---

## 目录

1. [系统总览](#1-系统总览)
2. [模块清单与文件地图](#2-模块清单与文件地图)
3. [核心流程：从输入到执行](#3-核心流程从输入到执行)
4. [ReActAgent 核心类详解](#4-reactagent-核心类详解)
5. [AgentHandler 连接层](#5-agenthandler-连接层)
6. [Chat UI 入口层](#6-chat-ui-入口层)
7. [工具系统](#7-工具系统)
8. [工具策略与权限控制](#8-工具策略与权限控制)
9. [Skill 技能系统](#9-skill-技能系统)
10. [MCP 协议集成](#10-mcp-协议集成)
11. [AI 模型交互层](#11-ai-模型交互层)
12. [上下文与记忆系统](#12-上下文与记忆系统)
13. [JSON 解析与修复](#13-json-解析与修复)
14. [事件通信系统](#14-事件通信系统)
15. [类型定义](#15-类型定义)
16. [数据流全景图](#16-数据流全景图)

---

## 1. 系统总览

NoteGen 的 Agent 系统采用 **文本格式的 ReAct（Reason + Act）循环**，而非 OpenAI 原生 Function Calling API。整个系统的设计原则是：

- **模型无关**：通过 OpenAI 兼容 API 接口，支持 GPT、Claude、千问、DeepSeek、MiniMax、GLM 等任意模型
- **文本解析驱动**：LLM 按照固定的文本格式（`Thought → Action → Action Input` 或 `Thought → Final Answer`）输出，Agent 通过正则解析提取工具调用
- **意图感知的安全策略**：根据用户输入推导写入/删除/执行意图，自动控制工具的可用范围
- **Skill 扩展体系**：通过 zip 包导入的技能模块，可以扩展 Agent 的能力（模板、脚本执行等）
- **MCP 协议支持**：通过 Model Context Protocol 接入外部工具服务器

### 一句话概括

当你在 AI 对话框中输入内容并发送时：

> **Chat UI** (`chat-send.tsx`) → **AgentHandler** (`agent-handler.ts`) → **ReActAgent** (`react.ts`) 的 `run()` 循环 → 每次迭代调用 **`think()`** 通过 `fetchAiStream` 与你配置的大模型交互 → 解析 LLM 返回的文本提取工具调用 → 执行对应工具 → 将工具结果作为 Observation 反馈给 LLM → 进入下一轮迭代 → 直到 LLM 输出 `Final Answer` 结束。

---

## 2. 模块清单与文件地图

### Agent 核心（`src/lib/agent/`）

| 文件 | 行数 | 职责 |
|------|------|------|
| `react.ts` | ~2280 | ReAct 循环核心：系统提示构建、LLM 调用、动作解析（6 级）、工具执行、最终答案验证 |
| `agent-handler.ts` | ~282 | Agent 包装层：连接 UI 和 ReActAgent，管理生命周期、回调注入 |
| `types.ts` | ~97 | 所有类型定义（Tool, ToolCall, ToolResult, ReActStep, AgentState 等） |
| `tool-policy.ts` | ~249 | 工具风险评估、意图策略推导、执行权限控制 |
| `parse-action-input.ts` | ~112 | JSON 解析与修复（处理 LLM 输出的不完整 JSON） |
| `auto-final-answer.ts` | ~57 | 自动恢复：当 LLM 在成功执行工具后断流，自动生成最终答案 |
| `react-diff-helpers.ts` | ~121 | 内容差异计算：用于确认对话框展示编辑前后对比 |
| `session-approval.ts` | ~110 | 会话级自动审批：用户点击"本次对话自动批准"后的匹配逻辑 |
| `tool-confirmation-display.ts` | ~121 | 确认对话框的展示配置（字段映射、格式化规则） |
| `i18n.ts` | ~44 | Agent 相关 UI 文本的国际化 |

### Agent 工具（`src/lib/agent/tools/`）

| 文件 | 工具类别 | 工具数量 |
|------|----------|----------|
| `index.ts` | 工具注册中心 | — |
| `note-tools.ts` | 笔记文件操作 | 15 个 |
| `editor-tools.ts` | 编辑器操作 | 4 个 |
| `folder-tools.ts` | 文件夹操作 | 6 个 |
| `system-tools.ts` | 系统工具 | 4 个 |
| `chat-tools.ts` | 对话记录操作 | 9 个 |
| `mark-tools.ts` | 标记/收藏操作 | 11 个 |
| `tag-tools.ts` | 标签操作 | 7 个 |
| `memory-tools.ts` | 记忆操作 | 4 个 |

### Chat UI（`src/app/core/main/chat/`）

| 文件 | 职责 |
|------|------|
| `chat-send.tsx` | 用户输入处理、Agent 调用入口、上下文构建、确认流程 |
| `agent-execution-status.tsx` | Agent 执行状态显示、确认/取消按钮处理 |
| `agent-panel-with-rag.tsx` | RAG 来源展示 + Agent 执行面板 |

### AI 交互层（`src/lib/ai/`）

| 文件 | 职责 |
|------|------|
| `chat.ts` | `fetchAiStream`：流式调用 LLM、处理 SSE、MCP 工具循环 |
| `utils.ts` | AI 配置读取、OpenAI 客户端创建、消息预处理 |
| `tauri-client.ts` | Tauri IPC 封装的 OpenAI 兼容客户端（绕过浏览器 fetch） |
| `index.ts` | 模块统一导出 |
| `sanitize.ts` | `<think>` 块清理（用于 rewrite 等非 Agent 场景） |
| `embedding.ts` | 向量嵌入生成 |

### 其他关键模块

| 文件 | 职责 |
|------|------|
| `src/lib/skills/manager.ts` | Skill 管理器：发现、加载、注册、匹配技能 |
| `src/lib/skills/runtime.ts` | Skill 脚本执行引擎（Python/Bash/JS） |
| `src/lib/mcp/client.ts` | MCP 客户端：stdio/HTTP 传输 |
| `src/lib/mcp/server-manager.ts` | MCP 服务器生命周期管理 |
| `src/lib/mcp/tools.ts` | MCP 工具转换为 Agent 工具格式 |
| `src/lib/context/loader.ts` | 上下文加载器：记忆检索、偏好注入 |
| `src/db/memories.ts` | 记忆数据库（SQLite + 向量嵌入） |
| `src/stores/chat.ts` | 聊天状态管理（Zustand） |
| `src/stores/setting.ts` | AI 模型配置存储 |
| `src/stores/mcp.ts` | MCP 服务器配置存储 |
| `src/stores/skills.ts` | Skill 配置存储 |
| `src/lib/emitter.ts` | 事件总线（mitt），用于组件间通信 |

---

## 3. 核心流程：从输入到执行

下面是你在 AI 对话框中输入内容后，完整的执行流程：

```
用户在 AI 对话框输入文字，点击发送
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  chat-send.tsx: handleSubmit()                      │
│  1. 验证输入非空                                     │
│  2. 创建 user 角色消息记录存入 DB                    │
│  3. 调用 handleAgentMode(imageUrls)                 │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  chat-send.tsx: handleAgentMode()                   │
│  1. 创建 system 角色占位消息（用于后续填充 AI 回复）  │
│  2. 构建上下文 context:                              │
│     - 当前打开的笔记文件内容                         │
│     - RAG 检索结果（如果启用）                       │
│     - 关联文件内容（如果有附加文件）                  │
│     - 引用文本的编辑指令（如果有选中内容）            │
│  3. 构建对话历史 messages（含消息压缩处理）          │
│  4. 创建 AgentHandler 并调用 execute()               │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  agent-handler.ts: AgentHandler.execute()           │
│  1. 重置 agentState                                 │
│  2. 初始化 MCP（加载 MCP 工具到工具注册表）          │
│  3. 获取可用 Skills 列表                            │
│  4. 构建 ReActConfig（注入所有回调函数）             │
│  5. 创建 ReActAgent 实例并调用 run()                │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  react.ts: ReActAgent.run()                         │
│  初始化: 重置步骤、迭代计数、推导意图策略             │
│                                                     │
│  while (迭代次数 < 15):                              │
│    ┌──────────────────────────────────────────────┐  │
│    │ 1. buildSystemPrompt()                      │  │
│    │    构建系统提示词（工具描述+Skill+策略+记忆）│  │
│    │                                              │  │
│    │ 2. think()                                   │  │
│    │    调用 fetchAiStream 与 LLM 交互            │  │
│    │    流式接收回复，触发 UI 更新回调             │  │
│    │    返回完整的 LLM 回复文本                    │  │
│    │                                              │  │
│    │ 3. 检查: Final Answer? → 提取并验证 → 结束  │  │
│    │                                              │  │
│    │ 4. parseAction() — 6 级解析                 │  │
│    │    尝试从回复文本中提取工具名和参数            │  │
│    │                                              │  │
│    │ 5. act(toolName, params)                     │  │
│    │    策略检查 → 确认流程 → 执行工具             │  │
│    │    返回 Observation（工具执行结果）            │  │
│    │                                              │  │
│    │ 6. 记录步骤，进入下一轮迭代                   │  │
│    └──────────────────────────────────────────────┘  │
│                                                     │
│  返回 finalAnswer                                    │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  chat-send.tsx: onComplete()                        │
│  1. 收集 agentState.completedSteps                  │
│  2. 清理 Final Answer 中的 ReAct 标记               │
│  3. 更新 DB 中的占位消息为实际 AI 回复              │
│  4. 保存 agentHistory（工具调用记录）                │
│  5. 重置 agentState                                 │
└─────────────────────────────────────────────────────┘
```

---

## 4. ReActAgent 核心类详解

> 文件：`src/lib/agent/react.ts`

### 4.1 构造与初始化

```typescript
export class ReActAgent {
  private config: ReActConfig
  private steps: ReActStep[] = []        // 已完成的迭代步骤
  private currentIteration = 0            // 当前迭代次数
  private toolCallCounter = 0             // 工具调用计数器
  private stopped = false                 // 用户终止标志
  private abortController: AbortController | null = null
  private selectedSkills: Set<string>     // AI 选择的 Skills
  private currentUserInput = ''
  private intentPolicy: IntentPolicy      // 从用户输入推导的意图策略
}
```

### 4.2 `run()` 方法 — 主循环（第 246-469 行）

`run(userInput, contextOrMessages?, imageUrls?)` 是整个 Agent 的入口。

**初始化阶段：**
1. 重置所有状态（steps、iteration、toolCallCounter、stopped）
2. 调用 `deriveIntentPolicy(userInput)` 从用户输入中推导意图（是否允许写入/删除/执行）
3. 创建新的 `AbortController` 用于支持中止

**主循环（最多 15 次迭代）：**

每次迭代按以下顺序执行：

1. **终止检查**：如果 `this.stopped === true`，抛出 `'USER_STOPPED'`
2. **迭代通知**：触发 `onIterationStart()` 回调，将上一轮的 UI 状态刷新到 `completedSteps`
3. **构建系统提示**：调用 `buildSystemPrompt()`，每轮都重新构建（因为 Skill 指令依赖迭代次数）
4. **调用 LLM**：`think()` 通过 `fetchAiStream` 与大模型交互，返回完整回复文本
5. **自动恢复检查**：如果 LLM 返回空/错误，且上一步工具执行成功，自动生成最终答案
6. **Final Answer 检测**：检测回复中是否包含 `Final Answer:` / `Final Answer：` / `最终答案`
7. **最终答案验证**：`validateFinalAnswerReadiness()` 确保 LLM 不会在没有真正执行工具的情况下宣称"已完成"
8. **动作解析**：`parseAction()` 从回复文本中提取工具名和参数（6 级解析策略）
9. **重复检测**：如果连续调用相同工具+相同参数，提前终止
10. **工具执行**：`act()` 执行工具，返回 Observation
11. **步骤记录**：将 `{thought, action, observation}` 推入 `this.steps`

**终止条件：**
- LLM 输出了 `Final Answer` 且通过了验证 → 正常结束
- 达到最大迭代次数（15）→ 提示用户
- 用户点击停止 → 抛出 `USER_STOPPED`
- 连续 5 次重复相同操作 → 强制终止
- LLM API 持续失败 → 通过自动恢复生成兜底答案

### 4.3 `buildSystemPrompt()` 方法（第 471-741 行）

每轮迭代都重新构建系统提示词，包含以下部分：

1. **用户记忆**：从 `contextLoader.getContextForQuery('')` 加载用户偏好和知识库记忆
2. **核心指令**：
   - Skill 使用规则（"Skills 不是工具"）
   - 意图判断原则（问问题 vs 请求操作）
   - 知识库搜索指南
   - 笔记/标签/收藏的区别说明
   - 完整的工具描述列表（`getToolDescriptions()`）
3. **Skill 指令**：
   - 第 1 轮迭代：仅发送 Skill 的 `{id, name, description}` 摘要，指示 AI 调用 `select_skill` 选择
   - 第 2+ 轮迭代：如果已选择 Skill，发送完整指令（metadata、allowedTools、脚本列表、instructions 全文）
4. **输出格式规范**：
   - 格式 1：`Thought: → Action: tool_name → Action Input: {json}`
   - 格式 2：`Thought: → Final Answer: 内容`
   - 10+ 条关键规则和反模式示例
5. **运行时工具策略**：`formatIntentPolicyForPrompt()` 输出当前的写入/删除/执行权限状态

### 4.4 `think()` 方法（第 743-948 行）

负责与 LLM 的实际交互。支持两种模式：

**消息数组模式**（新模式，当传入 `messages` 数组时）：
```
[
  { role: 'system', content: systemPrompt },
  ...conversationHistory,             // 历史对话消息
  { role: 'system', content: '## Previous Iterations\n...' },  // 已完成的步骤
  { role: 'user', content: '当前用户请求 + 上一步结果' }
]
```

**字符串拼接模式**（旧模式，向后兼容）：
```
systemPrompt + context + historyContext + userMessage
```

两种模式都：
- 通过 `fetchAiStream` 流式调用 LLM
- 图片仅在第 1 轮迭代发送
- 流式过程中触发 `onThought()` 回调更新 UI
- 检测到 `Final Answer` 时立即触发 `onFinalAnswerRender()` 切换为 Markdown 渲染模式
- 支持 `AbortSignal` 用于中止
- DeepSeek/千问等模型的 `reasoning_content` 字段通过独立回调 `onThinkingUpdate` 处理，不混入正文

### 4.5 `parseAction()` 方法（第 990-1188 行）— 6 级解析

这是 Agent 系统的核心解析引擎。从 LLM 返回的原始文本中提取工具调用。

**预处理**：
- `preprocessThought()`：剥离 `<think>...</think>` 内联思考块 + 外层 markdown 代码栏
- 构建 `knownToolNames` 集合（包括动态注册的 MCP 工具）

**守卫**：先检查 Final Answer 标记，如果包含则返回 `null`

**6 级解析策略（按优先级）：**

| 级别 | 匹配模式 | 适用场景 | 安全校验 |
|------|----------|----------|----------|
| 1 | `Action: tool_name` + `Action Input: {json}` | 标准 ReAct 格式（GPT-4、Claude 等） | 无需（标准格式） |
| 2 | `Action: tool_name\n{json}` | 有 Action 前缀但忘写 Action Input 标签 | 已知工具名 |
| 3 | `动作：/工具：/行动：tool_name` + `{json}` | 中文关键词变体 | 已知工具名 |
| 4 | `tool_name({json})` | 函数调用风格 | 已知工具名 |
| 5 | `tool_name {json}`（行首） | 裸工具名 + JSON | 已知工具名 |
| 6 | `...文字... tool_name {json}`（全文扫描） | 工具调用嵌入在思考文字中（DeepSeek-R1、QwQ） | 已知工具名 |

第 2-6 级都通过 `getAllToolsSync()` 获取的已注册工具名集合校验，普通文本不会触发误匹配。

**JSON 提取增强**：
- `extractJsonFromFence()`：剥离 markdown 代码栏（` ```json ... ``` `）
- `extractJsonObject()`：大括号计数法定位 JSON 边界
- 千问 `<|begin_of_box|>` / `<|end_of_box|>` 标记符号剥离
- `parseActionInputJson()`：两级 JSON 修复（转义修复 + 闭合修复）

### 4.6 `act()` 方法（第 1239-1580 行）

执行工具调用的完整流程：

```
act(toolName, params, thought)
    │
    ├── 1. getToolByName(toolName) — 查找工具
    │
    ├── 2. normalizeToolParams(toolName, params) — 参数标准化
    │       ├── create_file: Skill 脚本路径重写
    │       └── replace_editor_content: 引用文本坐标注入
    │
    ├── 3. evaluateToolPolicy(toolName, tool, params)
    │       ├── 检查冗余读取（已在上下文中的文件）
    │       ├── 检查重复探索（已执行过的 batch read）
    │       ├── 检查关联笔记聚焦（防止偏离到无关工具）
    │       └── evaluateIntentAwareToolPolicy() — 意图策略评估
    │
    ├── 4. 被策略阻止? → 返回策略调整消息作为 Observation
    │
    ├── 5. 需要确认?
    │       ├── 查找是否有 Skill 授权（isToolAuthorized）
    │       ├── 构建确认上下文（删除文件列表、编辑差异预览等）
    │       ├── 调用 requestConfirmation() → UI 弹出确认框
    │       └── 用户取消? → 返回 '用户取消了操作'
    │
    └── 6. tool.execute(params) — 执行工具
            ├── 成功 → 格式化结果返回
            │     ├── select_skill: 更新 selectedSkills
            │     └── MCP 工具: formatMcpResult()
            └── 失败 → 返回错误信息
                  └── replace_editor_content 找不到文本:
                      附加重试指导信息
```

### 4.7 `validateFinalAnswerReadiness()` 方法（第 2237-2278 行）

防止 LLM "幻觉式完成"——声称已完成任务但实际上没有执行任何工具。

四重验证：

1. **创建/生成幻觉检测**：用户要求创建文件/文档 + AI 声称"已生成/已创建" + 实际没有成功执行过 `create_file` 等工具 → 拒绝，要求继续执行
2. **Skill 执行幻觉检测**：已选择 Skill + AI 声称"已完成" + 没有实际工具执行 → 拒绝
3. **验证幻觉检测**：AI 声称"验证通过" + 没有实际执行结果 → 拒绝
4. **编辑幻觉检测**：用户要求修改/编辑 + AI 声称"已修改/已更新" + 没有成功的写入工具执行 → 拒绝

辅助判断函数：
- `hasSubstantiveSuccessfulAction()`：是否有非辅助性工具（排除 `select_skill`/`load_skill_content`）成功执行
- `hasSuccessfulMutationAction()`：是否有写入类工具（`create_`/`update_`/`delete_`/`replace_editor_content` 等）成功执行

---

## 5. AgentHandler 连接层

> 文件：`src/lib/agent/agent-handler.ts`

AgentHandler 是 **UI 层**和 **ReActAgent 核心**之间的桥梁。

### 5.1 `execute()` 方法（第 37-213 行）

```typescript
async execute(userInput: string, messages: Messages[], imageUrls?: string[])
```

执行流程：
1. **重置状态**：清空 `agentState`，设置 `isRunning: true`
2. **加载 MCP 工具**：调用 `reloadMcpTools()` 确保最新的 MCP 工具已注册
3. **获取可用 Skills**：从 `skillManager.getEnabledSkills()` 获取已启用的 Skill 列表
4. **构建回调配置**：
   - `onIterationStart`：将当前 UI 状态（thought/action/observation）刷新到 `completedSteps`
   - `onThought`：更新 `agentState.currentThought`，用于流式展示
   - `onAction`：更新 `agentState.currentAction`
   - `onObservation`：更新 `agentState.currentObservation`
   - `onToolCall`：插入/更新 `agentState.toolCalls`
   - `onSkillsSelected`：更新 `agentState.selectedSkills`
   - `onFinalAnswerRender`：触发 Markdown 渲染模式
5. **创建并运行 Agent**：`new ReActAgent(config).run(userInput, messages, imageUrls)`
6. **结果处理**：
   - 正常完成：收集步骤，调用 `onComplete(result, steps, false)`
   - 用户终止：调用 `onComplete('', steps, true)`
   - 错误：调用 `onError(message)` 并重新抛出

### 5.2 `stop()` 方法

调用 `agent.stop()` → 设置 `stopped = true` + 中止 `AbortController` → `fetchAiStream` 的 SSE 循环被打断 → `think()` 返回终止消息 → `run()` 抛出 `USER_STOPPED` → Handler 的 catch 块处理清理。

---

## 6. Chat UI 入口层

> 文件：`src/app/core/main/chat/chat-send.tsx`

### 6.1 `handleSubmit()` — 用户发送消息入口（第 567-584 行）

```
验证输入非空 → 设置 loading: true → 创建 user 消息记录 → handleAgentMode(imageUrls)
```

**注意**：没有"普通聊天模式"——所有消息都走 Agent 模式。

### 6.2 `handleAgentMode()` — 核心处理（第 217-563 行）

**上下文构建**（这是 Agent 获得的全部外部信息）：

1. **当前编辑器文件**（第 366-369 行）：
   ```
   ## 用户当前打开的笔记
   文件路径：{path}
   内容：
   {完整文件内容}
   ```

2. **RAG 检索**（第 373-420 行）：
   - 调用 Tauri 的 `rank_keywords` 命令（TextRank 算法提取 Top 15 关键词）
   - 过滤停用词
   - 调用 `getContextForQuery(keywords)` 或 `getContextForQueryInFolder(keywords, folderPath)` 进行混合检索
   - 检索结果格式化后注入上下文

3. **关联文件**（第 432-454 行）：
   - 如果用户附加了文件（linkedResource），通过 `readTextFile` 读取完整内容
   - 附加到上下文中

4. **引用文本编辑指令**（第 456-533 行）：
   - 如果用户选中了文本（quoteData），注入详细的行号/位置/编辑约束信息

**对话历史构建**（第 537-555 行）：
- 调用 `buildMessagesWithHistory()` 构建结构化的消息数组
- 不传 `systemPrompt`（Agent 自己构建系统提示）
- `maxUserMessages: 0`（普通情况）或 `3`（连续对话情况）

### 6.3 `requestConfirmation()` — 确认流程（第 160-213 行）

当 Agent 需要执行需确认的工具时：

```
判断会话级自动审批是否匹配?
    │
    ├── 是 → 直接返回 Promise<true>（跳过 UI）
    │
    └── 否 → 设置 agentState.pendingConfirmation
             ↓
         UI 显示确认对话框
             ↓
         100ms 轮询等待 pendingConfirmation 被清除
             │
             ├── 用户点击确认 → isRunning=true → Promise<true>
             └── 用户点击取消 → isRunning=false → Promise<false>
```

### 6.4 确认 UI 组件

**`agent-execution-status.tsx`**（第 19-65 行）：

- `handleConfirm(scope)`:
  - `scope === 'conversation'` → 设置 `agentAutoApproveConversationId`，后续同类操作自动批准
  - 清除 `pendingConfirmation`，设置 `isRunning: true` → 解除轮询阻塞
- `handleCancel()`:
  - 清除 `pendingConfirmation`，设置 `isRunning: false` → 工具调用被取消

---

## 7. 工具系统

> 文件：`src/lib/agent/tools/`

### 7.1 工具注册中心（`index.ts`）

```typescript
// 静态工具列表：合并所有工具模块
const allTools: Tool[] = [...noteTools, ...editorTools, ...folderTools,
  ...systemTools, ...chatTools, ...markTools, ...tagTools, ...memoryTools]

// MCP 工具缓存
let mcpToolsCache: Tool[] = []

// 同步获取所有工具（含已缓存的 MCP 工具）
function getAllToolsSync(): Tool[]

// 异步获取所有工具（会重新加载 MCP 工具）
async function getAllToolsAsync(): Promise<Tool[]>

// 按名称查找工具
function getToolByName(name: string): Tool | undefined

// 生成工具描述文本（用于系统提示词）
function getToolDescriptions(): string
```

**MCP 工具转换**（`convertMcpToolToAgentTool`，第 28-71 行）：
- 命名格式：`${serverId}__${toolName}`（双下划线分隔）
- `requiresConfirmation: false`，`category: 'mcp'`
- `execute()` 调用 `callTool(serverId, toolName, params)`

### 7.2 完整工具清单

#### 笔记文件工具（`note-tools.ts`，category: `'note'`）

| 工具名 | 需确认 | 用途 | 关键参数 |
|--------|--------|------|----------|
| `list_markdown_files` | ❌ | 列出所有笔记文件 | — |
| `read_markdown_file` | ❌ | 读取单个笔记 | `filePath` |
| `create_file` | ✅ | 创建新文件 | `fileName`, `content`, `folderPath?` |
| `update_markdown_file` | ✅ | 更新笔记内容 | `filePath`, `content`, `expectedModifiedAt?` |
| `delete_markdown_file` | ✅ | 删除笔记 | `filePath` |
| `search_markdown_files` | ❌ | 搜索笔记 | `query`, `mode?`(keyword/rag), `folderPath?` |
| `read_markdown_files_batch` | ❌ | 批量读取笔记 | `filePaths[]` |
| `delete_markdown_files_batch` | ✅ | 批量删除笔记 | `filePaths[]` |
| `list_markdown_files_by_date` | ❌ | 按日期筛选笔记 | `lastNDays?`, `startDate?`, `endDate?` |
| `rename_file` | ✅ | 重命名文件 | `filePath`, `newName` |
| `move_file` | ✅ | 移动文件 | `filePath`, `targetFolderPath` |
| `copy_file` | ✅ | 复制文件 | `filePath`, `targetFolderPath?`, `newName?` |
| `rename_files_batch` | ✅ | 批量重命名 | `files[]` |
| `move_files_batch` | ✅ | 批量移动 | `files[]` |
| `copy_files_batch` | ✅ | 批量复制 | `files[]` |

**特殊逻辑**：`read_markdown_file` 内置去重检查——如果请求的文件已在 `linkedResource` 上下文中，直接返回"已在上下文中"避免重复读取。

#### 编辑器工具（`editor-tools.ts`，category: `'editor'`）

| 工具名 | 需确认 | 用途 | 关键参数 |
|--------|--------|------|----------|
| `get_editor_selection` | ❌ | 获取选中文本 | — |
| `get_editor_content` | ❌ | 获取编辑器全文 | — |
| `insert_at_cursor` | ❌ | 在光标处插入 | `content`, `replaceSelection?` |
| `replace_editor_content` | ❌ | 替换编辑器内容 | `startLine/endLine`, `searchContent`, `from/to`, `content`, `version?` |

**通信机制**：编辑器工具通过 `emitter.emit()` 发送事件，Tiptap 编辑器组件监听并响应。超时 200ms 后回退到 Zustand store 直接操作。

#### 文件夹工具（`folder-tools.ts`，category: `'note'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `check_folder_exists` | ❌ | 检查文件夹是否存在 |
| `create_folder` | ❌ | 创建文件夹 |
| `delete_folder` | ✅ | 删除文件夹 |
| `list_folders` | ❌ | 列出文件夹 |
| `create_folders_batch` | ❌ | 批量创建文件夹 |
| `delete_folders_batch` | ✅ | 批量删除文件夹 |

#### 系统工具（`system-tools.ts`，category: `'system'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `get_current_time` | ❌ | 获取当前时间 |
| `select_skill` | ❌ | 选择要使用的 Skill |
| `load_skill_content` | ❌ | 加载 Skill 的内容文件 |
| `execute_skill_script` | ❌* | 执行 Skill 脚本（Python/Bash/JS） |

\* `execute_skill_script` 在工具定义层 `requiresConfirmation: false`，但在 `tool-policy.ts` 中被归为 `HIGH_RISK_TOOLS`，因此实际会触发确认流程。

#### 对话工具（`chat-tools.ts`，category: `'chat'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `read_chats` | ❌ | 读取对话记录 |
| `create_chat` | ❌ | 创建对话 |
| `update_chat` | ❌ | 更新对话 |
| `delete_chat` | ✅ | 删除对话 |
| `clear_chats` | ✅ | 清空所有对话 |
| `search_chats` | ❌ | 搜索对话 |
| `create_chats_batch` | ❌ | 批量创建 |
| `update_chats_batch` | ❌ | 批量更新 |
| `delete_chats_batch` | ✅ | 批量删除 |

#### 标记工具（`mark-tools.ts`，category: `'mark'`/`'search'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `read_marks` | ❌ | 读取收藏 |
| `create_mark` | ❌ | 创建收藏 |
| `update_mark` | ❌ | 更新收藏 |
| `delete_mark` | ✅ | 删除收藏 |
| `restore_mark` | ❌ | 恢复收藏 |
| `search_marks` | ❌ | 搜索当前分类收藏 |
| `search_all_marks` | ❌ | 搜索全部收藏 |
| `create_marks_batch` | ❌ | 批量创建 |
| `update_marks_batch` | ❌ | 批量更新 |
| `delete_marks_batch` | ✅ | 批量删除 |
| `restore_marks_batch` | ❌ | 批量恢复 |

#### 标签工具（`tag-tools.ts`，category: `'tag'`/`'search'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `list_tags` | ❌ | 列出标签 |
| `create_tag` | ❌ | 创建标签 |
| `update_tag` | ❌ | 更新标签 |
| `delete_tag` | ✅ | 删除标签 |
| `search_tags` | ❌ | 搜索标签 |
| `create_tags_batch` | ❌ | 批量创建 |
| `update_tags_batch` | ❌ | 批量更新 |

#### 记忆工具（`memory-tools.ts`，category: `'system'`）

| 工具名 | 需确认 | 用途 |
|--------|--------|------|
| `save_memory` | ❌ | 保存记忆（自动生成向量嵌入） |
| `list_memories` | ❌ | 列出记忆 |
| `delete_memory` | ✅ | 删除记忆 |
| `clear_all_memories` | ✅ | 清空所有记忆 |

---

## 8. 工具策略与权限控制

> 文件：`src/lib/agent/tool-policy.ts`

### 8.1 风险等级分类

| 等级 | 工具集合 | 行为 |
|------|----------|------|
| **HIGH** | `execute_skill_script`, 所有 `delete_*`, `clear_*` | 始终需要确认 |
| **MEDIUM** | 所有 `create_*`, `update_*`, `rename_*`, `move_*`, `copy_*`, 编辑器写入工具 | 需要确认（除非被 Skill 授权） |
| **LOW** | `select_skill`, `load_skill_content`, 所有 `get_*`, `check_*`, `list_*`, `read_*` | 自动执行 |

### 8.2 意图策略推导 — `deriveIntentPolicy()`（第 75-131 行）

从用户输入文本中匹配关键词，推导三个维度的权限：

| 维度 | 中文匹配模式 | 英文匹配模式 | 否定模式 |
|------|-------------|-------------|----------|
| `allowWrite` | 创建、新建、写入、修改、编辑、更新... | create, write, modify, edit, update... | — |
| `allowDestructive` | 删除、移除、清空、清除 | delete, remove, clear, wipe, purge | 不要删除、别删除... |
| `allowExecute` | 执行、运行、命令、脚本... | run, execute, command, script... | 不要执行、别执行... |

### 8.3 意图感知策略评估 — `evaluateIntentAwareToolPolicy()`（第 200-243 行）

```
输入: { toolName, category, intentPolicy }

如果工具是执行类 && 用户未明确要求执行 → 阻止
如果工具是破坏类 && 用户未明确要求删除 → 阻止
如果工具是中风险 → 允许但需确认
如果工具是高风险（非破坏/非执行）&& 用户无写入意图 → 阻止
其他 → 允许，高风险需确认
```

### 8.4 会话级自动审批（`session-approval.ts`）

用户在确认对话框中点击"本次对话自动批准"后：
- 可恢复的写入工具（`create_file`、`update_mark` 等）→ 设置 `scope: 'write'`，后续同类操作自动通过
- `execute_skill_script` + 运行时脚本 → 设置 `scope: 'runtime-script-skill'`，按 Skill ID 限定
- 破坏性操作（`delete_*`）→ 不支持自动审批，每次都需确认

---

## 9. Skill 技能系统

> 文件：`src/lib/skills/`

### 9.1 Skill 结构

每个 Skill 是一个目录，结构如下：

```
skills/
  my-skill/
    SKILL.md          # 主文件（YAML frontmatter + Markdown 指令）
    scripts/          # 可执行脚本（Python/Bash/JS）
    references/       # 参考文档（.md）
    assets/           # 模板/数据/图片
    *.md              # 其他根级文档
```

### 9.2 SKILL.md Metadata 格式

```yaml
---
name: my-skill              # 必需，kebab-case
description: 描述文字        # 必需，用于 AI 匹配
allowedTools:               # 该 Skill 预授权的工具列表
  - create_file
  - execute_skill_script
userInvocable: true         # 是否在斜杠命令菜单中显示
scope: global               # global | project
enabled: true
version: 1.0.0
---

# Skill 指令内容（Markdown）
...
```

### 9.3 Skill 在 Agent 中的工作流

```
第 1 轮迭代:
  系统提示包含所有已启用 Skill 的摘要 {id, name, description}
  AI 根据用户意图选择合适的 Skill:
    Action: select_skill
    Action Input: {"skill_ids": ["my-skill"]}

第 2+ 轮迭代:
  系统提示包含已选 Skill 的完整指令:
    - metadata（版本、作者、allowedTools）
    - 可用脚本列表
    - 完整 instructions（Markdown 内容）

  AI 可以:
    - 调用 load_skill_content 加载参考文档
    - 调用 create_file 创建文件（如果在 allowedTools 中则自动批准）
    - 调用 execute_skill_script 执行脚本
```

### 9.4 脚本执行（`runtime.ts`）

`executeSkillRuntime()` 的执行流程：

1. 解析 `SkillRuntimeContext`（Skill 目录、运行时目录、输出目录）
2. 命令标准化（`python` → `python3`，`pip` → `python -m pip`）
3. 路径标准化（区分内置脚本/运行时脚本/输出文件）
4. 设置环境变量（`SKILL_OUTPUT_DIR`, `SKILL_RUNTIME_DIR`, `SKILL_ROOT_DIR`）
5. 通过 Tauri `Command.create('bash', ['-c', shellCommand])` 执行
6. 失败时自动安装缺失依赖（`ensureDependencyForCommand()`）并重试
7. 收集输出文件，移动到 `outputs/{skillId}/` 目录
8. 在文件树中注册输出文件

---

## 10. MCP 协议集成

> 文件：`src/lib/mcp/`

### 10.1 MCP 服务器配置

```typescript
interface MCPServerConfig {
  type: 'stdio' | 'http'
  command?: string      // stdio: 启动命令（如 'npx')
  args?: string[]       // stdio: 命令参数
  env?: Record<string, string>
  url?: string          // http: 服务器 URL
  headers?: Record<string, string>
  enabled: boolean
}
```

### 10.2 通信流程

**stdio 模式**（通过 Tauri Rust 后端）：

```
MCPClient.connect()
    → Tauri invoke 'start_mcp_stdio_server' (command, args, env)
    → Rust 启动子进程

MCPClient.callTool(name, args)
    → Tauri invoke 'send_mcp_message' (serverId, JSON-RPC request)
    → Rust 通过 stdin/stdout 与子进程通信
    → 返回 JSON-RPC response
```

**HTTP 模式**（直接 HTTP POST）：

```
MCPClient.callTool(name, args)
    → POST url, body: JSON-RPC request
    → 支持 JSON 和 SSE 响应格式
```

### 10.3 MCP 工具在 Agent 中的使用

```
应用启动 → initMcp() → 连接已启用的 MCP 服务器 → 获取工具列表
    ↓
Agent 启动 → reloadMcpTools() → MCP 工具转换为 Agent 工具格式
    ↓
MCP 工具名: serverId__toolName（双下划线分隔）
MCP 工具 category: 'mcp'
MCP 工具 requiresConfirmation: false
    ↓
Agent 调用 MCP 工具 → callTool(serverId, toolName, args)
    → MCPServerManager → MCPClient → JSON-RPC
```

---

## 11. AI 模型交互层

> 文件：`src/lib/ai/`

### 11.1 AI 配置结构

```typescript
interface AiConfig {
  key: string           // 提供商标识（'chatgpt', 'deepseek', 'qwen', ...）
  title: string         // 显示名称
  apiKey?: string       // API 密钥
  baseURL?: string      // API 基础 URL（兼容 OpenAI 格式的任意端点）
  customHeaders?: Record<string, string>
  models?: ModelConfig[]  // 多模型配置
  temperature?: number
  topP?: number
}

interface ModelConfig {
  id: string            // 模型标识
  model: string         // 实际发送给 API 的模型名
  modelType: 'chat' | 'embedding' | 'tts' | 'stt' | 'rerank'
  temperature?: number
  topP?: number
}
```

配置持久化在 Tauri `store.json` 中，通过 `src/stores/setting.ts` 的 Zustand store 管理。

### 11.2 模型配置层次

```
store.json
  ├── aiModelList: AiConfig[]           # 所有已配置的 AI 提供商
  ├── primaryModel: string              # 主对话模型 ID
  ├── embeddingModel: string            # 嵌入模型 ID
  ├── condenseModel: string             # 消息压缩模型 ID
  ├── commitModel: string               # Git commit 生成模型 ID
  ├── ...其他专用模型 ID
  └── 解析流程:
      getAISettings(modelType?)
        → 在 aiModelList 中查找 primaryModel 对应的 AiConfig
        → 提取 apiKey, baseURL, model, temperature, topP
        → 返回给 OpenAI 兼容客户端
```

### 11.3 `fetchAiStream()` — 流式调用 LLM（`chat.ts`）

这是 Agent 系统与大模型交互的底层函数。

```typescript
async function fetchAiStream(
  prompt: string,              // 文本提示（旧模式）或空字符串（消息模式）
  onUpdate: (content: string) => void,
  abortSignal?: AbortSignal,
  chatId?: number,
  systemPromptOverride?: string,
  onThinkingUpdate?: (thinking: string) => void,
  imageUrls?: string[],
  messagesOverride?: Message[]  // 消息数组（新模式）
)
```

**请求构建**：
1. 调用 `getAISettings()` 获取模型配置
2. 调用 `createOpenAIClient()` 创建 Tauri IPC 封装的 OpenAI 客户端
3. 调用 `prepareMessages()` 组装消息数组
4. 构建请求：`{ model, messages, temperature, top_p, stream: true }`

**流式接收**：
```
for await (chunk of stream) {
  检查 abort →
  提取 delta.reasoning_content → onThinkingUpdate()   // DeepSeek/千问思考内容
  提取 delta.content → 累积到 fullContent → onUpdate() // 正文内容
  提取 delta.tool_calls → 累积到 toolCalls[]           // MCP 原生工具调用
}
```

**关键行为**：
- `reasoning_content`（DeepSeek/千问的思考字段）和 `content` 完全分离，思考内容不会进入 Agent 的动作解析
- 如果模型通过 `<think>...</think>` 标签在 content 中内联思考，则由 `parseAction()` 的 `preprocessThought()` 处理
- 图片通过 Base64 编码嵌入消息的 `content` 数组

### 11.4 Tauri IPC 客户端（`tauri-client.ts`）

NoteGen 不使用浏览器的 `fetch` API 调用 AI 模型，而是通过 **Tauri IPC** 路由到 Rust 后端：

```
前端 → invoke('ai_chat_completion_stream', {request, onEvent: Channel})
    → Rust HTTP 客户端发送请求到 AI API
    → SSE 事件通过 Channel 回传到前端
    → AsyncQueue<ChatCompletionChunk> 提供异步迭代器

取消: invoke('cancel_ai_request', {requestId})
```

这样做的好处：
- 绕过浏览器的 CORS 限制
- 支持自定义证书和代理
- API Key 不暴露在前端 DevTools 中

---

## 12. 上下文与记忆系统

### 12.1 上下文加载器（`src/lib/context/loader.ts`）

`ContextLoader` 单例，提供 `getContextForQuery(query)` 方法：

1. 从 SQLite `memories` 表加载所有记忆
2. 分为 `preference`（用户偏好，始终包含）和 `memory`（知识记忆）两类
3. 对 query 计算向量嵌入
4. 余弦相似度 ≥ 0.7 的记忆被选中
5. 结果缓存 5 分钟

### 12.2 记忆数据库（`src/db/memories.ts`）

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  content TEXT,
  embedding TEXT,         -- JSON float array（向量嵌入）
  category TEXT,          -- 'preference' | 'memory'
  access_count INTEGER,
  last_accessed_at TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

**去重机制**：`upsertMemory()` 在插入前计算余弦相似度，阈值 0.85 以上视为重复，更新而非新建。

**自动分类**：`categorizeMemory()` 通过关键词匹配自动分类（"中文"、"格式"、"风格"等 → `preference`）。

### 12.3 记忆注入流程

```
Agent 启动
  ↓
buildSystemPrompt()
  ↓
contextLoader.getContextForQuery('')
  ↓
加载所有记忆 → 筛选偏好 + 相似记忆
  ↓
注入系统提示:
  ## 用户偏好
  - 偏好 1
  - 偏好 2

  ## 相关记忆
  - 记忆 1
  - 记忆 2
```

---

## 13. JSON 解析与修复

> 文件：`src/lib/agent/parse-action-input.ts`

LLM 输出的 JSON 经常不完整或格式有误。系统提供两级修复：

### 13.1 `parseActionInputJson()` — 主入口（第 100-112 行）

```
第 1 次尝试: JSON.parse(raw)
    成功 → 返回
    失败 ↓
修复管线: escapeLiteralNewlinesInStrings → closeJsonStructures → JSON.parse
    成功 → 返回
    失败 → 返回 null
```

### 13.2 `escapeLiteralNewlinesInStrings()`（第 58-98 行）

逐字符扫描，在字符串值内部将裸 `\n` 替换为 `\\n`，裸 `\r` 替换为 `\\r`。正确处理转义引号。

### 13.3 `closeJsonStructures()`（第 1-56 行）

使用栈追踪未闭合的 `{`、`[`、`"`，在字符串末尾自动补全。处理流式 LLM 输出被截断的情况。

---

## 14. 事件通信系统

> 文件：`src/lib/emitter.ts`

基于 `mitt` 库的事件总线，用于 Agent 工具与 UI 组件之间的通信。

### Agent 相关的关键事件

| 事件名 | 载荷 | 用途 |
|--------|------|------|
| `editor-get-selection` | `{resolve: fn}` | Agent 获取编辑器选中文本 |
| `editor-get-content` | `{resolve: fn}` | Agent 获取编辑器全文 |
| `editor-insert` | `{content, resolve: fn}` | Agent 在光标处插入文本 |
| `editor-replace` | `{content, range, resolve: fn}` | Agent 替换编辑器内容 |
| `editor-undo` / `editor-redo` | void | Agent 触发撤销/重做 |
| `editor-ai-streaming` | `{isStreaming, targetFilePath, terminate}` | 通知 UI 正在 AI 流式编辑 |

**编辑器工具通信模式**：
```
Agent 工具 emitter.emit('editor-get-content', { resolve })
    ↓
Tiptap 编辑器组件监听 → 调用 resolve(content)
    ↓
Agent 工具收到 Promise resolve → 返回给 Agent
    ↓
（超时 200ms 未响应 → 回退到 Zustand store 直接读取）
```

---

## 15. 类型定义

> 文件：`src/lib/agent/types.ts`

### 核心类型

```typescript
// 工具定义
interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  requiresConfirmation: boolean
  category: 'note' | 'chat' | 'tag' | 'mark' | 'search' | 'mcp' | 'system' | 'editor'
  execute: (params: Record<string, any>) => Promise<ToolResult>
}

// 工具执行结果
interface ToolResult {
  success: boolean
  data?: any
  error?: string
  message?: string
}

// 工具调用记录（用于 UI 展示）
interface ToolCall {
  id: string
  toolName: string
  params: Record<string, any>
  result?: ToolResult
  status: 'pending' | 'running' | 'success' | 'error'
  timestamp: number
}

// 一次 ReAct 迭代的完整记录
interface ReActStep {
  thought: string
  action?: { tool: string; params: Record<string, any> }
  observation?: string
  duration?: number
}

// Agent 运行状态（存储在 chat store 中，驱动 UI）
interface AgentState {
  isRunning: boolean
  isThinking: boolean
  currentThought: string
  currentAction: string
  currentObservation: string
  completedSteps: ReActStep[]
  toolCalls: ToolCall[]
  maxIterations: number
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
  }
  selectedSkills: string[]
  loadedSkills: { id: string; name: string; description: string }[]
  ragSources?: any[]
  isFinalAnswerMode: boolean
  finalAnswerContent: string
}
```

---

## 16. 数据流全景图

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户输入层                                │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  chat-send.tsx                                           │   │
│  │  用户输入 → handleSubmit() → handleAgentMode()           │   │
│  │                                                           │   │
│  │  上下文构建:                                              │   │
│  │    ├── 当前编辑器文件内容                                 │   │
│  │    ├── RAG 检索结果（TextRank + 混合检索）                │   │
│  │    ├── 关联文件内容                                       │   │
│  │    └── 引用文本编辑指令                                   │   │
│  │                                                           │   │
│  │  对话历史构建:                                            │   │
│  │    └── buildMessagesWithHistory()（含消息压缩）           │   │
│  └────────────────────────┬──────────────────────────────────┘   │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Agent 连接层                              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  agent-handler.ts                                        │   │
│  │  AgentHandler.execute()                                  │   │
│  │    ├── 重置 agentState                                   │   │
│  │    ├── reloadMcpTools() → 加载 MCP 工具                  │   │
│  │    ├── getAvailableSkills() → 获取已启用 Skill            │   │
│  │    ├── 注入回调（onThought/onAction/onObservation/...）  │   │
│  │    └── new ReActAgent(config).run()                       │   │
│  └────────────────────────┬──────────────────────────────────┘   │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                      ReAct 核心循环层                            │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  react.ts: ReActAgent                                    │   │
│  │                                                           │   │
│  │  run() 主循环 (最多 15 轮):                               │   │
│  │    │                                                      │   │
│  │    ├── buildSystemPrompt()                                │   │
│  │    │     ├── 用户记忆（contextLoader）                    │   │
│  │    │     ├── 工具描述（getToolDescriptions）              │   │
│  │    │     ├── Skill 指令（iter 1: 摘要 / iter 2+: 全文）  │   │
│  │    │     └── 意图策略（formatIntentPolicyForPrompt）      │   │
│  │    │                                                      │   │
│  │    ├── think() ──────────────────────┐                    │   │
│  │    │                                 │                    │   │
│  │    │                    ┌─────────────▼──────────────┐    │   │
│  │    │                    │  AI 模型交互层             │    │   │
│  │    │                    │  fetchAiStream()           │    │   │
│  │    │                    │    ├── getAISettings()     │    │   │
│  │    │                    │    ├── createOpenAIClient()│    │   │
│  │    │                    │    ├── prepareMessages()   │    │   │
│  │    │                    │    └── SSE 流式接收        │    │   │
│  │    │                    │         ├── content        │    │   │
│  │    │                    │         ├── reasoning      │    │   │
│  │    │                    │         └── tool_calls     │    │   │
│  │    │                    └─────────────┬──────────────┘    │   │
│  │    │                                 │                    │   │
│  │    ├── LLM 回复 ◄────────────────────┘                   │   │
│  │    │                                                      │   │
│  │    ├── Final Answer? ──→ validateFinalAnswerReadiness()   │   │
│  │    │     └── 验证通过 → break（结束循环）                 │   │
│  │    │                                                      │   │
│  │    ├── parseAction() ──→ 6 级解析                        │   │
│  │    │     ├── L1: Action: + Action Input:（标准）          │   │
│  │    │     ├── L2: Action: tool\n{json}（缺标签）          │   │
│  │    │     ├── L3: 动作：/工具：/行动：（中文）            │   │
│  │    │     ├── L4: tool({json})（函数调用）                 │   │
│  │    │     ├── L5: tool {json}（裸格式，行首）              │   │
│  │    │     └── L6: ...text tool {json}（全文扫描）          │   │
│  │    │                                                      │   │
│  │    └── act(tool, params) ──────────────────────────────┐  │   │
│  │                                                        │  │   │
│  │         ┌──────────────────────────────────────────────▼┐ │   │
│  │         │  工具执行层                                   │ │   │
│  │         │  ├── normalizeToolParams()                    │ │   │
│  │         │  ├── evaluateToolPolicy()                     │ │   │
│  │         │  │     ├── 冗余读取检测                       │ │   │
│  │         │  │     ├── 重复探索检测                       │ │   │
│  │         │  │     └── evaluateIntentAwareToolPolicy()    │ │   │
│  │         │  ├── requestConfirmation() → UI 确认          │ │   │
│  │         │  └── tool.execute(params) → ToolResult        │ │   │
│  │         └───────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                        外部系统层                                │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │  文件系统    │  │  SQLite DB   │  │  MCP 服务器              ││
│  │  (Markdown   │  │  (chats,     │  │  (stdio/HTTP)            ││
│  │   笔记文件)  │  │   notes,     │  │  ┌────────────────────┐  ││
│  │             │  │   marks,     │  │  │ 外部工具服务器      │  ││
│  │             │  │   tags,      │  │  │ (如 Web 搜索,       │  ││
│  │             │  │   memories,  │  │  │  数据库查询等)      │  ││
│  │             │  │   vectors)   │  │  └────────────────────┘  ││
│  └─────────────┘  └──────────────┘  └──────────────────────────┘│
│                                                                  │
│  ┌──────────────────┐  ┌─────────────────────────┐              │
│  │  Tiptap 编辑器   │  │  AI 模型 API             │              │
│  │  (通过 emitter   │  │  (OpenAI 兼容格式)        │              │
│  │   事件通信)      │  │  ├── OpenAI/GPT           │              │
│  │                  │  │  ├── DeepSeek              │              │
│  │  editor-get-*    │  │  ├── 千问 (Qwen)           │              │
│  │  editor-insert   │  │  ├── GLM (智谱)            │              │
│  │  editor-replace  │  │  ├── MiniMax              │              │
│  │                  │  │  ├── Claude               │              │
│  │                  │  │  └── 任意 OpenAI 兼容 API  │              │
│  └──────────────────┘  └─────────────────────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 附录：关键常量与配置

| 常量 | 值 | 位置 | 说明 |
|------|-----|------|------|
| 最大迭代次数 | 15 | `agent-handler.ts` | 单次 Agent 运行的最大 LLM 调用次数 |
| 编辑器工具超时 | 200ms | `editor-tools.ts` | 编辑器事件响应超时时间 |
| 记忆相似度阈值（检索） | 0.7 | `context/loader.ts` | 余弦相似度低于此值的记忆不会被注入 |
| 记忆去重阈值 | 0.85 | `db/memories.ts` | 余弦相似度高于此值视为重复记忆 |
| 上下文缓存时间 | 5 分钟 | `context/loader.ts` | 记忆检索结果缓存时长 |
| MCP 工具调用最大轮次 | 10 | `ai/chat.ts` | MCP 原生工具调用的最大循环次数 |
| 连续重复操作限制 | 5 | `react.ts` | 连续相同工具+参数调用 5 次后强制终止 |
| TextRank 关键词数 | 15 | `chat-send.tsx` | RAG 检索用的关键词提取数量 |
