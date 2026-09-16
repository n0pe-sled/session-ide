/**
 * Wire contract between the two halves of dsh-session-ide: the list/read/write
 * descriptor set for the workspace file server, its payload types, and
 * boundary validators.
 *
 * This module is deliberately dependency-free at runtime (pure JSON-safe data
 * plus tiny hand-rolled validators), because it is bundled into BOTH halves:
 * the node half (hot receiver) and the browser half (client `$mount`). The
 * client's Remote `$mount` requires strict codecs, so every descriptor uses
 * `{ mode: 'strict', schema }` with these validators.
 *
 * @module dsh-session-ide/remote
 */

import type {
  InvocationDescriptor,
  RemoteResult,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'

/** Cordis service key of the IDE receiver, also the wire namespace. */
export const IDE_SERVICE = 'sessionIde'
/** Wire namespace of every IDE invocation. */
export const IDE_NAMESPACE = IDE_SERVICE

/** One directory entry as the browser explorer renders it. */
export interface IdeDirEntry {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'link'
  /** File size in bytes; null for directories and unreadable links. */
  readonly size: number | null
  /** Last modification time (Unix epoch ms); null when unavailable. */
  readonly mtime: number | null
}

/** List request: browse one directory below the session workspace root. */
export interface ListRequest {
  /** The dsh session whose workspace directory is the browse root. */
  readonly sessionId: string
  /** Workspace-relative directory path; '' is the root. */
  readonly path: string
}

/** List outcome. */
export interface ListResult {
  /** Normalized workspace-relative path that was listed. */
  readonly path: string
  /** Child entries, directories first then files, name-ordered. */
  readonly entries: readonly IdeDirEntry[]
}

/** Read request: load one workspace-relative file as text. */
export interface ReadRequest {
  readonly sessionId: string
  /** Workspace-relative file path. */
  readonly path: string
}

/** Read outcome. */
export interface ReadResult {
  /** Normalized workspace-relative path that was read. */
  readonly path: string
  /** File content as UTF-8 text; empty for binary files. */
  readonly content: string
  /** Size in bytes on disk. */
  readonly size: number
  /** True when the file contains NUL bytes (not editable text). */
  readonly binary: boolean
}

/** Write request: persist text back to one workspace-relative file. */
export interface WriteRequest {
  readonly sessionId: string
  readonly path: string
  /** Full replacement content. */
  readonly content: string
}

/** Write outcome. */
export interface WriteResult {
  /** Normalized workspace-relative path that was written. */
  readonly path: string
  /** Bytes written. */
  readonly size: number
}

/** Client-visible outcome of one IDE file operation, carrying a stable error surface. */
export type IdeControlError =
  | { readonly kind: 'session-not-found'; readonly message: string }
  | { readonly kind: 'cwd-unavailable'; readonly message: string }
  | { readonly kind: 'disabled'; readonly message: string }
  | { readonly kind: 'path-outside-workspace'; readonly message: string }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'not-a-directory'; readonly message: string }
  | { readonly kind: 'too-large'; readonly message: string }
  | { readonly kind: 'readonly'; readonly message: string }
  | { readonly kind: 'binary'; readonly message: string }
  | { readonly kind: 'io-error'; readonly message: string }
  | { readonly kind: 'remote-error'; readonly message: string }

/** Convert a raw failure message into the typed client control error. */
export function classifyIdeError(message: string): IdeControlError {
  const match = /(session-not-found|cwd-unavailable|disabled|path-outside-workspace|not-found|not-a-directory|too-large|readonly|binary|io-error)/.exec(message)
  if (match !== null) {
    const kind = match[1]
    switch (kind) {
      case 'session-not-found': return { kind: 'session-not-found', message }
      case 'cwd-unavailable': return { kind: 'cwd-unavailable', message }
      case 'disabled': return { kind: 'disabled', message }
      case 'path-outside-workspace': return { kind: 'path-outside-workspace', message }
      case 'not-found': return { kind: 'not-found', message }
      case 'not-a-directory': return { kind: 'not-a-directory', message }
      case 'too-large': return { kind: 'too-large', message }
      case 'readonly': return { kind: 'readonly', message }
      case 'binary': return { kind: 'binary', message }
      case 'io-error': return { kind: 'io-error', message }
      default: break
    }
  }
  return { kind: 'remote-error', message }
}

// --- Boundary validators -----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Valid non-empty short identifier (session id). */
function isId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 256 && !value.includes('\u0000')
}

/** Workspace-relative path ('' for root); no NUL, bounded length. */
function isPath(value: unknown): value is string {
  return isString(value) && value.length <= 4096 && !value.includes('\u0000')
}

/** Bounded integer file size. */
function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Directory entry validator. */
const entrySchema: TypertSchema<IdeDirEntry> = {
  parse(value: unknown): IdeDirEntry {
    if (!isRecord(value)) throw new TypeError('directory entry must be a plain object')
    const { name, kind, size, mtime } = value
    if (!isString(name) || name.length === 0 || name.length > 512 || name.includes('\u0000')) {
      throw new TypeError('directory entry name must be a non-empty bounded string')
    }
    if (kind !== 'file' && kind !== 'dir' && kind !== 'link') {
      throw new TypeError('directory entry kind must be file, dir, or link')
    }
    if (size !== null && !isSize(size)) throw new TypeError('directory entry size must be a non-negative integer or null')
    if (mtime !== null && !isSize(mtime)) throw new TypeError('directory entry mtime must be a non-negative integer or null')
    return { name, kind, size: size as number | null, mtime: mtime as number | null }
  },
}

