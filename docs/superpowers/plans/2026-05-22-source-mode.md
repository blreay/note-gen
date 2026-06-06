# Source Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source mode that displays raw Markdown in a CodeMirror 6 editor with syntax highlighting, togglable via a title-bar button or configurable keyboard shortcut (default Ctrl+T).

**Architecture:** A new `sourceMode` boolean state in `editor-layout.tsx` conditionally renders either TipTap (WYSIWYG) or a new CodeMirror wrapper (`source-editor.tsx`). Content syncs between them on toggle. A button in `title-bar.tsx` and an in-app keydown listener drive the toggle. The shortcut key is stored in the existing shortcut store.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/theme-one-dark`), existing emitter bus, zustand shortcut store, next-themes.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/app/core/main/editor/markdown/source-editor.tsx` | CodeMirror 6 wrapper with markdown highlighting |
| Create | `src/lib/shortcut-match.ts` | Utility to match DOM KeyboardEvent against shortcut config string |
| Modify | `src/app/core/main/editor/editor-layout.tsx` | Source mode state, conditional rendering, keyboard shortcut listener |
| Modify | `src/components/title-bar.tsx` | Add source mode toggle button |
| Modify | `src/stores/shortcut.ts` | Add `toggleSourceMode` default shortcut entry |
| Modify | `messages/en.json` | i18n keys for navigation + shortcuts |
| Modify | `messages/zh.json` | i18n keys for navigation + shortcuts |
| Modify | `messages/ja.json` | i18n keys for navigation + shortcuts |
| Modify | `messages/pt-BR.json` | i18n keys for navigation + shortcuts |
| Modify | `messages/zh-TW.json` | i18n keys for navigation + shortcuts |
| Modify | `package.json` | Add CodeMirror dependencies |

---

### Task 1: Install CodeMirror Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /home/admin/git/note-gen && pnpm add @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/theme-one-dark
```

- [ ] **Step 2: Verify installation**

```bash
cat package.json | grep "@codemirror"
```

Expected: 6 codemirror packages listed (commands + 5 new ones).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add CodeMirror 6 dependencies for source mode"
```

---

### Task 2: Create Shortcut Match Utility

**Files:**
- Create: `src/lib/shortcut-match.ts`

- [ ] **Step 1: Create the utility**

```typescript
// src/lib/shortcut-match.ts

/**
 * Matches a DOM KeyboardEvent against a shortcut config string
 * like "CommandOrControl+T" or "Control+Shift+S".
 */
export function matchesShortcut(event: KeyboardEvent, shortcutValue: string): boolean {
  if (!shortcutValue) return false

  const parts = shortcutValue.split('+').map(p => p.trim().toLowerCase())
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  // Check key match
  if (event.key.toLowerCase() !== key) return false

  // Check modifiers
  const needsCtrl = modifiers.includes('control') || modifiers.includes('commandorcontrol')
  const needsMeta = modifiers.includes('meta') || modifiers.includes('commandorcontrol')
  const needsShift = modifiers.includes('shift')
  const needsAlt = modifiers.includes('alt')

  // CommandOrControl: ctrl on Windows/Linux, meta on macOS
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlOrMeta = isMac ? event.metaKey : event.ctrlKey

  if (modifiers.includes('commandorcontrol')) {
    if (!ctrlOrMeta) return false
  } else {
    if (needsCtrl && !event.ctrlKey) return false
    if (needsMeta && !event.metaKey) return false
  }

  if (needsShift && !event.shiftKey) return false
  if (needsAlt && !event.altKey) return false

  // Reject if extra modifiers are pressed
  if (!needsShift && event.shiftKey) return false
  if (!needsAlt && event.altKey) return false
  if (!modifiers.includes('commandorcontrol')) {
    if (!needsCtrl && event.ctrlKey) return false
    if (!needsMeta && event.metaKey) return false
  }

  return true
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/shortcut-match.ts
git commit -m "feat: add shortcut match utility for in-app keyboard shortcuts"
```

---

### Task 3: Create Source Editor Component

