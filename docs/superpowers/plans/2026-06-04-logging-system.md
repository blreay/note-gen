# Logging System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a file-based logging system with 5-level log severity, file rotation, settings UI, and full Agent execution chain tracing.

**Architecture:** A singleton `Logger` class in `src/lib/logger.ts` writes log lines to `{appDataDir}/logs/notegen.log` via Tauri FS `writeTextFile` (append mode). File rotation is size-based. Settings are persisted in `store.json` and exposed in the General Settings UI. Agent tracing is implemented as `debug`/`trace` level calls at ~58 instrumentation points across 5 files.

**Tech Stack:** TypeScript, Tauri FS API (`@tauri-apps/plugin-fs`), Tauri path API (`@tauri-apps/api/path`), Zustand store, shadcn/ui components (Select, Input, Item), next-intl i18n.

**Spec:** `docs/superpowers/specs/2026-06-04-logging-system-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/logger.ts` | Logger singleton: level gating, formatting, file writing, rotation, child loggers, pre-init queue |
| `src/app/core/setting/general/interface-settings/logging-settings.tsx` | Settings UI: 4 config items (level, dir, max size, max files) |

### Modified files

| File | Changes |
|------|---------|
| `src/stores/setting.ts` | Add 4 fields + 4 setters + logger init call in `initSettingData` + subscribe for hot-reload |
| `src/app/core/setting/general/interface-settings/index.tsx` | Import and render `<LoggingSettings />` |
| `messages/zh.json` | Add `settings.general.interface.logging.*` keys |
| `messages/en.json` | Same |
| `messages/ja.json` | Same |
| `messages/pt-BR.json` | Same |
| `messages/zh-TW.json` | Same |
| `src/lib/agent/react.ts` | ~30 debug/trace instrumentation points |
| `src/lib/agent/agent-handler.ts` | ~8 debug instrumentation points |
| `src/lib/agent/tool-policy.ts` | ~4 debug instrumentation points |
| `src/app/core/main/chat/chat-send.tsx` | ~10 debug instrumentation points |
| `src/lib/ai/chat.ts` | ~6 debug instrumentation points |

---

### Task 1: Logger Core Module

**Files:**
- Create: `src/lib/logger.ts`

- [ ] **Step 1: Create `src/lib/logger.ts` with the complete Logger implementation**

