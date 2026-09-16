/**
 * Host (Node) half of dsh-session-ide.
 *
 * Registers the `sessionIde` Typert receiver behind `ctx.typert`, so the
 * gateway claims `/api/sessionIde/<method>` and dispatches to it: list/read/
 * write scoped to one dsh session's canonical working directory
 * (`SessionHeader.cwd`), with containment and size caps enforced host-side
 * ({@link IdeFileManager}).
 *
 * The browser half mounts the same descriptors and drives the explorer and
 * editor through the client Remote; nothing here requires a model tool or
 * prompt — this is a human-controlled workspace IDE, one per session.
 *
 * Configuration: `enabled` (default true) turns the whole surface off at the
 * host; `writable` (default true) allows edits — set false for read-only
 * browsing; `maxReadBytes`/`maxWriteBytes` cap payload sizes; `ignore` lists
 * entry names hidden from the explorer.
 */

import Schema from '@deepseek-ai/schemastery'
import type z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pull the ctx.sessions Context merge (SessionStore).
import type {} from '@deepseek-ai/dsh-session'
// Type-only: the ctx.typert.register() augmentation and TypertContribution.
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution, TypertPackageModel } from '@deepseek-ai/dsh-typert-registry'
import { bindTypertRemote, type TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol'
import { IdeFileManager } from './ide-files.ts'
import {
  IDE_DESCRIPTORS, IDE_SERVICE,
  type ListRequest, type ListResult,
  type ReadRequest, type ReadResult,
  type WriteRequest, type WriteResult,
} from './shared/remote.ts'

export { IdeFileManager, IdeFileError } from './ide-files.ts'
export type {
  ListRequest, ListResult, ReadRequest, ReadResult,
  WriteRequest, WriteResult, IdeControlError, IdeDirEntry,
} from './shared/remote.ts'

export const name = 'session-ide'

/** Services that must be mounted before this plugin runs. */
export const inject = ['sessions', 'typert']

/** Config: surface switches and payload bounds for the workspace file server. */
export interface Config {
  enabled: boolean
  writable: boolean
  maxReadBytes: number
  maxWriteBytes: number
  ignore: string[]
}

export const Config: z<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  writable: Schema.boolean().default(true),
  maxReadBytes: Schema.number().min(1024).max(64 * 1024 * 1024).default(1024 * 1024),
  maxWriteBytes: Schema.number().min(1024).max(128 * 1024 * 1024).default(4 * 1024 * 1024),
  ignore: Schema.array(Schema.string()).default(['node_modules', '.git', 'dist', 'coverage', '.next', 'target']),
})

/** Empty model for the Typert contribution: no generated reflection is claimed. */
const EMPTY_MODEL: TypertPackageModel = { services: [], events: [], objects: [] }

/** The live receiver object the gateway dispatches `/api/sessionIde/<method>` to. */
interface SessionIdeReceiver {
  /** Set after construction — the binding must reference the receiver itself. */
  typertRemote: TypertGatewayBinding<SessionIdeReceiver>
  list(request: ListRequest): Promise<ListResult>
  read(request: ReadRequest): Promise<ReadResult>
  write(request: WriteRequest): Promise<WriteResult>
}

/**
 * Mount the session-ide plugin.
 * @param ctx - the host context.
 * @param config - resolved plugin config (the loader passes the fully resolved value).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const manager = new IdeFileManager(ctx, config)

  const receiver: SessionIdeReceiver = {
    // The binding is assigned below — it must reference the receiver itself,
    // which does not exist until the object literal completes.
    typertRemote: undefined as unknown as TypertGatewayBinding<SessionIdeReceiver>,
    list: (request: ListRequest) => manager.list(request),
    read: (request: ReadRequest) => manager.read(request),
    write: (request: WriteRequest) => manager.write(request),
  }
  receiver.typertRemote = bindTypertRemote(receiver, IDE_SERVICE, { namespace: IDE_SERVICE })
  ctx.provide(IDE_SERVICE, receiver)

  // Register the endpoints so the gateway claims `/api/sessionIde/<method>`
  // and dispatches to the receiver above.
  const contribution: TypertContribution = {
    package: 'dsh-session-ide',
    face: 'host',
    schemas: [],
    model: EMPTY_MODEL,
    invocations: IDE_DESCRIPTORS,
  }
  ctx.typert.register(contribution)
}