**Files:**
- Create: `src/app/core/main/editor/markdown/source-editor.tsx`

- [ ] **Step 1: Create the CodeMirror wrapper component**

```typescript
// src/app/core/main/editor/markdown/source-editor.tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from 'next-themes'

interface SourceEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  className?: string
}

export function SourceEditor({ initialContent, onChange, className }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { theme, systemTheme } = useTheme()
  const isDark = theme === 'dark' || (theme === 'system' && systemTheme === 'dark')

  const getExtensions = useCallback((dark: boolean) => {
    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      markdown(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString())
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ]

    if (dark) {
      extensions.push(oneDark)
    } else {
      extensions.push(syntaxHighlighting(defaultHighlightStyle))
    }

    return extensions
  }, [])

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: initialContent,
      extensions: getExtensions(isDark),
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // Only mount once

  // Update theme without recreating editor
  useEffect(() => {
    if (!viewRef.current) return

    const view = viewRef.current
    const currentDoc = view.state.doc.toString()

    const state = EditorState.create({
      doc: currentDoc,
      extensions: getExtensions(isDark),
    })

    view.setState(state)
  }, [isDark, getExtensions])

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${className || ''}`}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/core/main/editor/markdown/source-editor.tsx
git commit -m "feat: add CodeMirror 6 source editor component with markdown highlighting"
```

---

### Task 4: Add Shortcut Store Entry

**Files:**
- Modify: `src/stores/shortcut.ts`

- [ ] **Step 1: Add toggleSourceMode to defaultShortcuts array**

In `src/stores/shortcut.ts`, add a new entry to the `defaultShortcuts` array (after `quickRecordText`):

```typescript
const defaultShortcuts: Shortcut[] = [
  {
    key: "openWindow",
    value: "CommandOrControl+Shift+W"
  },
  {
    key: 'quickRecordText',
    value: 'CommandOrControl+Shift+T'
  },
  {
    key: 'toggleSourceMode',
    value: 'CommandOrControl+T'
  }
]
```

Note: `toggleSourceMode` is an in-app shortcut. The existing `bindShortcut` function will attempt to register it as a global shortcut via Tauri, but since we handle it in-app via keydown, this is harmless (it provides both global and in-app triggering). However, `CommandOrControl+T` may conflict with browser new-tab. Since this is a Tauri desktop app (not a browser), it's fine.

- [ ] **Step 2: Commit**

```bash
git add src/stores/shortcut.ts
git commit -m "feat: add toggleSourceMode shortcut entry (default Ctrl+T)"
```

---

### Task 5: Add i18n Entries

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh.json`
- Modify: `messages/ja.json`
- Modify: `messages/pt-BR.json`
- Modify: `messages/zh-TW.json`

- [ ] **Step 1: Add navigation key to all 5 message files**

Add `"sourceMode"` and `"wysiwygMode"` to the `navigation` object:

**en.json** navigation additions:
```json
"sourceMode": "Source Mode",
"wysiwygMode": "Rich Text Mode"
```

**zh.json** navigation additions:
```json
"sourceMode": "源码模式",
"wysiwygMode": "富文本模式"
```

**ja.json** navigation additions:
```json
"sourceMode": "ソースモード",
"wysiwygMode": "リッチテキストモード"
```

**pt-BR.json** navigation additions:
```json
"sourceMode": "Modo Fonte",
"wysiwygMode": "Modo Rich Text"
```

**zh-TW.json** navigation additions:
```json
"sourceMode": "原始碼模式",
"wysiwygMode": "富文本模式"
```

- [ ] **Step 2: Add shortcuts entries to all 5 message files**

Add `"toggleSourceMode"` to `settings.shortcuts.shortcuts`:

**en.json** shortcuts addition:
```json
"toggleSourceMode": {
  "title": "Toggle Source Mode",
  "desc": "Switch between rich text editor and Markdown source mode."
}
```

**zh.json** shortcuts addition:
```json
"toggleSourceMode": {
  "title": "切换源码模式",
  "desc": "在富文本编辑器和 Markdown 源码模式之间切换。"
}
```

