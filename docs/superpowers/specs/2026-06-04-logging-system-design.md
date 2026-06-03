# NoteGen 日志系统设计文档

> 日期：2026-06-04
> 状态：已批准

## 1. 概述

### 1.1 背景

NoteGen 当前没有任何日志基础设施——全项目依赖裸 `console.*` 调用（约 416 处），没有日志级别控制、没有文件持久化、没有 Agent 执行链路追踪。当用户遇到 AI 功能异常（如工具调用解析失败、LLM 返回格式不符等）时，缺乏有效的排查手段。

### 1.2 目标

实现一套完整的基于本地文件的日志系统：

1. **日志分级**：支持 error / warn / info / debug / trace，默认 error
2. **日志 rotate**：基于文件大小自动轮转，可配置上限
3. **可视化配置**：在设置页面的常规设置中提供日志配置 UI
4. **Agent 链路追踪**：用 debug/trace 级别记录大模型的完整 input/output 及 ReAct 执行流程

### 1.3 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 实现层 | 前端 TypeScript | Agent 追踪数据天然在 TS 侧，不需要改 Rust 代码 |
| 写入方式 | 单例 Logger + 直接写入 | 简单可靠，crash 不丢数据，日志实时 |
| 第三方依赖 | 无 | 只用 Tauri FS API，零额外依赖 |
| 文件 I/O | Tauri `appendFile`（异步，fire-and-forget） | 底层已是异步 I/O，性能够用 |

## 2. Logger 核心模块

### 2.1 文件位置

`src/lib/logger.ts`

### 2.2 日志级别

```typescript
enum LogLevel {
  ERROR = 0,   // 错误：需要关注的异常
  WARN  = 1,   // 警告：可恢复的异常情况
  INFO  = 2,   // 信息：关键业务节点
  DEBUG = 3,   // 调试：Agent 执行链路摘要
  TRACE = 4,   // 追踪：完整数据体（LLM input/output 等）
}
```

默认级别：`ERROR`。正常使用时写入量极小，只有主动调到 debug/trace 时才有大量写入。

### 2.3 日志行格式

```
{ISO时间戳} [{级别}] [{模块:方法}] {消息}
```

示例：

```
2026-06-04T10:23:45.123+08:00 [ERROR] [agent/react] parseAction failed: JSON unparseable
2026-06-04T10:23:45.456+08:00 [DEBUG] [agent/react:think] LLM response received, length=2847, elapsed=2341ms
2026-06-04T10:23:45.789+08:00 [TRACE] [agent/react:act] tool=create_file params={"fileName":"git-guide.md","folderPath":"技术"}
```

### 2.4 核心 API

```typescript
// 获取模块级子 logger（带模块名前缀）
const log = logger.child('agent/react')

log.error('parseAction failed:', error.message)
log.warn('duplicate action detected:', toolName)
log.info('agent run completed, steps:', steps.length)
log.debug('LLM response received, length=', response.length)
log.trace('tool params:', JSON.stringify(params))

// 级别检查（保护重序列化开销）
if (log.isTraceEnabled()) {
  log.trace('LLM full response:', response)
}
```

`child(module)` 返回轻量包装对象，自动在日志行添加 `[module]` 前缀。共享底层写入器和配置，不是新实例。

### 2.5 内部结构

```typescript
class Logger {
  // 初始化
  init(config: LoggerConfig): Promise<void>

  // 日志方法
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  trace(...args: unknown[]): void

  // 子 logger
  child(module: string): ChildLogger

  // 配置热更新
  setLevel(level: LogLevel): void
  setDir(dir: string): Promise<void>
  setMaxFileSize(sizeMB: number): void
  setMaxFiles(count: number): void

  // 级别检查
  isTraceEnabled(): boolean
  isDebugEnabled(): boolean

  // 内部方法
  private write(level: LogLevel, module: string, message: string): void
  private rotate(): Promise<void>
  private formatLine(timestamp: string, level: string, module: string, message: string): string
  private checkSize(): void
}

export const logger: Logger  // 单例导出
```

