# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NoteGen is a cross-platform Markdown note-taking app with AI features. It's built with **Tauri 2** (Rust backend) + **Next.js 15** (React frontend). The app runs as a desktop app (Windows/macOS/Linux) and mobile app (Android/iOS) — the frontend is a static Next.js export served by Tauri's webview.

## Commands

```bash
pnpm dev              # Start Next.js dev server (port 3456, Turbopack)
pnpm build            # Build frontend (static export to ./out)
pnpm lint             # ESLint
pnpm tauri dev        # Full app dev (starts frontend + Rust backend together)
pnpm tauri build      # Production build (desktop installer)
```

For Rust backend changes, `pnpm tauri dev` is required — it compiles Rust and launches the Tauri window with hot-reload on the frontend.

## Architecture

### Frontend (`src/`)

- **`src/app/core/`** — Desktop UI layout. Main pages: `chat` (AI dialogue), `editor` (Markdown notes), `file` (file tree), `mark` (recording/capture). Settings pages under `core/setting/`.
- **`src/app/mobile/`** — Mobile UI layout (separate routes for chat, record, writing, setting).
- **`src/lib/`** — Core business logic, organized by domain:
  - `ai/` — AI chat, completion, embedding, rewrite, translate (uses OpenAI-compatible SDK)
  - `agent/` — ReAct agent framework with tool calling (tools defined in `agent/tools/`)
  - `sync/` — Remote sync backends (GitHub, Gitee, GitLab, Gitea, S3, WebDAV)
  - `mcp/` — Model Context Protocol client/server integration
  - `imageHosting/` — Image upload providers
  - `skills/` — Agent skill definitions
- **`src/stores/`** — Zustand state stores (one per domain: article, chat, mark, mcp, etc.)
- **`src/db/`** — SQLite database layer via `@tauri-apps/plugin-sql`. Tables: chats, conversations, marks, notes, tags, vector, memories, activity.
- **`src/components/ui/`** — shadcn/ui components (new-york style, Tailwind CSS v4)
- **`src/i18n/`** — next-intl setup; locale files in `messages/` (zh, en, ja, pt-BR, zh-TW)

### Backend (`src-tauri/`)

Rust backend providing native capabilities:
- `ai.rs` — AI streaming proxy
- `mcp.rs` / `mcp_runtime.rs` — MCP server lifecycle
- `screenshot.rs` — Screen capture (xcap)
- `fuzzy_search.rs` — Fast fuzzy matching (jieba for Chinese tokenization)
- `skills.rs` — Skill file management
- `window.rs` / `tray.rs` / `statusbar.rs` — Native window/tray management

### Key patterns

- **Static export**: Next.js is configured with `output: "export"` — no server-side features (no API routes, no SSR). All data fetching happens client-side via Tauri plugins.
- **Tauri plugins for system access**: File system, HTTP, clipboard, shell, dialog, global shortcuts, window state, updater — all accessed through `@tauri-apps/plugin-*` packages.
- **Path alias**: `@/*` maps to `./src/*`.
- **Event bus**: `mitt` for cross-component communication (see `src/config/emitters.ts`).

## Conventions

- UI components come from shadcn/ui — add new ones via `npx shadcn@latest add <component>`.
- Icons use `lucide-react`.
- State that persists across app restarts uses `@tauri-apps/plugin-store` (key-value) or SQLite (structured data).
- All AI provider integrations use the OpenAI SDK format — the app is model/provider agnostic.
- i18n: all user-facing strings must go through `next-intl`. Chinese (`zh.json`) is the primary locale.
- The `docs/` directory is a separate VitePress documentation site — excluded from the main TypeScript compilation and ESLint.