```typescript
import { writeTextFile, mkdir, exists, stat, rename, remove } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

// ── Log Levels ──────────────────────────────────────────────────────

export enum LogLevel {
  ERROR = 0,
  WARN  = 1,
  INFO  = 2,
  DEBUG = 3,
  TRACE = 4,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]:  'WARN',
  [LogLevel.INFO]:  'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.TRACE]: 'TRACE',
}

export function parseLogLevel(str: string): LogLevel {
  switch (str.toLowerCase()) {
    case 'error': return LogLevel.ERROR
    case 'warn':  return LogLevel.WARN
    case 'info':  return LogLevel.INFO
    case 'debug': return LogLevel.DEBUG
    case 'trace': return LogLevel.TRACE
    default:      return LogLevel.ERROR
  }
}

// ── Config ──────────────────────────────────────────────────────────

export interface LoggerConfig {
  level: string       // 'error' | 'warn' | 'info' | 'debug' | 'trace'
  dir: string         // empty string = default ({appDataDir}/logs)
  maxFileSize: number  // MB
  maxFiles: number
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'error',
  dir: '',
  maxFileSize: 10,
  maxFiles: 5,
}

const LOG_FILE_NAME = 'notegen.log'
const PRE_INIT_QUEUE_MAX = 100

// ── ChildLogger ─────────────────────────────────────────────────────

export class ChildLogger {
  private parent: Logger
  private module: string

  constructor(parent: Logger, module: string) {
    this.parent = parent
    this.module = module
  }

  error(...args: unknown[]) { this.parent.writeLog(LogLevel.ERROR, this.module, args) }
  warn(...args: unknown[])  { this.parent.writeLog(LogLevel.WARN,  this.module, args) }
  info(...args: unknown[])  { this.parent.writeLog(LogLevel.INFO,  this.module, args) }
  debug(...args: unknown[]) { this.parent.writeLog(LogLevel.DEBUG, this.module, args) }
  trace(...args: unknown[]) { this.parent.writeLog(LogLevel.TRACE, this.module, args) }

  isDebugEnabled(): boolean { return this.parent.isDebugEnabled() }
  isTraceEnabled(): boolean { return this.parent.isTraceEnabled() }
}

// ── Logger ──────────────────────────────────────────────────────────

class Logger {
  private level: LogLevel = LogLevel.ERROR
  private logDir = ''
  private logFilePath = ''
  private maxFileSize = 10 * 1024 * 1024  // bytes
  private maxFiles = 5
  private currentFileSize = 0
  private initialized = false
  private preInitQueue: string[] = []
  private errorReported = false
  private rotating = false

  async init(config?: Partial<LoggerConfig>): Promise<void> {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    this.level = parseLogLevel(cfg.level)
    this.maxFileSize = cfg.maxFileSize * 1024 * 1024
    this.maxFiles = cfg.maxFiles

    try {
      // Resolve log directory
      if (cfg.dir) {
        this.logDir = cfg.dir
      } else {
        const appData = await appDataDir()
        this.logDir = await join(appData, 'logs')
      }

      // Ensure directory exists
      const dirExists = await exists(this.logDir)
      if (!dirExists) {
        await mkdir(this.logDir, { recursive: true })
      }

      // Resolve log file path
      this.logFilePath = await join(this.logDir, LOG_FILE_NAME)

      // Read current file size if file exists
      const fileExists = await exists(this.logFilePath)
      if (fileExists) {
        try {
          const fileStat = await stat(this.logFilePath)
          this.currentFileSize = fileStat.size
        } catch {
          this.currentFileSize = 0
        }
      } else {
        this.currentFileSize = 0
      }

      this.initialized = true

      // Flush pre-init queue
      if (this.preInitQueue.length > 0) {
        const lines = this.preInitQueue.join('')
        this.preInitQueue = []
        this.appendToFile(lines)
      }
    } catch (error) {
      console.error('[Logger] init failed:', error)
      this.initialized = false
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  error(...args: unknown[]) { this.writeLog(LogLevel.ERROR, '', args) }
  warn(...args: unknown[])  { this.writeLog(LogLevel.WARN,  '', args) }
  info(...args: unknown[])  { this.writeLog(LogLevel.INFO,  '', args) }
  debug(...args: unknown[]) { this.writeLog(LogLevel.DEBUG, '', args) }
  trace(...args: unknown[]) { this.writeLog(LogLevel.TRACE, '', args) }

  child(module: string): ChildLogger {
    return new ChildLogger(this, module)
  }

  isDebugEnabled(): boolean { return this.level >= LogLevel.DEBUG }
  isTraceEnabled(): boolean { return this.level >= LogLevel.TRACE }

  // ── Config hot-reload ───────────────────────────────────────────

  setLevel(level: string): void {
    this.level = parseLogLevel(level)
  }

  async setDir(dir: string): Promise<void> {
    if (dir) {
      this.logDir = dir
    } else {
      const appData = await appDataDir()
      this.logDir = await join(appData, 'logs')
    }

    try {
      const dirExists = await exists(this.logDir)
      if (!dirExists) {
        await mkdir(this.logDir, { recursive: true })
      }
      this.logFilePath = await join(this.logDir, LOG_FILE_NAME)

      const fileExists = await exists(this.logFilePath)
      if (fileExists) {
        try {
          const fileStat = await stat(this.logFilePath)
          this.currentFileSize = fileStat.size
        } catch {
          this.currentFileSize = 0
        }
      } else {
        this.currentFileSize = 0
      }
    } catch (error) {
      console.error('[Logger] setDir failed:', error)
    }
  }

  setMaxFileSize(sizeMB: number): void {
    this.maxFileSize = sizeMB * 1024 * 1024
  }

  setMaxFiles(count: number): void {
    this.maxFiles = count
  }

  // ── Internal ────────────────────────────────────────────────────

  writeLog(level: LogLevel, module: string, args: unknown[]): void {
    if (level > this.level) return

    const timestamp = new Date().toISOString()
    const levelName = LEVEL_NAMES[level]
    const moduleTag = module ? `[${module}]` : ''
    const message = args.map(a =>
      typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))
    ).join(' ')

    const line = `${timestamp} [${levelName}] ${moduleTag} ${message}\n`

    if (!this.initialized) {
      if (this.preInitQueue.length < PRE_INIT_QUEUE_MAX) {
        this.preInitQueue.push(line)
      }
      return
    }

    // Check size and rotate if needed
    const lineBytes = new TextEncoder().encode(line).length
    if (this.currentFileSize + lineBytes >= this.maxFileSize && !this.rotating) {
      this.rotate()
    }

    this.appendToFile(line)
    this.currentFileSize += lineBytes
  }

  private appendToFile(content: string): void {
    writeTextFile(this.logFilePath, content, { append: true }).catch(error => {
      if (!this.errorReported) {
        console.error('[Logger] write failed:', error)
        this.errorReported = true
      }
    })
  }

  private async rotate(): Promise<void> {
    this.rotating = true
    try {
      // Delete the oldest file if at max
      const oldestPath = await this.getRotatedPath(this.maxFiles - 1)
      const oldestExists = await exists(oldestPath)
      if (oldestExists) {
        await remove(oldestPath)
      }

      // Shift: notegen.3.log → notegen.4.log, etc.
      for (let i = this.maxFiles - 2; i >= 1; i--) {
        const srcPath = await this.getRotatedPath(i)
        const dstPath = await this.getRotatedPath(i + 1)
        const srcExists = await exists(srcPath)
        if (srcExists) {
          await rename(srcPath, dstPath)
        }
      }

      // Current → notegen.1.log
      const firstRotated = await this.getRotatedPath(1)
      const currentExists = await exists(this.logFilePath)
      if (currentExists) {
        await rename(this.logFilePath, firstRotated)
      }

      // Reset counter
      this.currentFileSize = 0
    } catch (error) {
      console.error('[Logger] rotate failed:', error)
    } finally {
      this.rotating = false
    }
  }

  private async getRotatedPath(index: number): Promise<string> {
    return join(this.logDir, `notegen.${index}.log`)
  }
}

// ── Singleton ─────────────────────────────────────────────────────

export const logger = new Logger()
```

