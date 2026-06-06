# Code Review Round 2: feature/source-mode-switch-cr-and-fix

**分支**: `feature/source-mode-switch-cr-and-fix` vs `dev`  
**审查日期**: 2026-06-06  
**审查目的**: 验证第一轮审查问题的修复情况，检查是否引入新问题

---

## 第一轮问题验证

### 1. Logger 日志轮转存在数据丢失竞态

**状态**: ✅ 已修复

**验证**: `src/lib/logger.ts` 第 219-223 行现在使用 `rotateBuffer` 数组。当 `this.rotating` 为 true 时，新日志行被推入 `rotateBuffer`，不再直接写入正在被 rename 的文件。`rotate()` 方法在 `finally` 块（第 264-270 行）中将缓冲内容 flush 到新文件。竞态条件已消除。

---

### 2. SourceEditor 初始化 useEffect 缺少依赖项，导致主题切换后内容丢失

**状态**: ✅ 已修复

**验证**: `src/app/core/main/editor/markdown/source-editor.tsx` 现在采用三个独立的 useEffect：
- 第一个（第 70-92 行）：仅在 mount 时创建 EditorView，依赖 `[]`（通过 eslint-disable 注释标注为有意为之）
- 第二个（第 94-109 行）：监听 `initialContent` 变化，通过 `view.dispatch` 替换文档内容，**保留 undo history**
- 第三个（第 111-121 行）：监听 `isDark` 变化，通过 `themeCompartmentRef.current.reconfigure()` 重配主题，**不丢弃编辑器状态**

修复方式正确，使用 Compartment 进行主题重配置是 CodeMirror 6 的标准做法。

---

### 3. `matchesShortcut` 在 macOS + CommandOrControl 场景下遗漏额外按键检查

**状态**: ✅ 已修复

**验证**: `src/lib/shortcut-match.ts` 第 18-26 行：
```typescript
if (modifiers.includes('commandorcontrol')) {
  if (!ctrlOrMeta) return false
  // Prevent Ctrl+Cmd+Key false triggers: check the OTHER modifier is NOT pressed
  if (isMac && event.ctrlKey) return false
  if (!isMac && event.metaKey) return false
}
```
macOS 上检查 `event.ctrlKey` 为 false，Windows 上检查 `event.metaKey` 为 false，防止同时按两个修饰键误触。修复完整。

---

### 4. 源码模式事件未在 emitter 类型中声明

**状态**: ✅ 已修复

**验证**: `src/lib/emitter.ts` 第 119-120 行已添加：
```typescript
'source-mode-changed': boolean;
'toggle-source-mode': void;
```
类型定义完整。

---

### 5. `bindShortcut` 会 `unregisterAll()` 所有全局快捷键

**状态**: ✅ 已修复

**验证**: `src/stores/shortcut.ts` 第 50-55 行新增了 `bindAllShortcuts` 函数，将 `unregisterAll()` 提到循环外只执行一次，然后用 `for...of` 顺序注册所有快捷键：
```typescript
async function bindAllShortcuts(shortcuts: Shortcut[]) {
  await unregisterAll()
  for (const shortcut of shortcuts) {
    await bindShortcut(shortcut)
  }
}
```
`bindShortcut` 本身（第 35-48 行）不再调用 `unregisterAll()`。

---

### 6. `forEach(async ...)` 导致并发注册快捷键顺序不可控

**状态**: ✅ 已修复

**验证**: 所有调用点（第 73、77、91、104 行）都改为调用 `bindAllShortcuts()`，内部使用 `for...of` + `await` 顺序执行。不再存在 `forEach(async ...)` 问题。

---

### 7. Logger `appendToFile` 中的 catch 只报告第一次错误后静默

**状态**: ✅ 已修复

**验证**: `src/lib/logger.ts` 第 84-85 行使用时间窗口策略：
```typescript
private lastErrorReportedAt = 0
private readonly errorReportIntervalMs = 60_000
```
第 229-233 行的 catch 逻辑：当距上次报告超过 60 秒时允许再次报告错误。不再永久静默。

---

### 8. `preInitQueue` 无容量溢出告警

**状态**: ✅ 已修复

**验证**: `src/lib/logger.ts` 第 207-209 行：
```typescript
} else if (!this.preInitQueueOverflowWarned) {
  console.warn('[Logger] preInitQueue is full, logs are being dropped. Call logger.init() to start writing to file.')
  this.preInitQueueOverflowWarned = true
}
```
队列满时通过 `console.warn` 提示一次。

---

### 9. 源码模式切换时回写编辑器的时序问题

**状态**: ✅ 已修复

**验证**: `src/app/core/main/editor/editor-layout.tsx` 第 103-106 行：
```typescript
setTimeout(() => {
  emitter.emit('external-content-update', sourceContentRef.current)
}, 0)
```
使用 `setTimeout(..., 0)` 延迟 emit，确保 MdEditor 已挂载/渲染完成后再接收内容。

