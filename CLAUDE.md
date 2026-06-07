# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup          # First-time: install deps + generate Prisma client + run migrations
npm run dev            # Start dev server with Turbopack on localhost:3000
npm run build          # Production build
npm run lint           # ESLint
npm run test           # Run all tests (Vitest + jsdom)
npx vitest run src/path/to/file.test.ts   # Run a single test file
npm run db:reset       # Drop and re-migrate the SQLite database (destructive)
```

> **Do not run `npm audit fix`.** Dependencies are pinned to specific working versions; audit fix can bump packages past compatible versions and break the app.

After changing `prisma/schema.prisma`, run:
```bash
npx prisma migrate dev   # Apply migration and regenerate client
npx prisma generate      # Regenerate client only (no migration)
```

The Prisma client is generated into `src/generated/prisma` (not `node_modules`) — import from there or via the `@/lib/prisma` singleton.

## Environment

Copy `.env` and set your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-...
```

If the key is missing or still the placeholder `your-api-key-here`, the app silently falls back to `MockLanguageModel` in `src/lib/provider.ts`, which returns canned counter/form/card components instead of calling Claude.

The real model used is `claude-haiku-4-5` (defined as `MODEL` constant in `src/lib/provider.ts`).

## Architecture

### Virtual File System

The core abstraction is `VirtualFileSystem` (`src/lib/file-system.ts`) — an in-memory tree of `FileNode` objects (files and directories). Generated components are never written to disk; they live entirely in this VFS for the lifetime of a session.

`FileSystemContext` (`src/lib/contexts/file-system-context.tsx`) wraps one `VirtualFileSystem` instance in React state and exposes `handleToolCall`, which is the bridge between AI tool calls and VFS mutations.

### AI Tool Loop

The chat API route (`src/app/api/chat/route.ts`) uses Vercel AI SDK `streamText` with two tools:

- **`str_replace_editor`** (`src/lib/tools/str-replace.ts`) — create files, str_replace edits, insert at line
- **`file_manager`** (`src/lib/tools/file-manager.ts`) — rename and delete files

The system prompt is in `src/lib/prompts/generation.tsx` and is marked for Anthropic prompt caching (`cacheControl: ephemeral`). The full VFS state is serialized and sent with every request via `fileSystem.serialize()` in the request body.

On the client, `ChatContext` (`src/lib/contexts/chat-context.tsx`) calls `useAIChat` from `@ai-sdk/react`, forwarding each `onToolCall` event to `handleToolCall` so the VFS updates live as Claude streams.

### Live Preview

`PreviewFrame` (`src/components/preview/PreviewFrame.tsx`) renders an `<iframe>` whose `srcdoc` is rebuilt on every VFS change (`refreshTrigger`). The preview pipeline is:

1. `createImportMap` (`src/lib/transform/jsx-transformer.ts`) — transforms each `.jsx/.tsx` file with Babel Standalone, creates a blob URL per file, and builds an ES module import map. Third-party packages are resolved via `https://esm.sh/`. Missing local imports get stub placeholder modules.
2. `createPreviewHTML` — emits an HTML document with the import map, inlined CSS, and a `<script type="module">` that imports the entry point (default `/App.jsx`) and mounts it via `ReactDOM.createRoot`.
3. The iframe runs with `allow-scripts allow-same-origin allow-forms` sandbox and Tailwind CSS via CDN.

### Persistence

Authenticated users' projects are saved to SQLite via Prisma. `Project.messages` and `Project.data` are JSON strings — messages array and serialized VFS respectively. Auth uses JWT via `jose`; passwords are hashed with `bcrypt`. Session handling is in `src/lib/auth.ts`.

Anonymous work is tracked in `src/lib/anon-work-tracker.ts` (localStorage) so it can be saved when the user later signs up.

Routes:
- `/` — new session, anonymous or authenticated
- `/[projectId]` — loads an existing project with its messages and file state

### Testing

Tests use Vitest + jsdom + `@testing-library/react`. Test files live in `__tests__/` subdirectories alongside the code they test. The `vite-tsconfig-paths` plugin resolves `@/` aliases inside tests.
