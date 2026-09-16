/**
 * Host-side workspace file server for dsh-session-ide.
 *
 * Every operation is scoped to one dsh session's canonical working directory
 * (`SessionHeader.cwd`): requested paths are workspace-relative, resolved
 * lexically BEHIND the workspace root (no '..' segments, no absolute paths),
 * and then checked against the realpath of the root so a symlink inside the
 * workspace cannot smuggle a read/write outside it.
 *
 * Sizes are capped (`maxReadBytes` / `maxWriteBytes`) so the browser never
 * receives a multi-gigabyte string; binary files (NUL bytes) answer with
 * `binary: true` and empty content instead of a lossy UTF-8 blob.
 *
 * @module dsh-session-ide/ide-files
 */

import { realpath, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  IdeDirEntry, ListRequest, ListResult, ReadRequest, ReadResult,
  WriteRequest, WriteResult,
} from './shared/remote.ts'

/** Error category for user-visible file operations. */
export class IdeFileError extends Error {
  /** Stable machine category. */
  readonly kind: string

  /** @param kind - machine category. @param message - user-facing message. */
  constructor(kind: string, message: string) {
    super(message)
    this.name = 'IdeFileError'
    this.kind = kind
  }
}

/** Host-side configuration driving the file server. */
export interface IdeFileConfig {
  enabled: boolean
  writable: boolean
  maxReadBytes: number
  maxWriteBytes: number
  /** Basenames hidden from the explorer (node_modules, .git, ...). */
  ignore: readonly string[]
}

/** Workspace-scoped file operations for one host context. */
export class IdeFileManager {
  /**
   * @param ctx - owning host context (session store access).
   * @param config - resolved plugin configuration.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: IdeFileConfig,
  ) {}

  /** List one directory below the session workspace root. */
  async list(request: ListRequest): Promise<ListResult> {
    this.assertEnabled()
    const root = await this.workspaceRoot(request.sessionId)
    const directory = this.resolveInside(root, request.path)

    let dirents
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new IdeFileError('not-found', `not-found: path ${JSON.stringify(request.path)} does not exist`)
      if (code === 'ENOTDIR') throw new IdeFileError('not-a-directory', `not-a-directory: path ${JSON.stringify(request.path)} is not a directory`)
      throw new IdeFileError('io-error', `io-error: unable to list ${JSON.stringify(request.path)}: ${String(error)}`)
    }

