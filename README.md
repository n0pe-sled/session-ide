# dsh-session-ide

A dsh bundle that adds an **IDE** tab to every session in the web GUI: a
VS-Codium-style code editor (Monaco — the editor component of VS Code and its
Codium builds) bound to the session's workspace, with the chat moved into a
right-hand column exactly like Copilot in VS Code.

## What it does

- New tab in each session's view ring (`'conversation.view'` slot, after Chat,
  Trajectory, and Shell) — labeled **IDE**.
- **Explorer** panel listing the session's workspace (`SessionHeader.cwd`),
  with lazy directory expansion, file open, and a Monaco editor pane that
  highlights by file extension (bash, ts, js, python, json, markdown, ...).
- **Editor tab strip** with dirty markers, Ctrl/Cmd+S (or the Save button),
  and a VS Code Dark+ status bar.
- **Assistant panel on the right** (toggleable), Copilot-style: it renders the
  live conversation (user / assistant / context / error nodes, tool calls as
  chips, streaming `MarkdownText` replies) and carries its own composer wired
  to the same per-session input machine the Chat tab uses — drafts and sent
  messages are continuous between tabs, and the ordinary prompt bar hides
  while the IDE tab is active (`data-conversation-composer-hidden`).
- Files are listed/read/written **host-side** through a Typert remote
  (`sessionIde`), scoped and contained to the session workspace — no model
  tool, no browser filesystem access.

> Codium-style look, not a Codium fork: this bundles the actual Monaco editor
> (VS Code's editor), plus VS-Codium-like chrome (activity bar, explorer,
> tabs, status bar) and the Copilot-style chat rail. Nothing is shipped to or
> fetched from an external CDN — the whole editor lives inside the plugin
> bundle.

## Install

```sh
dsh plugin --profile web add /path/to/session-ide
# restart the GUI: dsh web
```

The bundle uses `@deepseek-ai` peers (cordis, dsh-session, dsh-typert-
protocol/registry) resolved through the profile fallback, and bundles
`monaco-editor` into `lib/client.js` (~6 MB), so no extra browser assets are
served. The workspace file server is plain `node:fs/promises` — no native
modules.

## Configuration

| key            | default                          | meaning                                       |
|----------------|----------------------------------|-----------------------------------------------|
| `enabled`      | `true`                           | host-side switch; `false` refuses list/read/write |
| `writable`     | `true`                           | `false` = read-only browsing                  |
| `maxReadBytes` | `1048576` (1 MiB)                | per-file read cap                             |
| `maxWriteBytes`| `4194304` (4 MiB)                | per-file write cap                            |
| `ignore`       | `node_modules, .git, dist, ...`  | entry basenames hidden from the explorer      |

Example profile layer override (`$DSH_HOME/cordis.patch.yml`):

```yaml
- id: session-ide
  name: dsh-session-ide
  config:
    writable: false
    ignore: [node_modules, .git]
```

## Architecture

- **Host half** (`src/index.ts`, `src/ide-files.ts`): a Typert receiver
  (`sessionIde`) registered with `ctx.typert` — the web gateway dispatches
  `/api/sessionIde/{list,read,write}` to it. Every operation resolves the
  session's canonical working directory, resolves the requested path
  lexically BEHIND workspaces root (no `..`, no absolute paths), then checks
  the `realpath` so a symlink inside the workspace cannot smuggle a read or
  write outside it. Binary files (NUL bytes) answer `binary: true` with
  empty content; sizes are capped.
- **Browser half** (`src/client/`): registers the tab and mounts the
  descriptors with `ctx.remote.$mount`; the component renders Monaco
  (bundled, no workers — tokenization runs on the main thread) and the
  explorer/assistant panels. Open tabs, dirty flags, and tree slots live in a
  per-session declared store, so they survive view switches; file content
  lives in Monaco's in-memory models keyed by path.
- The chat rail reads the live conversation through the same framework hooks
  the view slot already receives (`useSession`, `useInput`, `inputActions`) —
  no duplicated state, no cross-package imports.

## Security notes

- The IDE reads and writes the session workspace **as the dsh host process
  user**, with the same effective access the agent's tools already have for
  that session — no model interaction required, but also no sandbox beyond
  the workspace containment above (symlink and traversal checks are defense
  in depth; `writable: false` makes it review-only).
- Only people who already have access to the web GUI can use it. Disable
  globally with `enabled: false` if that is too broad for a deployment.
- Monaco runs without worker-based language services: no editor workers are
  fetched or spawned (a no-op `getWorker` shim is installed), so nothing
  leaves the bundle.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run build
node tests/smoke.mjs
node tests/integration.mjs   # real IdeFileManager round-trips, containment, caps
```

The browser half's `tsdown.config.ts` adds two small rolldown plugins: it
rewrites Monaco's `esm` deep imports (beyond the package's exports map) and
inlines Monaco's `.css` imports as injected `<style>` tags with every
relative `url(...)` (codicon font, small SVGs) rewritten to a `data:` URI —
`lib/client.js` is a single self-contained file.
