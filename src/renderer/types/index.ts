export type Workspace = { id: number; path: string; name: string; lastOpened: Date };

export type EditorTab = {
  id: string;
  path: string;
  content: string;
  modified: boolean;
  language: string;
};

export type DbConnection = {
  id: number;
  name: string;
  type: "mysql" | "postgres" | "sqlite";
  host: string;
  port: number;
  database: string;
  user: string;
};
export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
};

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";
export type HttpRequest = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
};
export type HttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
};

export type GitCommit = {
  hash: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
};
export type GitStatus = {
  modified: string[];
  staged: string[];
  untracked: string[];
};