### 2.6 性能保护

```typescript
// 级别检查在最前面，不满足时零开销
if (this.level < LogLevel.DEBUG) return  // 热路径直接返回，不执行字符串拼接

// trace 级别的大数据只在 trace 开启时才序列化
if (log.isTraceEnabled()) {
  log.trace('LLM full response:', response)
}
```

### 2.7 依赖关系

```
logger.ts ← 零业务依赖（只用 @tauri-apps/plugin-fs 和 @tauri-apps/api/path）
     ↑
     ├── setting.ts（init 时传入配置，subscribe 监听变更）
     ├── react.ts（child('agent/react')）
     ├── agent-handler.ts（child('agent/handler')）
     ├── tool-policy.ts（child('agent/policy')）
     ├── chat-send.tsx（child('chat')）
     └── chat.ts（child('ai/chat')）
```

logger 不依赖任何业务模块，业务模块单向依赖 logger，无循环依赖风险。

## 3. 日志 Rotate 机制

### 3.1 策略

基于文件大小轮转（不按时间）。

### 3.2 触发时机

每次写入前检查 `currentFileSize >= maxFileSize`。为避免频繁 stat，内存中维护一个 `currentFileSize` 计数器，每次写入后累加字节数。

### 3.3 轮转过程

```
写入前检查 currentFileSize >= maxFileSize?
  │
  ├── 否 → 直接 appendFile，累加计数器
  │
  └── 是 → 执行 rotate:
        1. 删除最旧的文件（如 notegen.4.log），如果文件数已达 maxFiles
        2. 依次重命名:
           notegen.3.log → notegen.4.log
           notegen.2.log → notegen.3.log
           notegen.1.log → notegen.2.log
           notegen.log   → notegen.1.log
        3. 创建新的空 notegen.log
        4. 重置 currentFileSize = 0
```

### 3.4 文件命名

```
logs/
  notegen.log       ← 当前正在写入
  notegen.1.log     ← 上一个（最近）
  notegen.2.log     ← 再上一个
  notegen.3.log     ← 更旧
  notegen.4.log     ← 最旧（maxFiles=5 时）
```

### 3.5 默认配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 日志级别 | `error` | 生产环境只记录错误 |
| 日志目录 | `{appDataDir}/logs/` | 跟随应用数据目录 |
| 单文件最大大小 | 10 MB | 超过即轮转 |
| 最大文件数量 | 5 | 含当前文件，最多保留 5 个 |

默认最多占用 50 MB 磁盘空间。

### 3.6 边界处理

- 应用启动时，`logs/` 目录不存在则自动创建
- 应用启动时，`notegen.log` 已存在则读取大小初始化 `currentFileSize`
- rotate 过程中旧文件不存在（用户手动删除了），跳过继续

## 4. 设置页面 UI

### 4.1 位置

在「常规设置」页面底部新增「日志设置」区块，和主题、语言、缩放等设置同级排列。

### 4.2 UI 布局

使用现有 `Item` 组件系统，4 行设置项：

```
┌─────────────────────────────────────────────────────────┐
│ 📋 日志级别                                              │
│ 控制日志记录的详细程度                    [ Error    ▾ ] │
├─────────────────────────────────────────────────────────┤
│ 📁 日志目录                                              │
│ 日志文件存储位置           [ /path/to/logs/        📂 ] │
├─────────────────────────────────────────────────────────┤
│ 📦 单文件大小上限                                        │
│ 超过此大小自动轮转                       [ 10 MB   ▾ ] │
├─────────────────────────────────────────────────────────┤
│ 🗂️ 最大文件数量                                          │
│ 包含当前文件，最多保留的日志文件数       [ 5       ▾ ] │
└─────────────────────────────────────────────────────────┘
```

### 4.3 控件详情

