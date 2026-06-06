# Code Review: feature/source-mode-switch-cr-and-fix

**分支**: `feature/source-mode-switch-cr-and-fix` vs `dev`  
**审查日期**: 2026-06-06  
**审查范围**: 源码模式切换、Agent ReAct 循环重构、日志系统、快捷键匹配

---

## 严重问题

### 1. Logger 日志轮转存在数据丢失竞态

**文件**: `src/lib/logger.ts` 第 209-215 行

**问题**: `writeLog` 在检测到文件大小超限后调用 `rotate()`（异步），但随即**立刻**调用 `appendToFile` 写入新内容。由于 `rotate()` 是 `async` 且未 `await`（只设了 `this.rotating` 标志），在 rotate 执行 `rename` 操作期间新内容会写入正在被重命名的旧文件，导致该日志行丢失。

```typescript
// 第 209 行
if (this.currentFileSize + lineBytes >= this.maxFileSize && !this.rotating) {
  this.rotate()  // fire-and-forget，不等待完成
}
this.appendToFile(line)  // 可能写入正在被 rename 的文件
```

**建议修复**: 将 rotate 期间的日志缓冲，或在 rotate 完成前暂停写入（队列化）。最简方案是在 `rotating` 为 true 时将 line 推入一个 buffer，rotate 完成后 flush。

---

### 2. SourceEditor 初始化 useEffect 缺少依赖项，导致主题切换后内容丢失

**文件**: `src/app/core/main/editor/markdown/source-editor.tsx` 第 71-90 行

**问题**: 第一个 `useEffect`（创建 EditorView）的依赖数组为 `[]`，但它引用了 `initialContent` 和 `isDark`。当组件用不同的 `initialContent` 重新渲染时（例如切换 tab），编辑器不会重新创建，显示的还是旧内容。

更严重的是，第二个 `useEffect`（第 92-104 行）在 `isDark` 变化时调用 `view.setState(state)` 用 `currentDoc` 重建状态——但这会**清除 undo history**，且不会触发 `onChange` 回调通知外部当前文档内容。

**建议修复**:
- 将 `initialContent` 加入第一个 useEffect 的依赖列表，或在 `initialContent` 变化时通过 `view.dispatch` 替换文档内容
- 主题切换改用 `EditorView.reconfigure` 只重配 extensions，不丢弃状态

---

### 3. `matchesShortcut` 在 macOS + CommandOrControl 场景下遗漏额外按键检查

**文件**: `src/lib/shortcut-match.ts` 第 18-33 行

**问题**: 当快捷键为 `CommandOrControl+T` 时，在 macOS 上 `ctrlOrMeta` 使用 `event.metaKey`。但第 30-33 行的"无关修饰符检查"不会检查 `event.ctrlKey`（因为 `needsCtrl` 为 false 仅在 `modifiers.includes('control')` 时为 true，而这里是 `commandorcontrol`）。这意味着用户同时按 Ctrl+Cmd+T 也会触发该快捷键，属于误触。

```typescript
if (!modifiers.includes('commandorcontrol')) {
  if (!needsCtrl && event.ctrlKey) return false  // 这段在 commandorcontrol 时被跳过
  if (!needsMeta && event.metaKey) return false
}
```

**建议修复**: 在 `commandorcontrol` 分支内，macOS 上额外检查 `event.ctrlKey === false`，Windows 上额外检查 `event.metaKey === false`，避免同时按两个修饰键误触。

---

## 中等问题

### 4. 源码模式事件 `source-mode-changed` / `toggle-source-mode` 未在 emitter 类型中声明

**文件**: `src/lib/emitter.ts`、`src/components/title-bar.tsx` 第 63 行、`src/app/core/main/editor/editor-layout.tsx` 第 105 行

**问题**: 这两个事件在 `Events` 接口中没有定义。`title-bar.tsx` 中使用了 `as any` 强制类型转换来绕过类型错误。这降低了类型安全性，也会让其他开发者无法通过类型发现这些事件。

**建议修复**: 在 `src/lib/emitter.ts` 的 `Events` 接口中添加：
```typescript
'source-mode-changed': boolean;
'toggle-source-mode': void;
```

---

### 5. `bindShortcut` 会 `unregisterAll()` 所有全局快捷键

**文件**: `src/stores/shortcut.ts` 第 36-48 行

**问题**: 每次注册一个快捷键前都调用 `unregisterAll()`，这意味着在循环注册多个快捷键时（第 67-69 行使用 `forEach(async ...)`），后注册的快捷键会取消前面已注册的。最终只有最后一个快捷键生效。

```typescript
async function bindShortcut(shortcut: Shortcut) {
  if (inAppOnlyShortcuts.has(shortcut.key)) return
  await unregisterAll()  // 清除所有已注册的快捷键！
  ...
}
```

**建议修复**: 将 `unregisterAll()` 提到循环外面执行一次，或改为只 unregister 当前要替换的那个快捷键。

---

### 6. `forEach(async ...)` 导致并发注册快捷键顺序不可控

**文件**: `src/stores/shortcut.ts` 第 67-69 行、第 89-91 行、第 103-105 行

**问题**: `Array.forEach` 内使用 `async` 回调，这些异步操作会并行执行且无法捕获错误。结合上一条的 `unregisterAll()`，导致快捷键注册结果不确定。

**建议修复**: 改用 `for...of` 循环 + `await`，确保顺序执行。

---

### 7. Logger `appendToFile` 中的 catch 只报告第一次错误后静默

**文件**: `src/lib/logger.ts` 第 217-223 行