- [ ] **Step 2: Run lint to verify**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/logger.ts
git commit -m "feat(logger): add core Logger module with rotation

Singleton Logger with 5-level severity (error/warn/info/debug/trace),
file-based writing via Tauri FS appendFile, size-based rotation,
child loggers for module tagging, pre-init queue, and silent error
degradation. Zero third-party dependencies.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Settings Store Integration

**Files:**
- Modify: `src/stores/setting.ts`

- [ ] **Step 1: Add log config fields to the SettingState interface**

In `src/stores/setting.ts`, add these fields to the `SettingState` interface (after the last field before the closing `}`):

```typescript
  // 日志设置
  logLevel: string
  setLogLevel: (level: string) => Promise<void>
  logDir: string
  setLogDir: (dir: string) => Promise<void>
  logMaxFileSize: number
  setLogMaxFileSize: (size: number) => Promise<void>
  logMaxFiles: number
  setLogMaxFiles: (count: number) => Promise<void>
```

- [ ] **Step 2: Add default values and setter implementations**

In the `create(...)` body (after the last setter before the closing `})`), add:

```typescript
  // 日志设置
  logLevel: 'error',
  setLogLevel: async (logLevel: string) => {
    set({ logLevel })
    const store = await Store.load('store.json')
    await store.set('logLevel', logLevel)
    await store.save()
  },
  logDir: '',
  setLogDir: async (logDir: string) => {
    set({ logDir })
    const store = await Store.load('store.json')
    await store.set('logDir', logDir)
    await store.save()
  },
  logMaxFileSize: 10,
  setLogMaxFileSize: async (logMaxFileSize: number) => {
    set({ logMaxFileSize })
    const store = await Store.load('store.json')
    await store.set('logMaxFileSize', logMaxFileSize)
    await store.save()
  },
  logMaxFiles: 5,
  setLogMaxFiles: async (logMaxFiles: number) => {
    set({ logMaxFiles })
    const store = await Store.load('store.json')
    await store.set('logMaxFiles', logMaxFiles)
    await store.save()
  },
```

- [ ] **Step 3: Add logger init + subscribe in `initSettingData`**

Add this import at the top of `src/stores/setting.ts`:

```typescript
import { logger } from '@/lib/logger'
```

At the **end** of the `initSettingData` function body (after the `Object.entries(get()).forEach(...)` block), add:

