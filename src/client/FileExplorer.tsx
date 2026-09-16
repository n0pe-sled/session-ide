/**
 * FileExplorer: the workspace tree panel of the IDE tab.
 *
 * Reads and writes only the declared IDE store (tree slots keyed by
 * workspace-relative directory) and the per-session host-backed controller;
 * expansion state therefore survives view switches. Directories lazily list
 * on first expand; entries are fetched once and held until the session is
 * pruned. Icons are the VS Code-style SVG set (`icons.tsx`).
 */

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { ChevronIcon, FileIcon, FolderIcon, FolderOpenIcon, LinkIcon } from './icons.tsx'
import type { IdeController } from './controller.ts'
import type { IdeBakedActions, IdeStoreState } from './ide-store.ts'
import type { IdeDirEntry } from '../shared/remote.ts'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Props: store read hook, tree action, controller, open-file callback, collapse. */
export interface FileExplorerProps {
  useStore: SnapshotSelectorHook<IdeStoreState>
  setTree: IdeBakedActions['setTree']
  control: IdeController
  onOpenFile: (path: string) => void
  onCollapse: () => void
}

/** One directory slot rendered as rows; child dirs recurse. */
function TreeNode(props: {
  path: string
  label: string
  depth: number
  useStore: SnapshotSelectorHook<IdeStoreState>
  setTree: IdeBakedActions['setTree']
  control: IdeController
  onOpenFile: (path: string) => void
}) {
  const { path, label, depth, useStore, setTree, control, onOpenFile } = props
  const slot = useStore(s => s.tree[path])
  const open = slot !== undefined && slot.kind !== 'error'
  const ready = slot?.kind === 'ready'

  useEffect(() => {
    // Root loads itself; child dirs load on first expand (toggle below).
    if (path === '' && slot === undefined) {
      setTree('', { kind: 'loading' })
      void control.list('').then(outcome => {
        setTree('', outcome.ok
          ? { kind: 'ready', entries: outcome.entries }
          : { kind: 'error', message: outcome.error.message })
      })
    }
  }, [path, slot, setTree, control])

  const load = (): void => {
    setTree(path, { kind: 'loading' })
    void control.list(path).then(outcome => {
      setTree(path, outcome.ok
        ? { kind: 'ready', entries: outcome.entries }
        : { kind: 'error', message: outcome.error.message })
    })
  }

  const onToggle = (): void => {
    if (ready) {
      // Toggle closed: drop the slot so the next open re-lists (cheap, and
      // keeps the tree honest about files changed outside the editor).
      setTree(path, { kind: 'loading' })
      void control.list(path).then(outcome => {
        setTree(path, outcome.ok
          ? { kind: 'ready', entries: outcome.entries }
          : { kind: 'error', message: outcome.error.message })
      })
      return
    }
    if (path !== '' || slot === undefined) load()
  }

  return (
    <div>
      <button
        type="button"
        style={{ ...styles.row, paddingLeft: 8 + depth * 14 }}
        onClick={onToggle}
        title={path === '' ? 'Workspace root' : path}
      >
        <span style={styles.chevron}>
          <ChevronIcon open={open} />
        </span>
        <span style={styles.rowIcon}>{open ? <FolderOpenIcon /> : <FolderIcon />}</span>
        <span style={styles.rowLabel}>{label}</span>
      </button>
      {slot?.kind === 'error' && (
        <div style={{ ...styles.error, paddingLeft: 24 + depth * 14 }}>{slot.message}</div>
      )}
      {slot?.kind === 'ready' && slot.entries.map(entry => (
        <EntryRow
          key={entry.name}
          entry={entry}
          base={path}
          depth={depth + 1}
          useStore={useStore}
          setTree={setTree}
          control={control}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

/** One file/link row: opens a file, expands a directory. */
function EntryRow(props: {
  entry: IdeDirEntry
  base: string
  depth: number
  useStore: SnapshotSelectorHook<IdeStoreState>
  setTree: IdeBakedActions['setTree']
  control: IdeController
  onOpenFile: (path: string) => void
}) {
  const { entry, base, depth, useStore, setTree, control, onOpenFile } = props
  const full = base === '' ? entry.name : `${base}/${entry.name}`
  const active = useStore(s => s.activeFile === full)

  if (entry.kind === 'dir') {
    return (
      <TreeNode
        path={full}
        label={entry.name}
        depth={depth}
        useStore={useStore}
        setTree={setTree}
        control={control}
        onOpenFile={onOpenFile}
      />
    )
  }

  return (
    <button
      type="button"
      style={{ ...styles.row, ...(active ? styles.rowActive : {}), paddingLeft: 26 + depth * 14 }}
      onClick={() => { onOpenFile(full) }}
      title={full}
    >
      <span style={styles.rowIcon}>{entry.kind === 'link' ? <LinkIcon /> : <FileIcon />}</span>
      <span style={styles.rowLabel}>{entry.name}</span>
    </button>
  )
}

/** The explorer panel: root tree over the session workspace. */
export function FileExplorer(props: FileExplorerProps) {
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerText}>EXPLORER</span>
        <button
          type="button"
          style={styles.collapseButton}
          aria-label="Collapse explorer"
          title="Collapse explorer"
          onClick={props.onCollapse}
        >
          <ChevronIcon open={false} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
      <div style={styles.body}>
        <TreeNode
          path=""
          label="workspace"
          depth={0}
          useStore={props.useStore}
          setTree={props.setTree}
          control={props.control}
          onOpenFile={props.onOpenFile}
        />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: 220,
    flex: '0 0 auto',
    background: '#252526',
    borderRight: '1px solid #1e1e1e',
    minHeight: 0,
    overflow: 'hidden',
  },
  header: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 6px 6px 10px',
    letterSpacing: 1,
    fontSize: 11,
    color: '#cccccc',
  },
  headerText: {},
  collapseButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 20,
    border: 'none',
    background: 'transparent',
    color: '#cccccc',
    cursor: 'pointer',
    borderRadius: 3,
  },
  body: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    paddingBottom: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#cccccc',
    fontSize: 13,
    textAlign: 'left',
    padding: '2px 8px',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  rowActive: {
    background: '#37373d',
  },
  chevron: {
    display: 'flex',
    alignItems: 'center',
    width: 12,
    flex: 'none',
    color: '#8a8a8a',
  },
  rowIcon: {
    display: 'flex',
    alignItems: 'center',
    width: 18,
    flex: 'none',
  },
  rowLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  error: {
    fontSize: 11,
    color: '#f48771',
    padding: '2px 8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