**问题**: `errorReported` 标志使得日志写入失败只报告一次。如果是临时性 I/O 错误（如磁盘满后释放），恢复后的写入错误会被永久静默，用户无法感知日志已停止写入。

**建议修复**: 使用带时间窗口的去重策略（例如每 60 秒允许报告一次错误），而非永久静默。

---

### 8. `preInitQueue` 无容量溢出告警

**文件**: `src/lib/logger.ts` 第 200-205 行

**问题**: 当 `preInitQueue` 达到 `PRE_INIT_QUEUE_MAX`(100) 后，后续日志直接丢弃，无任何提示。如果 `init()` 因某种原因延迟，关键的启动错误日志会丢失。

**建议修复**: 在队列满时至少用 `console.warn` 提示一次日志正在被丢弃。

---

### 9. 源码模式切换时回写编辑器的时序问题

**文件**: `src/app/core/main/editor/editor-layout.tsx` 第 92-108 行

**问题**: 退出源码模式时通过 `emitter.emit('external-content-update', sourceContentRef.current)` 将内容回写到 MdEditor。但此时 `sourceMode` 状态刚切换为 false，React 还在同一个渲染周期中，MdEditor 组件可能尚未挂载/渲染完成就收到了 emit 事件，导致内容丢失。

**建议修复**: 使用 `setTimeout(..., 0)` 或 `queueMicrotask` 延迟 emit，确保 MdEditor 已就绪。

---

### 10. `handleSourceContentChange` 直接调用 `saveCurrentArticle` 缺少防抖

**文件**: `src/app/core/main/editor/editor-layout.tsx` 第 128-135 行

**问题**: 每次 CodeMirror 文档变更都会触发 `saveCurrentArticle(content)`，如果该方法涉及磁盘写入或状态更新，会造成大量无效 I/O。

**建议修复**: 添加 debounce（300-500ms），仅在用户停止输入后触发保存。

---

## 轻微问题

### 11. `react.ts` 中 JSON 解析器的大括号计数逻辑重复

**文件**: `src/lib/agent/react.ts` 第 1117-1157 行 和 第 1366-1407 行

**问题**: 两处几乎相同的大括号计数 JSON 提取逻辑。第一处在 `parseAction` 的"第 1 级"处理中，第二处在 `extractJsonObject` 方法中。代码重复约 40 行。

**建议修复**: 统一使用 `extractJsonObject` 方法，第 1 级解析也复用它。

---

### 12. `react.ts` 中 `escapeNext` 变量在 `inString` 检查中存在冗余条件

**文件**: `src/lib/agent/react.ts` 第 1132 行、第 1388 行

```typescript
if (char === '"' && !escapeNext) {
```

但在 `escapeNext = true` 的下一次循环时已经将 `escapeNext` 重置为 false 并 `continue` 了（第 1128-1130 行），所以执行到此处时 `escapeNext` **一定为** false。该条件是冗余的，虽然无害但增加理解成本。

---

### 13. `title-bar.tsx` 中 `as any` 类型断言

**文件**: `src/components/title-bar.tsx` 第 63、65 行

**问题**: `emitter.on('source-mode-changed', handleSourceModeChanged as any)` — 应该修复类型定义而非绕过。

---

### 14. `react.ts` 第 1684 行缩进不一致

**文件**: `src/lib/agent/react.ts` 第 1684 行

```typescript
        if (result.success) {  // 8 空格缩进
```

与周围代码（6 空格）不一致，可能是编辑器格式化遗留问题。

---

### 15. `tool-policy.ts` 中 `skillExecutionPatterns` 与 `generativeExecutionPatterns` 有大量重叠

**文件**: `src/lib/agent/tool-policy.ts` 第 97-108 行

**问题**: 这两组正则在语义上基本相同（都匹配"使用 skill 生成文件"类场景），增加了维护成本。

**建议修复**: 合并为一组或明确各自的互斥语义。

---

## 改进建议

### A. ReAct Agent 的 `parseAction` 多级解析应加入单元测试

`parseAction` 现在有 8 级后备解析逻辑，涵盖各种 LLM 输出格式。这是核心解析路径，但没有对应的单元测试。建议为每一级都编写测试用例，防止后续修改导致回退。

### B. Logger 可考虑批量写入

当前每条日志都独立调用 `writeTextFile(..., { append: true })`。高频日志场景下（如 TRACE 级别），会产生大量小写入 I/O 操作。可以考虑用一个短时间窗口（50-100ms）的 buffer 批量写入。

### C. 源码模式状态应持久化

当前 `sourceMode` 是组件内的 `useState`，刷新或路由切换后丢失。如果用户习惯使用源码模式编辑，每次都要重新开启体验不好。可考虑存入 store。

### D. `defaultShortcuts` 默认的 `CommandOrControl+T` 与浏览器"新标签页"冲突

虽然 Tauri 不是浏览器环境，但在开发模式下（`pnpm dev` + 浏览器访问 localhost）会冲突。建议开发文档中提示，或在 Tauri 环境外自动禁用。

### E. Agent `traceId` 未贯穿到子操作

`react.ts` 第 263 行生成了 `traceId`，但只在 run 的 start/end 日志中使用，think/act 等子操作日志未包含该 traceId。在多个 Agent 并发时无法关联日志。建议将 traceId 作为 log.child 的模块前缀或通过结构化字段传递。

### F. `extractChangedRegion` 函数可提取为独立工具函数

`react.ts` 第 1615-1649 行的 `extractChangedRegion` 定义在 `act` 方法的匿名块内（`if (toolName === 'modify_current_note')` 内部），每次执行都重新定义。应提取为模块级函数或单独文件。
