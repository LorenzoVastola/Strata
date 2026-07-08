# Strata

Strata is a desktop workspace for backend development. It brings a code editor, database client, HTTP client, Git panel, terminal, and AI assistant into one Electron application.

The goal is to reduce the context switching between tools such as an IDE, Postman, a database client, and a terminal. Strata keeps the active project, database connection, HTTP collection, and editor state in one place, then exposes that live context to an AI agent through local MCP tools.

## Features

- Monaco-based editor with tabs, split views, diagnostics, breadcrumbs, minimap, folding, find/replace, and command palette.
- File explorer with file icons, context actions, drag and drop, and resizable panels.
- Integrated terminal powered by `node-pty` and `xterm.js`.
- Database panel for PostgreSQL and MySQL, with saved connections, schema browsing, table data, and SQL execution.
- HTTP client with collections, folders, environments, `{{variable}}` interpolation, cURL import/export, request history, auth options, scripts, and response captures.
- Git panel with status, branch switching, commit history, and Monaco-powered diffs.
- AI sidebar with Claude/Codex modes, streaming output, sessions, permission handling, and MCP integration.
- Local persistence through SQLite with versioned migrations.
- Theme system based on CSS variables.

## Architecture

Strata runs as an Electron app with a React renderer and a TypeScript main process. The main process owns local persistence, IPC handlers, workspace access, terminal processes, database connections, HTTP execution, Git operations, and the MCP server.

```text
Electron main process
  |
  |-- SQLite storage in the app userData directory
  |-- IPC handlers for editor, DB, HTTP, Git, terminal, workspace, and AI
  |-- live state for active DB connection, HTTP collection, and open files
  |
  `-- MCP HTTP server on 127.0.0.1:7842/mcp
      |-- strata_db_schema
      |-- strata_db_query
      |-- strata_http_send
      |-- strata_http_save_request
      `-- strata_editor_insert
```

The MCP server is hosted inside the Electron main process so tools can read the same live state used by the UI. The AI does not need to pass a database ID or collection ID for every call; Strata resolves those from the active environment selected in the app.

## Tech Stack

| Area | Technology |
| --- | --- |
| App shell | Electron |
| Build tooling | Vite, electron-vite |
| UI | React, TypeScript |
| Styling | Tailwind CSS, CSS variables |
| Editor | Monaco |
| Terminal | node-pty, xterm.js |
| Database clients | PostgreSQL, MySQL |
| Local storage | SQLite through better-sqlite3 |
| Secret storage | Electron safeStorage, keytar |
| AI integration | MCP over local HTTP, Claude Code, Codex CLI |

## Getting Started

### Prerequisites

- Node.js LTS and npm.
- Native build tooling for Electron native modules such as `better-sqlite3`, `node-pty`, and `keytar`.
- Claude Code CLI or Codex CLI if you want to use the AI sidebar.

### Install

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Typecheck and Build

```bash
npm run build
```

### Build a Windows Installer

```bash
npm run dist:win
```

## AI and MCP Setup

Strata starts a local MCP endpoint at:

```text
http://127.0.0.1:7842/mcp
```

For Claude Code, register it with:

```bash
claude mcp add --transport http strata http://127.0.0.1:7842/mcp
```

The app can also write MCP config files in its local user data directory for supported agents.

## Local Data and Security

Before publishing or sharing builds, keep these details in mind:

- Application data is stored outside the repository in Electron's `userData` directory, in a local `strata.db` SQLite database.
- Database passwords are stored encrypted through Electron `safeStorage`.
- Saved HTTP requests, HTTP auth fields, and environment variables are stored in the local SQLite database as JSON. Do not save production secrets in collections you plan to export or share.
- HTTP history can include request and response data. Strata includes redaction support for sensitive headers and request/response bodies, but users should still review history before sharing local data.
- The MCP server binds to localhost and is intended for local agent access only.
- Do not commit `.env` files, generated builds, logs, local AI config directories, or exported collections containing real credentials.

The repository `.gitignore` already excludes common local-only files such as `.env`, logs, build outputs, cache directories, `.claude/`, and `.cursor/`.

## Repository Health Check

This repository was scanned before public release for common sensitive file types and patterns, including `.env`, private keys, local SQLite databases, archives, email addresses, private IPs, API keys, access tokens, refresh tokens, database URLs, and PEM blocks. No committed secrets were found in the current working tree or Git history during that scan.

If a real credential was ever used while developing locally, rotate it before publishing anyway. Pattern-based scans reduce risk but are not a substitute for credential rotation.

## Project Structure

```text
src/main/        Electron main process, IPC handlers, storage, MCP server
src/preload/     Preload bridge exposed to the renderer
src/renderer/    React application and UI panels
electron/        Electron type helpers and legacy entry files
build/icons/     Packaged application icons
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the app in development mode. |
| `npm run build` | Run TypeScript and build production assets. |
| `npm run dist:win` | Build the app and create a Windows installer. |
| `npm run lint` | Run ESLint. |
| `npm run preview` | Preview the built Vite app. |

## Status

Strata is an active work in progress. Core editor, terminal, database, HTTP, Git, AI, and MCP workflows are implemented, with ongoing work focused on polish, hardening, and broader Codex MCP parity.