---

### 10. `handleSourceContentChange` 直接调用 `saveCurrentArticle` 缺少防抖

**状态**: ✅ 已修复

**验证**: `src/app/core/main/editor/editor-layout.tsx` 第 88 行新增 `saveDebounceRef`，第 137-142 行实现了 400ms 的 debounce：
```typescript
if (saveDebounceRef.current) {
  clearTimeout(saveDebounceRef.current)
}
saveDebounceRef.current = setTimeout(() => {
  useArticleStore.getState().saveCurrentArticle(content)
}, 400)
```

---

### 13. `title-bar.tsx` 中 `as any` 类型断言

**状态**: ✅ 已修复

**验证**: `src/components/title-bar.tsx` 第 61-67 行：
```typescript
const handleSourceModeChanged = (active: boolean) => {
  setSourceMode(active)
}
emitter.on('source-mode-changed', handleSourceModeChanged)
```
不再使用 `as any`，因为 `emitter.ts` 中已正确声明了事件类型。

---

## 新引入的问题

### N1. `saveDebounceRef` 在组件卸载时未清理定时器

**文件**: `src/app/core/main/editor/editor-layout.tsx` 第 88 行

**问题**: `saveDebounceRef` 持有一个 `setTimeout` 的返回值，但组件卸载时没有 `clearTimeout`。如果用户在编辑后快速关闭 tab 或切换路由，400ms 后的 `saveCurrentArticle` 可能在组件已卸载后执行，虽然不会崩溃（因为直接调用 store），但属于内存泄漏的潜在隐患。

**建议**: 添加一个 cleanup useEffect：
```typescript
useEffect(() => {
  return () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
    }
  }
}, [])
```

**严重程度**: 轻微

---

### N2. SourceEditor 的 `initialContent` 变更 useEffect 在首次 mount 时会触发一次多余的 dispatch

**文件**: `src/app/core/main/editor/markdown/source-editor.tsx` 第 94-109 行

**问题**: 组件首次 mount 时，第一个 useEffect 创建 EditorView 并用 `initialContent` 初始化文档。紧接着第二个 useEffect 也会执行（因为 `initialContent` 在依赖列表中），检查 `currentDoc !== initialContent`。虽然此时两者相同所以不会触发 dispatch，但这依赖于 React 的 useEffect 执行顺序保证（同一次渲染中按声明顺序执行）。如果未来重构打乱顺序，可能产生边界问题。

**严重程度**: 极轻微（当前逻辑正确，仅为设计脆弱性提醒）

---

## 遗留问题

### L1. `react.ts` 中第 1 级解析的大括号计数逻辑仍未复用 `extractJsonObject`

**文件**: `src/lib/agent/react.ts` 第 1117-1157 行

**说明**: 第一轮 Issue #11 指出第 1 级解析中的大括号计数代码与 `extractJsonObject`（第 1366-1407 行）重复约 40 行。当前代码中该重复仍然存在。这不是 bug，属于代码卫生问题，建议后续清理。

---

### L2. `react.ts` 第 1684 行缩进不一致仍然存在

**文件**: `src/lib/agent/react.ts` 第 1684 行

```typescript
      toolCall.result = result
      this.config.onToolCall?.(toolCall)

        if (result.success) {   // 8 空格，与上下文的 6 空格不一致
        // 特殊处理 select_skill 工具
```

第 1701 行也有类似问题（`if (result.data)` 用了 10 空格缩进）。这是第一轮 Issue #14 的内容，未修复。

---

### L3. `tool-policy.ts` 中 `skillExecutionPatterns` 与 `generativeExecutionPatterns` 仍有大量重叠

**文件**: `src/lib/agent/tool-policy.ts` 第 97-109 行

**说明**: 第一轮 Issue #15，未修复。两组模式在语义上高度重叠，增加维护成本。

---

### L4. `extractChangedRegion` 仍定义在 `act` 方法内部

**文件**: `src/lib/agent/react.ts` 第 1615 行

**说明**: 第一轮建议 F，未实施。该函数每次执行都重新定义，应提取为模块级函数。

---

## 总结

| 类别 | 数量 | 状态 |
|------|------|------|
| 严重问题 (1-3) | 3 | 全部已修复 ✅ |
| 中等问题 (4-10) | 7 | 全部已修复 ✅ |
| 类型安全问题 (13) | 1 | 已修复 ✅ |
| 新引入问题 | 2 | 均为轻微 |
| 遗留问题 | 4 | 均为代码卫生/风格，无功能影响 |

**结论**: 第一轮审查中所有严重和中等问题均已正确修复，修复质量良好。新引入的问题均为轻微级别，不影响功能正确性。遗留问题为代码风格和重复代码，建议在后续迭代中逐步清理。**本轮审查通过，可以合并。**