**ja.json** shortcuts addition:
```json
"toggleSourceMode": {
  "title": "ソースモード切替",
  "desc": "リッチテキストエディタとMarkdownソースモードを切り替えます。"
}
```

**pt-BR.json** shortcuts addition:
```json
"toggleSourceMode": {
  "title": "Alternar Modo Fonte",
  "desc": "Alternar entre editor rich text e modo fonte Markdown."
}
```

**zh-TW.json** shortcuts addition:
```json
"toggleSourceMode": {
  "title": "切換原始碼模式",
  "desc": "在富文本編輯器和 Markdown 原始碼模式之間切換。"
}
```

- [ ] **Step 3: Commit**

```bash
git add messages/
git commit -m "feat: add i18n entries for source mode toggle"
```

---

### Task 6: Add Toggle Button to Title Bar

**Files:**
- Modify: `src/components/title-bar.tsx`

- [ ] **Step 1: Add Code2 icon import**

In `src/components/title-bar.tsx` line 7, add `Code2` to the lucide-react import:

```typescript
import { Search, Settings, Minus, Square, X, PanelLeft, PanelRight, SquarePen, Cog, CalendarDays, Code2 } from 'lucide-react'
```

- [ ] **Step 2: Add emitter import**

Add after existing imports (around line 16):

```typescript
import emitter from '@/lib/emitter'
```

- [ ] **Step 3: Add sourceMode state and listener**

Inside the `TitleBar` component function body (after `const { leftSidebarVisible, ... }` around line 55), add:

```typescript
const [sourceMode, setSourceMode] = useState(false)

useEffect(() => {
  const handleSourceModeChanged = (active: boolean) => {
    setSourceMode(active)
  }
  emitter.on('source-mode-changed', handleSourceModeChanged as any)
  return () => {
    emitter.off('source-mode-changed', handleSourceModeChanged as any)
  }
}, [])
```

- [ ] **Step 4: Add the source mode button before the center panel toggle**

Insert this JSX block **before** the `{/* 中间面板切换按钮 */}` comment (line 281):

```tsx
{/* 源码模式切换按钮 */}
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 ${sourceMode ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
      onClick={() => {
        emitter.emit('toggle-source-mode')
      }}
    >
      <Code2 className="h-4 w-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent side="bottom">
    <p>{sourceMode ? t('navigation.wysiwygMode') : t('navigation.sourceMode')}</p>
  </TooltipContent>
</Tooltip>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/title-bar.tsx
git commit -m "feat: add source mode toggle button in title bar"
```

---

### Task 7: Integrate Source Mode into Editor Layout

**Files:**
- Modify: `src/app/core/main/editor/editor-layout.tsx`

- [ ] **Step 1: Add imports**

At the top of `editor-layout.tsx`, add these imports:

```typescript
import { SourceEditor } from './markdown/source-editor'
import { matchesShortcut } from '@/lib/shortcut-match'
import useShortcutStore from '@/stores/shortcut'
```

- [ ] **Step 2: Add source mode state and event wiring**

Inside the `EditorLayout` component, after the existing state declarations (around line 76), add:

```typescript
const [sourceMode, setSourceMode] = useState(false)
const sourceContentRef = useRef<string>('')
const { shortcuts } = useShortcutStore()

// Get the configured shortcut value for toggleSourceMode
const sourceModeShortcut = shortcuts.find(s => s.key === 'toggleSourceMode')?.value || 'CommandOrControl+T'

// Toggle source mode handler
const handleToggleSourceMode = useCallback(() => {
  setSourceMode(prev => {
    const next = !prev
    if (next) {
      // Entering source mode: get current markdown from TipTap
      emitter.emit('editor-get-content', {
        resolve: (data: { markdown: string }) => {
          sourceContentRef.current = data.markdown
        }
      })
    } else {
      // Leaving source mode: push source content back to TipTap
      if (sourceContentRef.current) {
        emitter.emit('external-content-update', sourceContentRef.current)
      }
    }
    emitter.emit('source-mode-changed', next)
    return next
  })
}, [])

// Listen for toggle-source-mode event from title bar button
useEffect(() => {
  emitter.on('toggle-source-mode', handleToggleSourceMode)
  return () => {
    emitter.off('toggle-source-mode', handleToggleSourceMode)
  }
}, [handleToggleSourceMode])

// In-app keyboard shortcut listener
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (matchesShortcut(e, sourceModeShortcut)) {
      e.preventDefault()
      handleToggleSourceMode()
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [sourceModeShortcut, handleToggleSourceMode])

// Track source editor content changes
const handleSourceContentChange = useCallback((content: string) => {
  sourceContentRef.current = content
  // Also save to disk (same as TipTap onChange)
  const currentTab = tabs.find(t => t.id === localActiveTabId)
  if (currentTab && tabContentsRef.current) {
    tabContentsRef.current[currentTab.path] = content
    useArticleStore.getState().saveCurrentArticle(content)
  }
}, [tabs, localActiveTabId])
```

- [ ] **Step 3: Modify renderContentPanel to support source mode**

Replace the existing `renderContentPanel` callback (around line 505) with:

```typescript
const renderContentPanel = useCallback((tab: TabInfo, isActive: boolean) => {
  const itemType = getItemType(tab.path)

  return (
    <div
      key={tab.id}
      className="flex min-h-0 flex-1 overflow-hidden"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      {itemType === 'folder' && (
        <FolderView folderPath={tab.path} />
      )}
      {itemType === 'image' && (
        <ImageEditor filePath={tab.path} />
      )}
      {itemType === 'markdown' && !sourceMode && (
        <MdEditor
          key={tab.id}
          tabContentsRef={tabContentsRef}
          filePath={tab.path}
        />
      )}
      {itemType === 'markdown' && sourceMode && (
        <SourceEditor
          initialContent={sourceContentRef.current}
          onChange={handleSourceContentChange}
          className="flex-1"
        />
      )}
      {itemType === 'unknown' && (
        <UnsupportedFile filePath={tab.path} />
      )}
    </div>
  )
}, [getItemType, sourceMode, handleSourceContentChange])
```

- [ ] **Step 4: Reset source mode when switching tabs**

In the existing tab switch handler (find `handleTabSwitch`), add source mode reset at the beginning:

```typescript
// Inside handleTabSwitch, add at the top:
if (sourceMode) {
  // Sync back source content before switching tabs
  if (sourceContentRef.current) {
    emitter.emit('external-content-update', sourceContentRef.current)
  }
  setSourceMode(false)
  emitter.emit('source-mode-changed', false)
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/editor/editor-layout.tsx
git commit -m "feat: integrate source mode toggle into editor layout"
```

---

### Task 8: Verify and Test

- [ ] **Step 1: Run the dev server**

```bash
cd /home/admin/git/note-gen && pnpm dev
```

Verify no build errors.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Fix any lint errors that appear.

- [ ] **Step 3: Run Tauri dev (if possible)**

```bash
pnpm tauri dev
```

Test:
1. Open a markdown file
2. Click the Code2 button in the title bar → should switch to CodeMirror with raw markdown
3. Edit the markdown in source mode
4. Click the button again → should switch back to TipTap with changes preserved
5. Press Ctrl+T → should toggle between modes
6. Go to Settings > Shortcuts → verify "Toggle Source Mode" appears with Ctrl+T default

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve lint/build issues for source mode feature"
```

---

### Task 9: Build Windows Installer

> **Note:** This task requires a Windows environment or Windows CI runner. It cannot be performed on the current Linux machine.

- [ ] **Step 1: On a Windows machine, build the app**

```bash
pnpm install
pnpm tauri build
```

- [ ] **Step 2: Locate the output**

The NSIS installer will be at:
```
src-tauri/target/release/bundle/nsis/NoteGen_<version>_x64-setup.exe
```

- [ ] **Step 3: Verify the installer runs and the source mode feature works**

Install the app, open a markdown file, toggle source mode via button and Ctrl+T.