| 设置项 | 控件类型 | 选项 | 默认值 |
|--------|----------|------|--------|
| 日志级别 | `Select` 下拉框 | Error / Warn / Info / Debug / Trace | Error |
| 日志目录 | `Input` + 文件夹选择按钮（Tauri `open` 对话框） | 自由输入或选择 | `{appDataDir}/logs` |
| 单文件大小上限 | `Select` 下拉框 | 1 MB / 5 MB / 10 MB / 20 MB / 50 MB | 10 MB |
| 最大文件数量 | `Select` 下拉框 | 3 / 5 / 10 / 20 | 5 |

### 4.4 Store 持久化

`setting.ts` 新增字段：

```typescript
logLevel: 'error'           // 'error' | 'warn' | 'info' | 'debug' | 'trace'
logDir: ''                  // 空字符串 = 默认路径 {appDataDir}/logs
logMaxFileSize: 10          // 单位 MB
logMaxFiles: 5              // 最大文件数量
```

`store.json` 键：`log.level`、`log.dir`、`log.maxFileSize`、`log.maxFiles`。

### 4.5 i18n

各语言文件新增 `settings.general.interface.logging.*` 区块。

## 5. Agent 执行链路追踪

### 5.1 追踪分层

```
Session 层  ─── 一次完整的 Agent 执行（用户发一条消息到 AI 回复完成）
  │
  Iteration 层 ─── ReAct 循环的每一轮迭代
    │
    Operation 层 ─── 每轮内的具体操作（think/parseAction/act/validate 等）
```

### 5.2 追踪 ID

每次 Agent 执行生成 `traceId`（如 `agent-1717480225123`），贯穿整个 session，方便 grep 筛选。

### 5.3 debug vs trace 分界

| 级别 | 记录什么 | 典型大小 |
|------|----------|----------|
| `debug` | 结构化摘要：方法名、关键参数、长度、耗时、决策结果 | 每行 100-300 字节 |
| `trace` | 完整数据体：LLM 的完整 input/output、工具的完整 params/result | 每行可达 KB 级 |

### 5.4 追踪点示例

#### Session 层

```
[DEBUG] [agent/handler] ▶ session start traceId=agent-xxx input="在当前文件末尾增加git..." inputLen=18
[DEBUG] [agent/handler]   mcpTools reloaded, count=0
[DEBUG] [agent/handler]   skills loaded: ["style-detector"] count=1
[DEBUG] [agent/handler]   intentPolicy: write=true destructive=false execute=false
[DEBUG] [chat]            context built: activeFile="技术/git-guide.md" contextLen=1234 ragEnabled=false
[DEBUG] [chat]            messages built: historyCount=3
...
[DEBUG] [agent/handler] ◀ session end traceId=agent-xxx steps=3 resultLen=45 elapsed=8234ms
```

#### Iteration 层

```
[DEBUG] [agent/react] ── iteration 1/15 start ──
[DEBUG] [agent/react]   systemPrompt built, len=28456, memories=2, skills=1
[DEBUG] [agent/react]   think() calling LLM, mode=messages, messageCount=3, hasImages=false
[DEBUG] [agent/react]   think() LLM responded, responseLen=347, thinkingLen=0, elapsed=2341ms
[DEBUG] [agent/react]   parseAction: level-1 matched, tool=get_editor_content, params={}
[DEBUG] [agent/react]   act() → tool=get_editor_content
[DEBUG] [agent/react]     policy: risk=low, allowed=true, confirmation=false
[DEBUG] [agent/react]     execute() success, observationLen=1823
[DEBUG] [agent/react]   step recorded: thought=347b action=get_editor_content obs=1823b duration=156ms
[DEBUG] [agent/react] ── iteration 1/15 end ──
```

#### Operation 层（trace 级别）