```typescript
    // Initialize logger with current config
    const currentState = get()
    await logger.init({
      level: currentState.logLevel,
      dir: currentState.logDir,
      maxFileSize: currentState.logMaxFileSize,
      maxFiles: currentState.logMaxFiles,
    })

    // Subscribe to log config changes for hot-reload
    useSettingStore.subscribe((state, prevState) => {
      if (state.logLevel !== prevState.logLevel) {
        logger.setLevel(state.logLevel)
      }
      if (state.logDir !== prevState.logDir) {
        logger.setDir(state.logDir)
      }
      if (state.logMaxFileSize !== prevState.logMaxFileSize) {
        logger.setMaxFileSize(state.logMaxFileSize)
      }
      if (state.logMaxFiles !== prevState.logMaxFiles) {
        logger.setMaxFiles(state.logMaxFiles)
      }
    })
```

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

- [ ] **Step 5: Commit**

```bash
git add src/stores/setting.ts
git commit -m "feat(settings): add log config fields and logger init

Add logLevel, logDir, logMaxFileSize, logMaxFiles to setting store
with async setters persisting to store.json. Initialize logger in
initSettingData and subscribe for hot-reload on config changes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: i18n Translations

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/pt-BR.json`
- Modify: `messages/zh-TW.json`

- [ ] **Step 1: Add Chinese translations to `messages/zh.json`**

Find the `settings.general.interface` section and add a `logging` key at the same level as `scale`, `contentTextScale`, etc.:

```json
"logging": {
  "title": "日志设置",
  "level": {
    "title": "日志级别",
    "desc": "控制日志记录的详细程度，默认仅记录错误"
  },
  "dir": {
    "title": "日志目录",
    "desc": "日志文件存储位置，留空使用默认路径",
    "placeholder": "留空使用默认路径",
    "selectFolder": "选择文件夹"
  },
  "maxFileSize": {
    "title": "单文件大小上限",
    "desc": "超过此大小自动轮转创建新日志文件"
  },
  "maxFiles": {
    "title": "最大文件数量",
    "desc": "包含当前文件，最多保留的日志文件数"
  }
}
```

- [ ] **Step 2: Add English translations to `messages/en.json`**

```json
"logging": {
  "title": "Logging",
  "level": {
    "title": "Log Level",
    "desc": "Controls logging verbosity, defaults to errors only"
  },
  "dir": {
    "title": "Log Directory",
    "desc": "Where log files are stored, leave empty for default",
    "placeholder": "Leave empty for default path",
    "selectFolder": "Select folder"
  },
  "maxFileSize": {
    "title": "Max File Size",
    "desc": "Automatically rotate when file exceeds this size"
  },
  "maxFiles": {
    "title": "Max File Count",
    "desc": "Maximum number of log files to keep, including current"
  }
}
```

- [ ] **Step 3: Add Japanese translations to `messages/ja.json`**

```json
"logging": {
  "title": "ログ設定",
  "level": {
    "title": "ログレベル",
    "desc": "ログの詳細度を制御します。デフォルトはエラーのみ"
  },
  "dir": {
    "title": "ログディレクトリ",
    "desc": "ログファイルの保存場所。空欄でデフォルトパス",
    "placeholder": "空欄でデフォルトパス",
    "selectFolder": "フォルダを選択"
  },
  "maxFileSize": {
    "title": "ファイルサイズ上限",
    "desc": "このサイズを超えると自動的にローテーション"
  },
  "maxFiles": {
    "title": "最大ファイル数",
    "desc": "現在のファイルを含む、保持するログファイルの最大数"
  }
}
```

- [ ] **Step 4: Add Brazilian Portuguese translations to `messages/pt-BR.json`**

```json
"logging": {
  "title": "Configuração de Log",
  "level": {
    "title": "Nível de Log",
    "desc": "Controla o detalhamento do log, padrão apenas erros"
  },
  "dir": {
    "title": "Diretório de Log",
    "desc": "Onde os arquivos de log são armazenados, deixe vazio para padrão",
    "placeholder": "Deixe vazio para caminho padrão",
    "selectFolder": "Selecionar pasta"
  },
  "maxFileSize": {
    "title": "Tamanho Máximo do Arquivo",
    "desc": "Rotaciona automaticamente quando exceder este tamanho"
  },
  "maxFiles": {
    "title": "Número Máximo de Arquivos",
    "desc": "Número máximo de arquivos de log a manter, incluindo o atual"
  }
}
```

- [ ] **Step 5: Add Traditional Chinese translations to `messages/zh-TW.json`**