/** Path-only request validator (list thin wrapper below). */
function parsePathRequest(value: unknown): { sessionId: string; path: string } {
  if (!isRecord(value)) throw new TypeError('request must be a plain object')
  const { sessionId, path } = value
  if (!isId(sessionId)) throw new TypeError('request sessionId must be a non-empty id string')
  if (!isPath(path)) throw new TypeError('request path must be a bounded string without NUL')
  return { sessionId, path }
}

/** List result validator. */
const listResultSchema: TypertSchema<ListResult> = {
  parse(value: unknown): ListResult {
    if (!isRecord(value)) throw new TypeError('list result must be a plain object')
    const { path, entries } = value
    if (!isPath(path)) throw new TypeError('list result path must be a bounded string')
    if (!Array.isArray(entries)) throw new TypeError('list result entries must be an array')
    if (entries.length > 100_000) throw new TypeError('list result entries array is unreasonably large')
    return { path, entries: entries.map(entry => entrySchema.parse(entry)) }
  },
}

/** Read result validator. */
const readResultSchema: TypertSchema<ReadResult> = {
  parse(value: unknown): ReadResult {
    if (!isRecord(value)) throw new TypeError('read result must be a plain object')
    const { path, content, size, binary } = value
    if (!isPath(path)) throw new TypeError('read result path must be a bounded string')
    if (!isString(content) || content.length > 64 * 1024 * 1024) {
      throw new TypeError('read result content must be a bounded string')
    }
    if (!isSize(size)) throw new TypeError('read result size must be a non-negative integer')
    if (typeof binary !== 'boolean') throw new TypeError('read result binary must be a boolean')
    return { path, content, size, binary }
  },
}

/** Write result validator. */
const writeResultSchema: TypertSchema<WriteResult> = {
  parse(value: unknown): WriteResult {
    if (!isRecord(value)) throw new TypeError('write result must be a plain object')
    const { path, size } = value
    if (!isPath(path)) throw new TypeError('write result path must be a bounded string')
    if (!isSize(size)) throw new TypeError('write result size must be a non-negative integer')
    return { path, size }
  },
}

// --- Invocation descriptors --------------------------------------------------

/** The list invocation, registered by the host and mounted by the client. */
export const LIST_DESCRIPTOR: InvocationDescriptor = {
  id: 'dsh-session-ide#sessionIde.list',
  service: IDE_SERVICE,
  namespace: IDE_NAMESPACE,
  method: 'list',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: { mode: 'strict', typeSymbol: 'dsh-session-ide#ListRequest', schema: { parse: (value: unknown) => parsePathRequest(value) } },
  }],
  result: { mode: 'strict', typeSymbol: 'dsh-session-ide#ListResult', schema: listResultSchema },
}

/** The read invocation. */
export const READ_DESCRIPTOR: InvocationDescriptor = {
  id: 'dsh-session-ide#sessionIde.read',
  service: IDE_SERVICE,
  namespace: IDE_NAMESPACE,
  method: 'read',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: { mode: 'strict', typeSymbol: 'dsh-session-ide#ReadRequest', schema: { parse: (value: unknown) => parsePathRequest(value) } },
  }],
  result: { mode: 'strict', typeSymbol: 'dsh-session-ide#ReadResult', schema: readResultSchema },
}

/** The write invocation. */
export const WRITE_DESCRIPTOR: InvocationDescriptor = {
  id: 'dsh-session-ide#sessionIde.write',
  service: IDE_SERVICE,
  namespace: IDE_NAMESPACE,
  method: 'write',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: 'dsh-session-ide#WriteRequest',
      schema: {
        parse(value: unknown): { sessionId: string; path: string; content: string } {
          if (!isRecord(value)) throw new TypeError('write request must be a plain object')
          const { sessionId, path, content } = value
          if (!isId(sessionId)) throw new TypeError('write request sessionId must be a non-empty id string')
          if (!isPath(path)) throw new TypeError('write request path must be a bounded string without NUL')
          if (!isString(content) || content.length > 16 * 1024 * 1024) {
            throw new TypeError('write request content must be a bounded string')
          }
          return { sessionId, path, content }
        },
      },
    },
  }],
  result: { mode: 'strict', typeSymbol: 'dsh-session-ide#WriteResult', schema: writeResultSchema },
}

/** The full descriptor set, registered by the host and mounted by the client. */
export const IDE_DESCRIPTORS: readonly InvocationDescriptor[] = [
  LIST_DESCRIPTOR,
  READ_DESCRIPTOR,
  WRITE_DESCRIPTOR,
]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'sessionIde/list'(request: ListRequest): Promise<RemoteResult<ListResult>>
    'sessionIde/read'(request: ReadRequest): Promise<RemoteResult<ReadResult>>
    'sessionIde/write'(request: WriteRequest): Promise<RemoteResult<WriteResult>>
  }
  interface TypertRemoteNamespaceMap {
    sessionIde: {
      list(request: ListRequest): Promise<RemoteResult<ListResult>>
      read(request: ReadRequest): Promise<RemoteResult<ReadResult>>
      write(request: WriteRequest): Promise<RemoteResult<WriteResult>>
    }
  }
}