```
[TRACE] [agent/react:think] LLM request messages: [{"role":"system","content":"You are..."},...]
[TRACE] [agent/react:think] LLM full response: "Thought: 用户想在...\nAction: get_editor_content\n..."
[TRACE] [agent/react:act]  tool execute params: {"startLine":45,"endLine":45,"version":3}
[TRACE] [agent/react:act]  tool execute result: {"success":true,"data":"内容已替换"}
[TRACE] [agent/react]      preprocessThought: stripped=0 blocks, fenceStripped=false, cleanedLen=347
```

### 5.5 完整埋点清单

#### `react.ts`（~30 处）

| 方法 | 追踪内容 | 级别 |
|------|----------|------|
| `run()` 循环开始 | traceId, userInput, maxIterations, intentPolicy | debug |
| `run()` 每轮迭代开始 | currentIteration | debug |
| `run()` auto-recovery 触发 | lastStep.tool, descriptor.key | debug |
| `run()` finalAnswer 检测 | delimiter, finalAnswer.length | debug |
| `run()` validateFinalAnswerReadiness | ok, reason | debug |
| `run()` thought-only 退出 | thoughtContent.length | debug |
| `run()` parseAction 返回 null | 哪个分支处理, thought.length | debug |
| `run()` 重复动作检测 | tool, sameActionCount | debug |
| `run()` 循环结束 | finalAnswer.length, totalIterations | debug |
| `buildSystemPrompt()` | prompt.length, memories count, skills count | debug |
| `think()` 调用 LLM | mode, messageCount, hasImages | debug |
| `think()` LLM 返回 | responseLen, thinkingLen, elapsed | debug |
| `think()` LLM 请求详情 | messagesForAI 完整内容 | trace |
| `think()` LLM 响应详情 | response 完整文本 | trace |
| `think()` API 错误 | error.name, error.message | error |
| `preprocessThought()` | thinkBlocksStripped, fenceStripped, cleanedLen | trace |
| `parseAction()` 匹配成功 | level (1-6), tool, params keys | debug |
| `parseAction()` 全部失败 | thought.length | debug |
| `parseAction()` JSON 解析失败 | jsonStr 前 100 字符 | debug |
| `act()` 入口 | toolName, params keys | debug |
| `act()` 工具不存在 | toolName | warn |
| `act()` 策略评估 | risk, allowed, requiresConfirmation, reason | debug |
| `act()` 策略阻止 | blockedMessage | debug |
| `act()` 确认结果 | autoApproval/awaited, confirmed/rejected | debug |
| `act()` normalizeParams | before/after keys diff | debug |
| `act()` 工具执行 | toolName, params 完整内容 | trace |
| `act()` 执行结果 | success, observationLen | debug |
| `act()` 执行结果详情 | result 完整内容 | trace |
| `act()` 执行异常 | errorStr | error |
| `normalizeToolParams()` | toolName, 哪个分支, keys changed | debug |
| `validateFinalAnswerReadiness()` | flags, which check failed, reason | debug |

#### `agent-handler.ts`（~8 处）

| 方法 | 追踪内容 | 级别 |
|------|----------|------|
| `execute()` 入口 | userInput(截断), chatId | debug |
| `execute()` MCP 加载 | count | debug |
| `execute()` Skills 加载 | skillIds, count | debug |
| `execute()` agent.run() 返回 | result.length | debug |
| `execute()` onComplete | steps.length, stopped | debug |
| `execute()` USER_STOPPED | steps.length | debug |
| `execute()` 异常 | errorMessage | error |
| `stop()` 调用 | — | debug |

#### `tool-policy.ts`（~4 处）

| 方法 | 追踪内容 | 级别 |
|------|----------|------|
| `deriveIntentPolicy()` | userInput(前 100 字), 三个 flag 结果 | debug |
| `evaluateIntentAwareToolPolicy()` | toolName, risk, allowed, requiresConfirmation | debug |
| 策略阻止 | toolName, reason | debug |
| 策略放行 | toolName, confirmation flag | debug |