```json
"logging": {
  "title": "日誌設定",
  "level": {
    "title": "日誌等級",
    "desc": "控制日誌記錄的詳細程度，預設僅記錄錯誤"
  },
  "dir": {
    "title": "日誌目錄",
    "desc": "日誌檔案儲存位置，留空使用預設路徑",
    "placeholder": "留空使用預設路徑",
    "selectFolder": "選擇資料夾"
  },
  "maxFileSize": {
    "title": "單檔案大小上限",
    "desc": "超過此大小自動輪轉建立新日誌檔案"
  },
  "maxFiles": {
    "title": "最大檔案數量",
    "desc": "包含目前檔案，最多保留的日誌檔案數"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add messages/zh.json messages/en.json messages/ja.json messages/pt-BR.json messages/zh-TW.json
git commit -m "feat(i18n): add logging settings translations for all languages

Add settings.general.interface.logging.* keys for zh, en, ja, pt-BR, zh-TW.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Settings UI Component

**Files:**
- Create: `src/app/core/setting/general/interface-settings/logging-settings.tsx`
- Modify: `src/app/core/setting/general/interface-settings/index.tsx`

- [ ] **Step 1: Create `logging-settings.tsx`**

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { FileText, FolderOpen, HardDrive, Archive } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import { open } from '@tauri-apps/plugin-dialog'

export function LoggingSettings() {
  const t = useTranslations('settings.general.interface')
  const {
    logLevel, setLogLevel,
    logDir, setLogDir,
    logMaxFileSize, setLogMaxFileSize,
    logMaxFiles, setLogMaxFiles,
  } = useSettingStore()

  const handleSelectDir = async () => {
    const selected = await open({ directory: true })
    if (selected) {
      setLogDir(selected)
    }
  }

  return (
    <div className="space-y-4">
      {/* Log Level */}
      <Item variant="outline">
        <ItemMedia variant="icon"><FileText className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.level.title')}</ItemTitle>
          <ItemDescription>{t('logging.level.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={logLevel} onValueChange={setLogLevel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="trace">Trace</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>

      {/* Log Directory */}
      <Item variant="outline">
        <ItemMedia variant="icon"><FolderOpen className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.dir.title')}</ItemTitle>
          <ItemDescription>{t('logging.dir.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <div className="flex items-center gap-2">
            <Input
              value={logDir}
              onChange={(e) => setLogDir(e.target.value)}
              placeholder={t('logging.dir.placeholder')}
              className="w-[240px]"
            />
            <Button variant="outline" size="icon" onClick={handleSelectDir}>
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </ItemActions>
      </Item>

      {/* Max File Size */}
      <Item variant="outline">
        <ItemMedia variant="icon"><HardDrive className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.maxFileSize.title')}</ItemTitle>
          <ItemDescription>{t('logging.maxFileSize.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={String(logMaxFileSize)} onValueChange={(v) => setLogMaxFileSize(Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 MB</SelectItem>
              <SelectItem value="5">5 MB</SelectItem>
              <SelectItem value="10">10 MB</SelectItem>
              <SelectItem value="20">20 MB</SelectItem>
              <SelectItem value="50">50 MB</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>

      {/* Max File Count */}
      <Item variant="outline">
        <ItemMedia variant="icon"><Archive className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.maxFiles.title')}</ItemTitle>
          <ItemDescription>{t('logging.maxFiles.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={String(logMaxFiles)} onValueChange={(v) => setLogMaxFiles(Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
    </div>
  )
}
```

- [ ] **Step 2: Register in `index.tsx`**

In `src/app/core/setting/general/interface-settings/index.tsx`, add the import and component:

```tsx
import { LoggingSettings } from './logging-settings'
```

Add `<LoggingSettings />` at the end of the `<div className="space-y-4">`, after `<CustomThemeSettings />`:

```tsx
<CustomThemeSettings />
<LoggingSettings />
```

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

- [ ] **Step 4: Commit**

