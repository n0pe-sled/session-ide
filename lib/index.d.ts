import Schema from "@deepseek-ai/schemastery";
import { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
//#region src/shared/remote.d.ts
/** One directory entry as the browser explorer renders it. */
interface IdeDirEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'link';
  /** File size in bytes; null for directories and unreadable links. */
  readonly size: number | null;
  /** Last modification time (Unix epoch ms); null when unavailable. */
  readonly mtime: number | null;
}
/** List request: browse one directory below the session workspace root. */
interface ListRequest {
  /** The dsh session whose workspace directory is the browse root. */
  readonly sessionId: string;
  /** Workspace-relative directory path; '' is the root. */
  readonly path: string;
}
/** List outcome. */
interface ListResult {
  /** Normalized workspace-relative path that was listed. */
  readonly path: string;
  /** Child entries, directories first then files, name-ordered. */
  readonly entries: readonly IdeDirEntry[];
}
/** Read request: load one workspace-relative file as text. */
interface ReadRequest {
  readonly sessionId: string;
  /** Workspace-relative file path. */
  readonly path: string;
}
/** Read outcome. */
interface ReadResult {
  /** Normalized workspace-relative path that was read. */
  readonly path: string;
  /** File content as UTF-8 text; empty for binary files. */
  readonly content: string;
  /** Size in bytes on disk. */
  readonly size: number;
  /** True when the file contains NUL bytes (not editable text). */
  readonly binary: boolean;
}
/** Write request: persist text back to one workspace-relative file. */
interface WriteRequest {
  readonly sessionId: string;
  readonly path: string;
  /** Full replacement content. */
  readonly content: string;
}
/** Write outcome. */
interface WriteResult {
  /** Normalized workspace-relative path that was written. */
  readonly path: string;
  /** Bytes written. */
  readonly size: number;
}
/** Client-visible outcome of one IDE file operation, carrying a stable error surface. */
type IdeControlError = {
  readonly kind: 'session-not-found';
  readonly message: string;
} | {
  readonly kind: 'cwd-unavailable';
  readonly message: string;
} | {
  readonly kind: 'disabled';
  readonly message: string;
} | {
  readonly kind: 'path-outside-workspace';
  readonly message: string;
} | {
  readonly kind: 'not-found';
  readonly message: string;
} | {
  readonly kind: 'not-a-directory';
  readonly message: string;
} | {
  readonly kind: 'too-large';
  readonly message: string;
} | {
  readonly kind: 'readonly';
  readonly message: string;
} | {
  readonly kind: 'binary';
  readonly message: string;
} | {
  readonly kind: 'io-error';
  readonly message: string;
} | {
  readonly kind: 'remote-error';
  readonly message: string;
};
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'sessionIde/list'(request: ListRequest): Promise<RemoteResult<ListResult>>;
    'sessionIde/read'(request: ReadRequest): Promise<RemoteResult<ReadResult>>;
    'sessionIde/write'(request: WriteRequest): Promise<RemoteResult<WriteResult>>;
  }
  interface TypertRemoteNamespaceMap {
    sessionIde: {
      list(request: ListRequest): Promise<RemoteResult<ListResult>>;
      read(request: ReadRequest): Promise<RemoteResult<ReadResult>>;
      write(request: WriteRequest): Promise<RemoteResult<WriteResult>>;
    };
  }
}
//#endregion
//#region src/ide-files.d.ts
/** Error category for user-visible file operations. */
declare class IdeFileError extends Error {
  /** Stable machine category. */
  readonly kind: string;
  /** @param kind - machine category. @param message - user-facing message. */
  constructor(kind: string, message: string);
}
/** Host-side configuration driving the file server. */
interface IdeFileConfig {
  enabled: boolean;
  writable: boolean;
  maxReadBytes: number;
  maxWriteBytes: number;
  /** Basenames hidden from the explorer (node_modules, .git, ...). */
  ignore: readonly string[];
}
/** Workspace-scoped file operations for one host context. */
declare class IdeFileManager {
  private readonly ctx;
  private readonly config;
  /**
   * @param ctx - owning host context (session store access).
   * @param config - resolved plugin configuration.
   */
  constructor(ctx: Context, config: IdeFileConfig);
  /** List one directory below the session workspace root. */
  list(request: ListRequest): Promise<ListResult>;
  /** Load one workspace-relative file as UTF-8 text. */
  read(request: ReadRequest): Promise<ReadResult>;
  /** Persist text back to one workspace-relative file. */
  write(request: WriteRequest): Promise<WriteResult>;
  private assertEnabled;
  /** Resolve the session's canonical workspace root (realpath, cached). */
  private workspaceRoot;
  /** Lexically resolve a workspace-relative path behind `root`. */
  private resolveInside;
  /** Resolve the realpath of an existing path and assert it stays in the root. */
  private realInside;
}
//#endregion
//#region src/index.d.ts
declare const name = "session-ide";
/** Services that must be mounted before this plugin runs. */
declare const inject: string[];
/** Config: surface switches and payload bounds for the workspace file server. */
interface Config {
  enabled: boolean;
  writable: boolean;
  maxReadBytes: number;
  maxWriteBytes: number;
  ignore: string[];
}
declare const Config: Schema<Config>;
/**
 * Mount the session-ide plugin.
 * @param ctx - the host context.
 * @param config - resolved plugin config (the loader passes the fully resolved value).
 */
declare function apply(ctx: Context, config: Config): Promise<void>;
//#endregion
export { Config, type IdeControlError, type IdeDirEntry, IdeFileError, IdeFileManager, type ListRequest, type ListResult, type ReadRequest, type ReadResult, type WriteRequest, type WriteResult, apply, inject, name };