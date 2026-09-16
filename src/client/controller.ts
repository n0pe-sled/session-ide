/**
 * Browser-side control face for one session's workspace IDE: thin async wrappers
 * over the hosted `sessionIde` Remote with a typed error surface.
 *
 * The controller is built per session in the plugin's apply closure, so it
 * survives view remounts (tab switches); the component is a pure consumer.
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  classifyIdeError,
  type IdeControlError,
  type IdeDirEntry,
  type ListRequest,
  type ListResult,
  type ReadRequest,
  type ReadResult,
  type WriteRequest,
  type WriteResult,
} from '../shared/remote.ts'

/** The mounted sessionIde namespace, resolved through the service store. */
export interface SessionIdeRemote {
  list(request: ListRequest): Promise<RemoteResult<ListResult>>
  read(request: ReadRequest): Promise<RemoteResult<ReadResult>>
  write(request: WriteRequest): Promise<RemoteResult<WriteResult>>
}

/** One list outcome as the component sees it. */
export type IdeListOutcome =
  | { readonly ok: true; readonly path: string; readonly entries: readonly IdeDirEntry[] }
  | { readonly ok: false; readonly error: IdeControlError }

/** One read outcome as the component sees it. */
export type IdeReadOutcome =
  | { readonly ok: true; readonly path: string; readonly content: string; readonly size: number; readonly binary: boolean }
  | { readonly ok: false; readonly error: IdeControlError }

/** One write outcome as the component sees it. */
export type IdeWriteOutcome =
  | { readonly ok: true; readonly path: string; readonly size: number }
  | { readonly ok: false; readonly error: IdeControlError }

/** Browser-side IDE control face for one session (host-backed). */
export interface IdeController {
  /** List one workspace-relative directory ('' = root). */
  list(path: string): Promise<IdeListOutcome>
  /** Read one workspace-relative file as text. */
  read(path: string): Promise<IdeReadOutcome>
  /** Persist text to one workspace-relative file. */
  write(path: string, content: string): Promise<IdeWriteOutcome>
}

/**
 * Build one per-session controller over a lazily-mounted Remote.
 * @param resolveRemote - resolves the mounted namespace or undefined on failure.
 * @param sessionId - the dsh session whose workspace this controller scopes to.
 * @returns the controller.
 */
export function createIdeController(
  resolveRemote: () => Promise<SessionIdeRemote | undefined>,
  sessionId: string,
): IdeController {
  const scoped = async (): Promise<SessionIdeRemote | undefined> => {
    const rem = await resolveRemote()
    if (rem === undefined) return undefined
    return rem
  }

  const guard = async (op: (rem: SessionIdeRemote) => Promise<RemoteResult<unknown>>): Promise<IdeControlError | undefined> => {
    const rem = await scoped()
    if (rem === undefined) return classifyIdeError('remote-error: the IDE remote is not mounted')
    try {
      const result = await op(rem)
      if (!result.ok) return classifyIdeError(result.error.message)
      return undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return classifyIdeError(message)
    }
  }

  return {
    async list(path: string): Promise<IdeListOutcome> {
      let entries: readonly IdeDirEntry[] = []
      let listed = ''
      const error = await guard(async (rem) => {
        const result = await rem.list({ sessionId, path })
        if (result.ok) {
          entries = result.value.entries
          listed = result.value.path
        }
        return result
      })
      if (error !== undefined) return { ok: false, error }
      return { ok: true, path: listed, entries }
    },

    async read(path: string): Promise<IdeReadOutcome> {
      let content = ''
      let size = 0
      let binary = false
      let readPath = path
      const error = await guard(async (rem) => {
        const result = await rem.read({ sessionId, path })
        if (result.ok) {
          content = result.value.content
          size = result.value.size
          binary = result.value.binary
          readPath = result.value.path
        }
        return result
      })
      if (error !== undefined) return { ok: false, error }
      return { ok: true, path: readPath, content, size, binary }
    },

    async write(path: string, content: string): Promise<IdeWriteOutcome> {
      let size = 0
      let written = path
      const error = await guard(async (rem) => {
        const result = await rem.write({ sessionId, path, content })
        if (result.ok) {
          size = result.value.size
          written = result.value.path
        }
        return result
      })
      if (error !== undefined) return { ok: false, error }
      return { ok: true, path: written, size }
    },
  }
}