```bash
git add src/app/core/setting/general/interface-settings/logging-settings.tsx \
        src/app/core/setting/general/interface-settings/index.tsx
git commit -m "feat(settings): add logging configuration UI

Add LoggingSettings component with 4 config items: log level (Select),
log directory (Input + folder picker), max file size (Select), and
max file count (Select). Follows existing Item component pattern.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Agent Tracing — `react.ts`

**Files:**
- Modify: `src/lib/agent/react.ts`

This is the largest instrumentation task. Add debug/trace level logging at ~30 points across the ReAct loop.

- [ ] **Step 1: Add logger import and child logger at top of file**

Add after the existing imports:

```typescript
import { logger } from '@/lib/logger'
```

Inside the `ReActAgent` class, add a field and initialize in constructor:

```typescript
private log = logger.child('agent/react')
```

- [ ] **Step 2: Instrument `run()` method**

At the start of `run()` (after `this.abortController = new AbortController()`), add:

```typescript
const traceId = `agent-${Date.now()}`
const startTime = Date.now()
this.log.debug(`▶ run start traceId=${traceId} input="${userInput.slice(0, 80)}" inputLen=${userInput.length} maxIter=${this.config.maxIterations}`)
this.log.debug(`  intentPolicy: write=${this.intentPolicy.allowWrite} destructive=${this.intentPolicy.allowDestructive} execute=${this.intentPolicy.allowExecute}`)
```

At the start of each iteration (after `this.currentIteration++`), add:

```typescript
this.log.debug(`── iteration ${this.currentIteration}/${this.config.maxIterations} start ──`)
```

After auto-recovery check succeeds (where `finalAnswer` is set from descriptor), add:

```typescript
this.log.debug(`  auto-recovery triggered, tool=${lastCompletedStep.action.tool} key=${descriptor.key}`)
```

After `hasFinalAnswer` is detected and `finalAnswer` is extracted, add:

```typescript
this.log.debug(`  finalAnswer detected, len=${(finalAnswer || '').length}`)
```

After `validateFinalAnswerReadiness` fails (in the `!finalAnswerValidation.ok` branch), add:

```typescript
this.log.debug(`  finalAnswer validation failed: ${finalAnswerValidation.reason}`)
```

After `parseAction` returns successfully (where `action` is non-null, before duplicate check), add:

```typescript
this.log.debug(`  parseAction: tool=${action.tool} params=${JSON.stringify(Object.keys(action.params))}`)
```

After `parseAction` returns null and the code enters the JSON-error retry path (`thought.includes('Action:')`), add:

```typescript
this.log.debug(`  parseAction: null (Action: present, JSON unparseable) thoughtLen=${thought.length}`)
```

After `parseAction` returns null and the code treats it as final answer (the else branches), add:

```typescript
this.log.debug(`  parseAction: null, no Action: found, treating as finalAnswer, thoughtLen=${thought.length}`)
```

After duplicate action detection triggers, add:

```typescript
this.log.debug(`  duplicate action detected: tool=${action.tool} count=${sameActionCount}`)
```

After `act()` returns, add:

```typescript
this.log.debug(`  act() result: observationLen=${observation.length} hasError=${observation.includes('错误') || observation.includes('失败')}`)
```

After step is recorded (`this.steps.push(...)`), add:

```typescript
this.log.debug(`── iteration ${this.currentIteration}/${this.config.maxIterations} end ──`)
```

At the end of `run()` before returning, add:

```typescript
this.log.debug(`◀ run end traceId=${traceId} iterations=${this.currentIteration} steps=${this.steps.length} resultLen=${finalAnswer.length} elapsed=${Date.now() - startTime}ms`)
```

- [ ] **Step 3: Instrument `buildSystemPrompt()`**

At the end of `buildSystemPrompt()`, before `return prompt`, add:

```typescript
this.log.debug(`  systemPrompt built, len=${prompt.length}`)
```

- [ ] **Step 4: Instrument `think()`**

Before the `fetchAiStream` call (both messages-array and string modes), add:

```typescript
const thinkStart = Date.now()
this.log.debug(`  think() calling LLM, mode=${messages ? 'messages' : 'string'} iter=${this.currentIteration} hasImages=${!!imagesForThisIteration}`)
```

For messages-array mode, before the `fetchAiStream` call, add:

```typescript
if (this.log.isTraceEnabled()) {
  this.log.trace('think() LLM request messages:', JSON.stringify(messagesForAI.map(m => ({ role: m.role, contentLen: typeof m.content === 'string' ? m.content.length : 0 }))))
}
```

After `fetchAiStream` returns (both modes), add:

```typescript
this.log.debug(`  think() LLM responded, responseLen=${response.length} elapsed=${Date.now() - thinkStart}ms`)
if (this.log.isTraceEnabled()) {
  this.log.trace('think() LLM full response:', response)
}
```

In the API error catch blocks, add:

```typescript
this.log.error(`think() API error:`, error instanceof Error ? error.message : String(error))
```

- [ ] **Step 5: Instrument `parseAction()`**

When level 1 matches (standard `Action:` + `Action Input:`), add before the `return`:

```typescript
this.log.debug(`  parseAction: level-1 matched, tool=${tool} paramsKeys=${JSON.stringify(Object.keys(params))}`)
```

When levels 2-6 match, add before each `return`:

```typescript
this.log.debug(`  parseAction: level-N matched, tool=${tool}`)
```

(Replace `N` with the actual level number: 2, 3, 4, 5, or 6.)

At the final `return null` (no match), add:

```typescript
this.log.debug(`  parseAction: no match, thoughtLen=${cleaned.length}`)
```

- [ ] **Step 6: Instrument `act()`**

After policy evaluation, add:

```typescript
this.log.debug(`  act() tool=${toolName} policy: allowed=${policyCheck.allowed} confirmation=${policyCheck.requiresConfirmation} reason=${policyCheck.reason || 'none'}`)
```

If policy blocks, add:

```typescript
this.log.debug(`  act() blocked by policy: ${policyCheck.reason}`)
```

After confirmation result, add:

```typescript
this.log.debug(`  act() confirmation: required=${requiresConfirmation} autoApproval=${!requiresConfirmation}`)
```

After `tool.execute()` returns, add:

```typescript
this.log.debug(`  act() execute result: success=${result.success} observationLen=${observation.length}`)
if (this.log.isTraceEnabled()) {
  this.log.trace(`act() execute params:`, JSON.stringify(params))
  this.log.trace(`act() execute result:`, JSON.stringify(result))
}
```

In the catch block, add:

```typescript
this.log.error(`act() tool=${toolName} exception:`, errorStr)
```

- [ ] **Step 7: Instrument `validateFinalAnswerReadiness()`**

At the end of the method, before returning `{ ok: true }`, add:

```typescript
this.log.debug(`  validateFinalAnswerReadiness: ok=true`)
```

In each failing branch (before returning `{ ok: false, reason }`), add:

```typescript
this.log.debug(`  validateFinalAnswerReadiness: ok=false reason="${reason}"`)
```

(Where `reason` is the variable or inline string from that specific branch.)

- [ ] **Step 8: Run lint**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/agent/react.ts
git commit -m "feat(agent): add debug/trace instrumentation to ReAct loop

Add ~30 logging points across run(), buildSystemPrompt(), think(),
parseAction(), act(), and validateFinalAnswerReadiness(). Debug level
logs structured summaries (method, params, timing, decisions). Trace
level logs full LLM request/response bodies. Zero overhead when log
level is error (default).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Agent Tracing — `agent-handler.ts`

**Files:**
- Modify: `src/lib/agent/agent-handler.ts`

- [ ] **Step 1: Add logger import and child logger**

```typescript
import { logger } from '@/lib/logger'
```

Add as class field:

```typescript
private log = logger.child('agent/handler')
```

- [ ] **Step 2: Instrument `execute()`**

At the start of `execute()`:

```typescript
this.log.debug(`▶ session start input="${userInput.slice(0, 80)}" inputLen=${userInput.length}`)
```

After MCP tools reload:

```typescript
this.log.debug(`  mcpTools reloaded`)
```

After skills loaded:

```typescript
this.log.debug(`  skills loaded: [${activeSkills.join(', ')}] count=${activeSkills.length}`)
```

After `agent.run()` returns:

```typescript
this.log.debug(`  agent.run() returned, resultLen=${result.length}`)
```

In the `onComplete` path:

```typescript
this.log.debug(`◀ session end steps=${steps.length} stopped=false`)
```

In the `USER_STOPPED` catch:

```typescript
this.log.debug(`◀ session stopped by user, steps=${steps.length}`)
```

In the error catch:

```typescript
this.log.error(`session error:`, errorMessage)
```

- [ ] **Step 3: Instrument `stop()`**

```typescript
this.log.debug('stop() called')
```

- [ ] **Step 4: Run lint and commit**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

```bash
git add src/lib/agent/agent-handler.ts
git commit -m "feat(agent): add debug instrumentation to AgentHandler