#### `chat-send.tsx`（~10 处）

| 方法 | 追踪内容 | 级别 |
|------|----------|------|
| `handleAgentMode()` 入口 | imageUrls.length | debug |
| 上下文: 活跃文件 | activeFilePath, contextLen | debug |
| 上下文: RAG | keywords count, ragSources.length | debug |
| 上下文: 关联文件 | linkedResource.name, contentLen | debug |
| 上下文: 引用文本 | quoteData 摘要 | debug |
| messages 构建 | chats.length, messages.length | debug |
| requestConfirmation 入口 | toolName, params keys | debug |
| autoApproval 匹配 | scope, conversationId match | debug |
| 用户确认/取消 | toolName, result | debug |
| onComplete | resultLen, steps.length, stopped | debug |

#### `chat.ts`（~6 处）

| 方法 | 追踪内容 | 级别 |
|------|----------|------|
| `fetchAiStream()` 入口 | model, temperature, messageCount, hasTools | debug |
| 流式完成 | fullContent.length, thinking.length, toolCalls.length | debug |
| MCP 工具调用 | serverId, toolName | debug |
| MCP 工具结果 | success/error, resultLen | debug |
| MCP 循环达上限 | iteration | warn |
| API 异常 | error | error |

**总计约 58 处埋点。**

## 6. 错误处理与边界情况

### 6.1 核心原则

**日志写入失败静默降级，绝不抛异常。**

| 场景 | 处理 |
|------|------|
| 写入失败 | `console.error` 输出一次警告，后续同类错误不再重复（防刷屏） |
| 目录不存在 | 自动创建 |
| rotate 失败 | 跳过本次 rotate，继续写入当前文件 |
| 磁盘满 | 静默忽略，`console.error` 提示一次 |
| 配置值非法 | 使用默认值 |

### 6.2 初始化时序

```
应用启动
  → setting store initSettingData()     从 store.json 读取日志配置
  → logger.init(config)                 创建 logs/ 目录，打开 notegen.log，初始化 currentFileSize
  → 就绪
```

`logger` 在 `init()` 之前调用时，日志行暂存到内存队列（最多 100 条），`init()` 完成后 flush 到文件。

### 6.3 配置热更新

用户在设置页面修改配置时，通过 Zustand store 的 subscribe 机制实时通知 logger，立即生效，无需重启。

改日志目录时，logger 在新目录创建 `notegen.log` 继续写入。

### 6.4 应用退出

不需要特殊处理。每次写入都是直接 `appendFile`，没有内存缓冲，不存在丢数据问题。

## 7. 文件清单

### 新建

| 文件 | 职责 |
|------|------|
| `src/lib/logger.ts` | Logger 核心 |
| `src/app/core/setting/general/interface-settings/logging-settings.tsx` | 设置页 UI |

### 修改

| 文件 | 修改内容 |
|------|----------|
| `src/stores/setting.ts` | 新增 logLevel, logDir, logMaxFileSize, logMaxFiles + setter |
| `src/app/core/setting/general/interface-settings/index.tsx` | 引入 LoggingSettings |
| `src/lib/agent/react.ts` | ~30 处 debug/trace 埋点 |
| `src/lib/agent/agent-handler.ts` | ~8 处 debug 埋点 |
| `src/lib/agent/tool-policy.ts` | ~4 处 debug 埋点 |
| `src/app/core/main/chat/chat-send.tsx` | ~10 处 debug 埋点 |
| `src/lib/ai/chat.ts` | ~6 处 debug 埋点 |
| `messages/zh.json` | logging i18n |
| `messages/en.json` | logging i18n |
| `messages/ja.json` | logging i18n |
| `messages/pt-BR.json` | logging i18n |
| `messages/zh-TW.json` | logging i18n |

### 不需要修改

- Rust 代码：不改
- `tauri.conf.json`：不改（FS 权限已够用）
- `package.json`：不改（零第三方依赖）
