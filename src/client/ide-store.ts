/**
 * Per-session IDE store shared by the view's components: open tab ring,
 * active file, dirty flags, and the explorer's directory tree slots.
 *
 * The handle is created in the plugin's apply body so identity follows the
 * fiber; the entry declares it at register, and the framework instantiates
 * one per session scope — so open tabs survive view switches (the view ring
 * unmounts and remounts entries), exactly like the chat store.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { IdeDirEntry } from '../shared/remote.ts'

/** One directory slot in the explorer tree. */
export type TreeSlot =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly entries: readonly IdeDirEntry[] }

/** Per-session IDE view state. */
export interface IdeStoreState {
  /** Workspace-relative paths in open order ('' = root, never openable as a file). */
  openTabs: string[]
  /** Workspace-relative path of the focused editor tab, or null. */
  activeFile: string | null
  /** Unsaved-change flags keyed by workspace-relative path. */
  dirty: Record<string, boolean>
  /** Explorer slots keyed by workspace-relative directory ('' = root). */
  tree: Record<string, TreeSlot>
  /** Whether the explorer panel is collapsed to zero width. */
  explorerCollapsed: boolean
}

/** Declared action shape used to give the exported factory a stable return type. */
export type IdeActions = {
  openFile: (draft: IdeStoreState, path: string) => void
  closeFile: (draft: IdeStoreState, path: string) => void
  setActive: (draft: IdeStoreState, path: string | null) => void
  setDirty: (draft: IdeStoreState, path: string, dirty: boolean) => void
  setTree: (draft: IdeStoreState, path: string, slot: TreeSlot) => void
  setExplorerCollapsed: (draft: IdeStoreState, collapsed: boolean) => void
}

/** Component-facing (draft-stripped) action face, as the framework binds it. */
export type IdeBakedActions = {
  openFile: (path: string) => void
  closeFile: (path: string) => void
  setActive: (path: string | null) => void
  setDirty: (path: string, dirty: boolean) => void
  setTree: (path: string, slot: TreeSlot) => void
  setExplorerCollapsed: (collapsed: boolean) => void
}

/**
 * Declares the per-session IDE state and write surface.
 * @returns the store handle.
 */
export function createIdeStore(): EngineStoreHandle<IdeStoreState, IdeActions> {
  return defineStore({
    init: (): IdeStoreState => ({ openTabs: [], activeFile: null, dirty: {}, tree: {}, explorerCollapsed: false }),
    actions: {
      openFile: (d, path: string) => {
        if (!d.openTabs.includes(path)) d.openTabs = [...d.openTabs, path]
        d.activeFile = path
      },
      closeFile: (d, path: string) => {
        const index = d.openTabs.indexOf(path)
        if (index === -1) return
        d.openTabs = d.openTabs.filter(tab => tab !== path)
        delete d.dirty[path]
        if (d.activeFile === path) {
          const next = d.openTabs.length > 0 ? d.openTabs[d.openTabs.length - 1] ?? null : null
          d.activeFile = next
        }
      },
      setActive: (d, path: string | null) => { d.activeFile = path },
      setDirty: (d, path: string, dirty: boolean) => {
        if (dirty) d.dirty = { ...d.dirty, [path]: true }
        else {
          const next = { ...d.dirty }
          delete next[path]
          d.dirty = next
        }
      },
      setTree: (d, path: string, slot: TreeSlot) => {
        d.tree = { ...d.tree, [path]: slot }
      },
      setExplorerCollapsed: (d, collapsed: boolean) => { d.explorerCollapsed = collapsed },
    },
  })
}