Add ~8 logging points for session lifecycle: start, MCP/skills load,
run result, completion, user stop, and errors.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Agent Tracing — `tool-policy.ts`

**Files:**
- Modify: `src/lib/agent/tool-policy.ts`

- [ ] **Step 1: Add logger import**

```typescript
import { logger } from '@/lib/logger'

const log = logger.child('agent/policy')
```

- [ ] **Step 2: Instrument `deriveIntentPolicy()`**

At the end of the function, before `return`:

```typescript
log.debug(`deriveIntentPolicy: input="${input.slice(0, 80)}" write=${allowWrite} destructive=${allowDestructive} execute=${allowExecute}`)
```

- [ ] **Step 3: Instrument `evaluateIntentAwareToolPolicy()`**

At the end of the function, before each `return`:

For blocked returns:

```typescript
log.debug(`evaluatePolicy: tool=${toolName} risk=${risk} → blocked, reason="${result.reason}"`)
```

For allowed returns:

```typescript
log.debug(`evaluatePolicy: tool=${toolName} risk=${risk} → allowed, confirmation=${result.requiresConfirmation}`)
```

- [ ] **Step 4: Run lint and commit**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

```bash
git add src/lib/agent/tool-policy.ts
git commit -m "feat(agent): add debug instrumentation to tool policy

Log intent derivation results and policy evaluation decisions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Agent Tracing — `chat-send.tsx`

**Files:**
- Modify: `src/app/core/main/chat/chat-send.tsx`

- [ ] **Step 1: Add logger import**

```typescript
import { logger } from '@/lib/logger'