    const entries: IdeDirEntry[] = []
    for (const entry of dirents) {
      if (this.config.ignore.includes(entry.name)) continue
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, kind: 'dir', size: null, mtime: null })
        continue
      }
      if (entry.isSymbolicLink()) {
        entries.push({ name: entry.name, kind: 'link', size: null, mtime: null })
        continue
      }
      if (entry.isFile()) {
        try {
          const info = await stat(join(directory, entry.name))
          entries.push({ name: entry.name, kind: 'file', size: info.size, mtime: Math.round(info.mtimeMs) })
        } catch {
          entries.push({ name: entry.name, kind: 'file', size: null, mtime: null })
        }
        continue
      }
      if (entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) {
        continue
      }
    }
    entries.sort((left, right) => {
      if (left.kind === 'dir' && right.kind !== 'dir') return -1
      if (left.kind !== 'dir' && right.kind === 'dir') return 1
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    })
    return { path: request.path === '' ? '' : normalizeRelative(request.path), entries }
  }

  /** Load one workspace-relative file as UTF-8 text. */
  async read(request: ReadRequest): Promise<ReadResult> {
    this.assertEnabled()
    const root = await this.workspaceRoot(request.sessionId)
    const resolved = this.resolveInside(root, request.path)
    const target = await this.realInside(root, resolved, 'read')

    let info
    try {
      info = await stat(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new IdeFileError('not-found', `not-found: file ${JSON.stringify(request.path)} does not exist`)
      throw new IdeFileError('io-error', `io-error: unable to stat ${JSON.stringify(request.path)}: ${String(error)}`)
    }
    if (info.isDirectory()) {
      throw new IdeFileError('not-a-directory', `not-a-directory: path ${JSON.stringify(request.path)} is a directory`)
    }
    if (info.size > this.config.maxReadBytes) {
      throw new IdeFileError('too-large', `too-large: ${JSON.stringify(request.path)} is ${info.size} bytes (limit ${this.config.maxReadBytes})`)
    }

    let buffer: Buffer
    try {
      buffer = await readFile(target)
    } catch (error) {
      throw new IdeFileError('io-error', `io-error: unable to read ${JSON.stringify(request.path)}: ${String(error)}`)
    }
    if (buffer.includes(0)) {
      return { path: normalizeRelative(request.path), content: '', size: buffer.length, binary: true }
    }
    return { path: normalizeRelative(request.path), content: buffer.toString('utf8'), size: buffer.length, binary: false }
  }

  /** Persist text back to one workspace-relative file. */
  async write(request: WriteRequest): Promise<WriteResult> {
    this.assertEnabled()
    if (!this.config.writable) {
      throw new IdeFileError('readonly', 'readonly: the IDE is configured read-only')
    }
    const bytes = Buffer.byteLength(request.content, 'utf8')
    if (bytes > this.config.maxWriteBytes) {
      throw new IdeFileError('too-large', `too-large: write is ${bytes} bytes (limit ${this.config.maxWriteBytes})`)
    }
    const root = await this.workspaceRoot(request.sessionId)
    const resolved = this.resolveInside(root, request.path)

    // Resolve the real target: an existing path follows its realpath (symlink
    // containment), a new file resolves its parent directory instead. Both
    // ends are contained before any write lands.
    let target: string
    try {
      target = await this.realInside(root, resolved, 'write')
    } catch (error) {
      if (error instanceof IdeFileError && error.kind === 'not-found') {
        const directory = dirname(resolved)
        const dirReal = await this.realInside(root, directory, 'write')
        target = join(dirReal, basename(resolved))
      } else {
        throw error
      }
    }
    try {
      await writeFile(target, request.content, 'utf8')
    } catch (error) {
      throw new IdeFileError('io-error', `io-error: unable to write ${JSON.stringify(request.path)}: ${String(error)}`)
    }
    return { path: normalizeRelative(request.path), size: bytes }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new IdeFileError('disabled', 'disabled: the session IDE is disabled in plugin configuration')
    }
  }

  /** Resolve the session's canonical workspace root (realpath, cached). */
  private async workspaceRoot(sessionId: string): Promise<string> {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) {
      throw new IdeFileError('session-not-found', `session-not-found: session ${JSON.stringify(sessionId)} not found`)
    }
    const cwd = session.header.cwd
    if (cwd === undefined || cwd === '') {
      throw new IdeFileError('cwd-unavailable', `cwd-unavailable: session ${JSON.stringify(sessionId)} has no working directory`)
    }
    try {
      return await realpath(cwd)
    } catch (error) {
      throw new IdeFileError('cwd-unavailable', `cwd-unavailable: session ${JSON.stringify(sessionId)} cwd is not resolvable: ${String(error)}`)
    }
  }

  /** Lexically resolve a workspace-relative path behind `root`. */
  private resolveInside(root: string, rel: string): string {
    if (rel === '') return root
    if (isAbsolute(rel) || rel.includes('\u0000')) {
      throw new IdeFileError('path-outside-workspace', `path-outside-workspace: ${JSON.stringify(rel)} is not workspace-relative`)
    }
    const segments = rel.split('/')
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') {
        throw new IdeFileError('path-outside-workspace', `path-outside-workspace: ${JSON.stringify(rel)} escapes the workspace`)
      }
    }
    const resolved = resolve(root, ...segments)
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new IdeFileError('path-outside-workspace', `path-outside-workspace: ${JSON.stringify(rel)} escapes the workspace`)
    }
    return resolved
  }

  /** Resolve the realpath of an existing path and assert it stays in the root. */
  private async realInside(root: string, resolved: string, op: string): Promise<string> {
    let real: string
    try {
      real = await realpath(resolved)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new IdeFileError('not-found', `not-found: ${op} target does not exist`)
      throw new IdeFileError('io-error', `io-error: unable to resolve ${op} target: ${String(error)}`)
    }
    if (real !== root && !real.startsWith(root + sep)) {
      throw new IdeFileError('path-outside-workspace', `path-outside-workspace: ${op} target escapes the workspace`)
    }
    return real
  }
}

/** Normalize a workspace-relative path for display (forward slashes only). */
function normalizeRelative(path: string): string {
  return path.split(sep).join('/')
}
