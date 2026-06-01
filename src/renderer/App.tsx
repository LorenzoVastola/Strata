import { Code2, Database, GitBranch, Globe, SquareTerminal } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Home from "./components/Home";
import StatusBar from "./components/StatusBar";
import type { Workspace } from "./types/index";
import DBPanel from "./panels/DBPanel";
import GitPanel, { type DiffOpenRequest } from "./panels/GitPanel";
import HttpPanel from "./panels/HttpPanel";
import IDEPanel, { type IDEPanelHandle } from "./panels/IDEPanel";
import TerminalPanel from "./panels/TerminalPanel";

type ActivePanel = "ide" | "git" | "db" | "http" | "terminal";

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("ide");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const hasWorkspace = Boolean(workspacePath);
  const _workspaceTypeCheck: Workspace[] = [];
  void _workspaceTypeCheck;

  const idePanelRef = useRef<IDEPanelHandle>(null);

  const handleOpenDiff = useCallback((req: DiffOpenRequest) => {
    idePanelRef.current?.openDiffTab(req);
  }, []);

  const handleOpenWorkspace = (path: string, _name: string) => {
    setWorkspacePath(path);
    setActivePanel("ide");
  };

  const selectPanel = (panel: ActivePanel) => {
    if (!hasWorkspace && (panel === "ide" || panel === "git")) return;
    setActivePanel(panel);
  };

  // Whether to show a non-IDE panel in main area
  const showOtherPanel = activePanel === "db" || activePanel === "http" || activePanel === "terminal";
  // Whether to show IDE panel area (always when workspace is set)
  const showIDE = Boolean(workspacePath);
  // Whether git sidebar should be shown alongside IDE editor
  const showGitSidebar = activePanel === "git" && Boolean(workspacePath);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {/* ── Activity bar ── */}
        <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-2 bg-zinc-900 py-3" style={{ background: 'var(--strata-sidebar)', borderRight: '1px solid var(--strata-border)' }}>
          <button
            type="button"
            onClick={() => selectPanel("ide")}
            disabled={!hasWorkspace}
            title={hasWorkspace ? "Editor" : "Apri un progetto per usare l'editor"}
            className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:text-zinc-700 ${
              activePanel === "ide" ? "bg-zinc-800 text-white" : ""
            }`}
            aria-label="Open IDE panel"
          >
            <Code2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => selectPanel("git")}
            disabled={!hasWorkspace}
            title={hasWorkspace ? "Git" : "Apri un progetto per usare Git"}
            className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:text-zinc-700 ${
              activePanel === "git" ? "bg-zinc-800 text-white" : ""
            }`}
            aria-label="Open Git panel"
          >
            <GitBranch className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => selectPanel("db")}
            title="Database"
            className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
              activePanel === "db" ? "bg-zinc-800 text-white" : ""
            }`}
            aria-label="Open Database panel"
          >
            <Database className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => selectPanel("http")}
            title="HTTP"
            className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
              activePanel === "http" ? "bg-zinc-800 text-white" : ""
            }`}
            aria-label="Open HTTP panel"
          >
            <Globe className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => selectPanel("terminal")}
            title="Terminale"
            className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
              activePanel === "terminal" ? "bg-zinc-800 text-white" : ""
            }`}
            aria-label="Open Terminal panel"
          >
            <SquareTerminal className="h-5 w-5" />
          </button>
        </aside>

        {/* ── Main area ── */}
        <main className="h-full min-w-0 flex-1 overflow-hidden" style={{ background: 'var(--strata-bg)' }}>
          {/* No workspace: show Home for ide/git panels */}
          {!workspacePath && (activePanel === "ide" || activePanel === "git") ? (
            <Home onOpenWorkspace={handleOpenWorkspace} onOpenDbConnection={() => setActivePanel("db")} />
          ) : (
            <div className="flex h-full w-full">
              {/* ── Non-IDE panels (db/http/terminal) ── */}
              {showOtherPanel && (
                <div className="flex h-full w-full">
                  {activePanel === "db" && <DBPanel />}
                  {activePanel === "http" && <HttpPanel />}
                  {activePanel === "terminal" && <TerminalPanel workspacePath={workspacePath ?? undefined} />}
                </div>
              )}

              {/* ── IDE area: always mounted when workspace is open ── */}
              {showIDE && (
                <div className={`flex h-full min-w-0 flex-1 ${showOtherPanel ? 'hidden' : ''}`}>
                  {/* Git sidebar (only when git panel active) */}
                  {showGitSidebar && (
                    <GitPanel
                      workspacePath={workspacePath!}
                      onOpenDiff={handleOpenDiff}
                    />
                  )}

                  {/* IDE editor — always rendered, sidebar hidden when git is active */}
                  <div className="flex h-full min-w-0 flex-1">
                    <IDEPanel
                      ref={idePanelRef}
                      workspacePath={workspacePath!}
                      hideSidebar={showGitSidebar}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <StatusBar workspacePath={workspacePath} />
    </div>
  );
}
