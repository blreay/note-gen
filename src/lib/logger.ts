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
  level: string
  dir: string
  maxFileSize: number
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
  private maxFileSize = 10 * 1024 * 1024
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
      if (cfg.dir) {
        this.logDir = cfg.dir
      } else {
        const appData = await appDataDir()
        this.logDir = await join(appData, 'logs')
      }

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

      this.initialized = true

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
      const oldestPath = await this.getRotatedPath(this.maxFiles - 1)
      const oldestExists = await exists(oldestPath)
      if (oldestExists) {
        await remove(oldestPath)
      }

      for (let i = this.maxFiles - 2; i >= 1; i--) {
        const srcPath = await this.getRotatedPath(i)
        const dstPath = await this.getRotatedPath(i + 1)
        const srcExists = await exists(srcPath)
        if (srcExists) {
          await rename(srcPath, dstPath)
        }
      }

      const firstRotated = await this.getRotatedPath(1)
      const currentExists = await exists(this.logFilePath)
      if (currentExists) {
        await rename(this.logFilePath, firstRotated)
      }

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

export const logger = new Logger()
