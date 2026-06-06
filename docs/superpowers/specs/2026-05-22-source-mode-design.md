# Source Mode Toggle for Markdown Editor

## Overview

Add a source mode that shows raw Markdown text in a CodeMirror 6 editor with syntax highlighting. Users can toggle between the WYSIWYG (TipTap) view and source mode via a button in the title bar or a configurable keyboard shortcut (default: Ctrl+T).

## Requirements

1. A "Source Mode" toggle button in the title bar, positioned to the **left** of the center panel toggle button (SquarePen icon).
2. In source mode, the TipTap editor is hidden and replaced by a CodeMirror 6 editor displaying raw Markdown with syntax highlighting.
3. Source mode is fully editable — changes sync back to TipTap when switching modes.
4. A configurable application-level keyboard shortcut (default `Ctrl+T`) toggles source mode. The shortcut is configurable in Settings > Shortcuts.
5. The toggle state is per-session (not persisted across app restarts).

## Architecture

### State Management

A new event `toggle-source-mode` on the existing emitter bus triggers the mode switch. The `editor-layout.tsx` component owns the `sourceMode: boolean` state.

### New Components

**`src/app/core/main/editor/markdown/source-editor.tsx`**

A CodeMirror 6 wrapper component:
- Props: `initialContent: string`, `onChange: (content: string) => void`, `className?: string`
- Extensions: `@codemirror/lang-markdown` (syntax highlighting), `@codemirror/commands` (standard keymaps), `@codemirror/theme-one-dark` (dark theme support, respects app theme)
- Uses `EditorView.updateListener` to emit changes via `onChange`

### Modified Components

**`src/components/title-bar.tsx`**

Add a new button before the center panel toggle button (line ~281):
- Icon: `Code2` from lucide-react
- Tooltip: "Source Mode" / "源码模式" (i18n key: `navigation.toggleSourceMode`)
- Active state styling when source mode is on
- Emits `toggle-source-mode` event on click

**`src/app/core/main/editor/editor-layout.tsx`**

- New state: `const [sourceMode, setSourceMode] = useState(false)`
- Listen for `toggle-source-mode` event to toggle state
- Listen for application-level keyboard shortcut (keydown on window)
- When `sourceMode` is true: hide `<MdEditor>`, show `<SourceEditor>` with current markdown content
- On toggle back: pass CodeMirror content to TipTap via `emitter.emit('external-content-update', content)`

**`src/stores/shortcut.ts`**

Add a new default shortcut entry:
```typescript
{
  key: "toggleSourceMode",
  value: "CommandOrControl+T"
}
```

Note: Since this is an **in-app shortcut** (not a global OS-level shortcut), it will NOT be registered via `@tauri-apps/plugin-global-shortcut`. Instead, `editor-layout.tsx` reads the configured value from the shortcut store and matches it against DOM `keydown` events. The shortcut store is reused for storage and UI configuration only.

### i18n

Add keys to all message files (`messages/{en,zh,ja,pt-BR,zh-TW}.json`):

- `navigation.toggleSourceMode` — button tooltip
- `settings.shortcuts.shortcuts.toggleSourceMode.title` — shortcut setting title
- `settings.shortcuts.shortcuts.toggleSourceMode.desc` — shortcut setting description

### New Dependencies

Install:
```
@codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/theme-one-dark
```

Already present: `@codemirror/commands`

### Data Flow

```
WYSIWYG → Source Mode:
  1. editor-layout reads current markdown from TipTap via emitter('editor-get-content')
  2. Passes markdown string to SourceEditor as initialContent
  3. Hides TipTap, shows SourceEditor

Source Mode → WYSIWYG:
  1. SourceEditor's latest content is tracked via onChange callback (stored in ref)
  2. On toggle back, emit 'external-content-update' with latest source content
  3. Hide SourceEditor, show TipTap (which updates via the existing external-content-update handler)
```

### Theme Integration

CodeMirror theme follows the app's dark/light mode:
- Light mode: default CodeMirror theme
- Dark mode: `@codemirror/theme-one-dark`
- Read current theme from `next-themes` `useTheme()` hook

### Keyboard Shortcut Implementation

In `editor-layout.tsx`:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Match configured shortcut (parse from store value like "CommandOrControl+T")
    if (matchesShortcut(e, shortcutValue)) {
      e.preventDefault()
      setSourceMode(prev => !prev)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [shortcutValue])
```

A utility function `matchesShortcut(event, configuredValue)` parses the Electron-style shortcut string (`CommandOrControl+T`) and matches against the DOM KeyboardEvent.

### File Save Behavior

Source mode changes trigger the same `handleContentChange` callback as TipTap — the markdown text is saved to disk on each edit (debounced), same as current behavior.

## Windows Build

Run `pnpm tauri build` on a Windows machine (or CI with Windows runner). Output is an NSIS installer `.exe` in `src-tauri/target/release/bundle/nsis/`. The current Linux environment cannot cross-compile to Windows — this step requires a Windows environment.

## Out of Scope

- Split view (side-by-side source + preview) — not requested
- Persisting source mode preference across sessions
- Mobile source mode (mobile uses different editor layout)
- Line numbers in source editor (CodeMirror shows them by default, no extra work needed)
