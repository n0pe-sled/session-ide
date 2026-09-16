/**
 * Browser half of dsh-session-ide: registers the per-session "IDE" tab in
 * the conversation view ring (`'conversation.view'` slot, order 30 — after
 * Chat, Trajectory, and Shell) and mounts the `sessionIde` Remote so the
 * explorer and editor can be driven through the host workspace file server.
 *
 * The Remote contribution is mounted lazily: `$mount` starts here (so its
 * effect is fiber-owned and unwinds with the plugin), but its rejection is
 * contained and only surfaced through the controller's error branch — a mount
 * failure must not take down the session view, it only disables the tab body.
 *
 * Export discipline (packages/client/AGENTS.md): the ./client entry exports
 * only `apply`/`inject` and shared types; components stay internal.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'conversation.view' SlotMap row (declared by the slot's
// owning package) in for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: ctx.slots and the SlotMap types.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { IDE_DESCRIPTORS, IDE_SERVICE } from '../shared/remote.ts'
import { createIdeController, type IdeController, type SessionIdeRemote } from './controller.ts'
import { createIdeStore } from './ide-store.ts'
import { IdeView, type IdeViewInjected } from './IdeView.tsx'

export type { IdeViewInjected } from './IdeView.tsx'
export type { IdeController, SessionIdeRemote } from './controller.ts'
export type {
  IdeDirEntry, IdeControlError, ListRequest, ListResult, ReadRequest, ReadResult,
  WriteRequest, WriteResult,
} from '../shared/remote.ts'


/** Required services (cordis fiber inject). */
export const inject = ['slots', 'remote']

/**
 * Register the IDE tab for every session and mount the IDE Remote.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Monaco never receives a worker URL from this bundle (the harness serves
  // no separate worker files); a no-op getWorker keeps any accidental worker
  // request from throwing — the worker-backed language services are not
  // bundled, so nothing ever actually posts to it.
  const globalWithEnv = globalThis as { MonacoEnvironment?: unknown }
  if (globalWithEnv.MonacoEnvironment === undefined) {
    globalWithEnv.MonacoEnvironment = {
      getWorker: () => ({
        postMessage: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        terminate: () => {},
      }) as unknown as Worker,
    }
  }

  // Mount the IDE Remote for this plugin's fiber. Not awaited: a mount
  // failure (endpoint collision, carrier offline) only disables the tab body.
  const mount = ctx.remote.$mount({
    package: 'dsh-session-ide',
    descriptors: IDE_DESCRIPTORS,
  })
  mount.catch(() => {})

  /** Resolve the mounted namespace, or undefined when the mount failed. */
  const namespace = async (): Promise<SessionIdeRemote | undefined> => {
    try {
      await mount
    } catch (error) {
      return undefined
    }
    return ctx.get(`remote.${IDE_SERVICE}`) as SessionIdeRemote | undefined
  }

  const controls = new Map<string, IdeController>()
  const controlFor = (sessionId: SessionId): IdeController => {
    let control = controls.get(sessionId)
    if (control === undefined) {
      control = createIdeController(namespace, sessionId)
      controls.set(sessionId, control)
    }
    return control
  }

  const ideStore = createIdeStore()

  // Register the tab. The inject factory closes over the per-session control
  // and its lifecycle is tied to this plugin fiber, not the component mount,
  // so open tabs and tree state survive tab switches (the view ring renders
  // one-at-a-time and the declared store is session-scoped).
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'ide',
    order: 30,
    label: () => 'IDE',
    store: ideStore,
    inject: (sessionId: SessionId): IdeViewInjected => ({
      control: controlFor(sessionId),
    }),
  }, IdeView))
}
