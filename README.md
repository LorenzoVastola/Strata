# Strata

> A desktop IDE that unifies the four tools backend developers juggle every day — **code editor, database client, HTTP client, and integrated terminal** — and lets an AI agent operate across all of them through a single, stateful environment.

Strata collapses the daily context-switch between Cursor, DBeaver, and Postman into one application. Its core thesis is that an AI agent shouldn't just *write* code in an editor — it should be able to generate code, send a request to test it, and verify the result against the live database, all in one flow, without the developer manually carrying state between three separate tools.

<!-- Replace with a real screenshot or demo GIF -->
<!-- ![Strata](docs/demo.gif) -->

---

## Why

On a typical backend task the loop looks like this: write the endpoint in the editor → switch to Postman to fire a request → switch to a DB client to confirm the row landed correctly → back to the editor to fix the model. Three tools, three windows, state copied by hand between them.

Strata keeps editor, terminal, database, HTTP collections, and Git in one window — and exposes the live state of each to an AI agent so the round-trip happens without the manual bridge.

---

## Features

### Editor
Monaco-based editor with multi-tab and split view, TypeScript IntelliSense and diagnostics, cross-file go-to-definition, breadcrumbs, sticky scroll, minimap, code folding, find/replace, and a command palette.

### File explorer
File-type icons, full context menu, drag & drop, and resizable panels.

### Integrated terminal
Real shell via `node-pty` + `xterm.js`, with multiple tabs, split panes, a shell selector, and a quick-open shortcut.

### Database panel
Connections for MySQL and PostgreSQL, a schema tree, table browsing with Data/Properties tabs, and a multi-statement SQL editor.

### HTTP panel
Postman-style client with collections, environments using `{{variable}}` interpolation, request history, cURL import/export, and auth handling.

### Git panel
Lives in the sidebar with a Monaco-powered diff view, commit history, branch switcher, and a status bar indicator.

### Theming
20 built-in themes (10 dark, 10 light) driven entirely by CSS variables propagated across the whole UI.

### AI sidebar
Multiple chat sessions, a Claude / Codex toggle, token streaming, a permission UI for tool calls, and a live status indicator. This is where the architecture below comes into play.

---

## Architecture: the AI environment

The interesting part of Strata isn't that it has an AI chat — it's *how* the AI reaches the rest of the application.

Rather than feed application state to the agent through fragile prompt text, Strata runs an **MCP (Model Context Protocol) HTTP server inside the Electron main process**, on `localhost:7842`. The server lives exactly where the live state lives, so its tools read the active database connection, the active HTTP collection, and the open editor file *directly from memory* — no inter-process IPC, no prompt-stuffing.

```
Strata main process (Electron)
  │
  ├─ live state: active DB connection · active HTTP collection · open file
  │
  ├─ MCP HTTP server  →  http://localhost:7842/mcp
  │     │
  │     ├─ strata_db_schema          introspect the active DB schema
  │     ├─ strata_db_query           run SQL against the active DB
  │     ├─ strata_http_send          execute an HTTP request
  │     ├─ strata_http_save_request  save a request to the active collection
  │     └─ strata_editor_insert      write into the open editor file
  │
  └─ spawns the AI agent (Claude Code) pointed at the MCP server
```

### Environment-as-state

The key design decision: **the AI never passes "which database" or "which collection" as a parameter.** The user flags the active environment in Strata (the way you'd select a Postman environment), and that selection is held in the main process. When the agent calls `strata_db_query`, it sends only the SQL — the tool already knows which connection to run it on.

This keeps the agent's tool signatures minimal and removes an entire class of failure where the model has to "remember" or guess the current context. The heavy, stateful context stays on the Strata side; the AI just hits a tool.

### Why HTTP transport

Claude Code accepts MCP servers over HTTP, registered with:

```bash
claude mcp add --transport http strata http://localhost:7842/mcp
```

With stdio transport the agent would spawn the MCP server as a *separate* child process with no access to Strata's live state, forcing IPC back to the main process. Hosting the server inside the main process over HTTP avoids that entirely — the server is where the state is.

Tools are exposed to the agent via `--allowedTools` using the `mcp__strata__<tool>` naming convention. Tool names are deliberately specific (`strata_db_query`, not `query`) because generic names lead the model to pick the wrong tool.

### Agent process model

The AI sidebar spawns a fresh agent process **per message** (`claude --print` / `codex exec -`) rather than holding a persistent CLI process open. An earlier persistent-process design — relying on an end-of-output marker plus a timeout — was structurally unreliable, since the timeout consistently fired before stdout arrived. Stateless per-message spawning removed the race entirely.

---

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| Build | electron-vite |
| UI | React + TypeScript |
| Editor | Monaco |
| Terminal | node-pty + xterm.js |
| Local storage | SQLite (`better-sqlite3`) with versioned migrations |
| Secrets | `keytar` (OS keychain) |
| AI integration | MCP over HTTP · Claude Code / Codex |

---

## Getting started

### Prerequisites
- Node.js (a current LTS) and npm
- Build tools for native modules (`better-sqlite3`, `node-pty`, `keytar`), which are rebuilt against Electron's runtime on install
- The Claude Code CLI on your `PATH` if you want to use the AI sidebar

### Install & run

```bash
git clone https://github.com/<your-username>/strata.git
cd strata
npm install        # rebuilds native modules for Electron
npm run dev        # launch in development
```

### Build a distributable

```bash
npm run build
```

> Adjust the script names above to match your `package.json`.

### Connect the AI sidebar

```bash
claude mcp add --transport http strata http://localhost:7842/mcp
```

Then flag the active database connection and HTTP collection inside Strata, and the agent's tools will operate against them automatically.

---

## Status & roadmap

Strata is functional end-to-end: the editor, terminal, DB panel, HTTP panel, Git panel, and the full MCP tool chain (schema introspection → SQL → request build/save/send → editor insert) all work in a single flow.

Remaining work:
- **Codex MCP parity** — `codex exec` lacks a clean tool-allowlist flag equivalent to Claude Code's `--allowedTools`; full Codex support is in progress.
- **UI polish** across panels.
- **Reliability hardening**, including a stricter agent system prompt to prevent it from inventing state when a tool returns an empty result.

---

