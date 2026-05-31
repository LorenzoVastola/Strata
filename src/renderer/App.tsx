import { Code2, Database, GitBranch, Globe } from "lucide-react";
import { useState, type ComponentType } from "react";
import Home from "./components/Home";
import type { Workspace } from "./types/index";
import * as DBPanelModule from "./panels/DBPanel";
import * as GitPanelModule from "./panels/GitPanel";
import * as HttpPanelModule from "./panels/HttpPanel";
import * as IDEPanelModule from "./panels/IDEPanel";

type ActivePanel = "ide" | "git" | "db" | "http";

type IDEPanelProps = { workspacePath: string };

const IDEPanel =
  (IDEPanelModule as { default?: ComponentType<IDEPanelProps> }).default ??
  (() => <div className="p-4 text-zinc-300">IDE Panel</div>);
const GitPanel =
  (GitPanelModule as { default?: ComponentType }).default ??
  (() => <div className="p-4 text-zinc-300">Git Panel</div>);
const DBPanel =
  (DBPanelModule as { default?: ComponentType }).default ??
  (() => <div className="p-4 text-zinc-300">DB Panel</div>);
const HttpPanel =
  (HttpPanelModule as { default?: ComponentType }).default ??
  (() => <div className="p-4 text-zinc-300">HTTP Panel</div>);

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("ide");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const _workspaceTypeCheck: Workspace[] = [];
  void _workspaceTypeCheck;

  const handleOpenWorkspace = (path: string, _name: string) => {
    setWorkspacePath(path);
    setActivePanel("ide");
  };

  return (
    <div className="flex flex-row h-screen w-screen overflow-hidden">
      <aside className="flex h-screen w-12 shrink-0 flex-col items-center gap-2 bg-zinc-900 py-3">
        <button
          type="button"
          onClick={() => setActivePanel("ide")}
          className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
            activePanel === "ide" ? "bg-zinc-800 text-white" : ""
          }`}
          aria-label="Open IDE panel"
        >
          <Code2 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel("git")}
          className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
            activePanel === "git" ? "bg-zinc-800 text-white" : ""
          }`}
          aria-label="Open Git panel"
        >
          <GitBranch className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel("db")}
          className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
            activePanel === "db" ? "bg-zinc-800 text-white" : ""
          }`}
          aria-label="Open Database panel"
        >
          <Database className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel("http")}
          className={`rounded-md p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white ${
            activePanel === "http" ? "bg-zinc-800 text-white" : ""
          }`}
          aria-label="Open HTTP panel"
        >
          <Globe className="h-5 w-5" />
        </button>
      </aside>

      <main className="h-screen min-w-0 flex-1 bg-zinc-950">
        {!workspacePath ? (
          <Home onOpenWorkspace={handleOpenWorkspace} onOpenDbConnection={() => {}} />
        ) : (
          <>
            {activePanel === "ide" && <IDEPanel workspacePath={workspacePath} />}
            {activePanel === "git" && <GitPanel />}
            {activePanel === "db" && <DBPanel />}
            {activePanel === "http" && <HttpPanel />}
          </>
        )}
      </main>
    </div>
  );
}