const log = logger.child('chat')
```

- [ ] **Step 2: Instrument `handleAgentMode()`**

At the start:

```typescript
log.debug(`handleAgentMode: images=${imageUrls.length}`)
```

After context construction for active file:

```typescript
log.debug(`  context: activeFile="${articleStore.activeFilePath}" contextLen=${context.length}`)
```

After RAG retrieval (if enabled):

```typescript
log.debug(`  context: ragEnabled=true keywords=${keywords.length} sources=${ragSources?.length || 0}`)
```

After linked file read:

```typescript
log.debug(`  context: linkedFile="${linkedResource?.name}" contentLen=${linkedFileContent?.length || 0}`)
```

After messages built:

```typescript
log.debug(`  messages built: count=${messages.length}`)
```

- [ ] **Step 3: Instrument `requestConfirmation()`**

At the entry:

```typescript
log.debug(`requestConfirmation: tool=${toolName}`)
```

When auto-approval matches:

```typescript
log.debug(`  autoApproval matched, scope=${sessionApprovalScope?.type}`)
```

When user confirms/cancels (at the resolve point):

```typescript
log.debug(`  user responded: confirmed=${currentState.agentState.isRunning}`)
```

- [ ] **Step 4: Instrument `onComplete()`**

```typescript
log.debug(`onComplete: resultLen=${result.length} stopped=${stopped} steps=${agentState.completedSteps.length}`)
```

- [ ] **Step 5: Run lint and commit**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

```bash
git add src/app/core/main/chat/chat-send.tsx
git commit -m "feat(chat): add debug instrumentation to chat-send

Log agent mode entry, context construction, message building,
confirmation flow, and completion summary.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Agent Tracing — `chat.ts`

**Files:**
- Modify: `src/lib/ai/chat.ts`

- [ ] **Step 1: Add logger import**

```typescript
import { logger } from '@/lib/logger'

const log = logger.child('ai/chat')
```

- [ ] **Step 2: Instrument `fetchAiStream()`**

After AI settings retrieved and request params built:

```typescript
log.debug(`fetchAiStream: model=${requestParams.model} temperature=${requestParams.temperature} messageCount=${preparedMessages.length} hasTools=${!!requestParams.tools}`)
```

After stream loop ends:

```typescript
log.debug(`fetchAiStream: complete contentLen=${fullContent.length} thinkingLen=${thinking.length} toolCalls=${toolCalls.length}`)
```

When MCP tool is called:

```typescript
log.debug(`  MCP tool call: ${serverId}/${toolName}`)
```

When MCP tool returns:

```typescript
log.debug(`  MCP tool result: success=${!error} resultLen=${resultText.length}`)
```

When MCP loop reaches max iterations:

```typescript
log.warn(`fetchAiStream: MCP tool loop reached max iterations (${maxIterations})`)
```

In the top-level catch:

```typescript
log.error(`fetchAiStream error:`, error instanceof Error ? error.message : String(error))
```

- [ ] **Step 3: Run lint and commit**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

```bash
git add src/lib/ai/chat.ts
git commit -m "feat(ai): add debug instrumentation to fetchAiStream

Log LLM call params, streaming completion stats, MCP tool calls,
and errors.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full lint**

Run: `pnpm lint`
Expected: ✔ No ESLint warnings or errors

- [ ] **Step 2: Verify all files are committed**

Run: `git status`
Expected: working tree clean

- [ ] **Step 3: Push all commits**

```bash
git push origin feature/source-mode-switch
```
