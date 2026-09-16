/**
 * IdeView: the per-session IDE conversation-view tab.
 *
 * Composition: VS-Codium-like shell (activity bar / collapsible file
 * explorer / editor column with tab strip and status bar) plus a
 * Copilot-style chat column on the right. The view declares both
 * `data-conversation-composer-overlay` (the sanctioned full-height view
 * contract: the render site constrains `.viewArea` to `flex: 1 1 0;
 * min-height: 0; overflow: hidden`, so the editor gets a real viewport
 * instead of growing with its content) and `data-conversation-composer-hidden`
 * (hide the global prompt bar — this tab is its own input surface: the chat
 * column carries the composer, wired to the same per-session input machine
 * the Chat tab uses).
 *
 * Pure component: all data arrives through the slot store shares and the
 * injected per-session controller; no ctx access.
 */

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsStore, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { IdeController } from './controller.ts'
import type { createIdeStore } from './ide-store.ts'
import { ChatIcon, CloseIcon, FilesIcon, SaveIcon } from './icons.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { FileExplorer } from './FileExplorer.tsx'
import { MonacoView, disposeModel, saveModel } from './MonacoView.tsx'

/** Injected face: one host-backed controller per session. */
export interface IdeViewInjected {
  control: IdeController
}

/** Full props: view runtime seats + IDE store + injected controller. */
export type IdeViewProps =
  ConvViewProps
  & PropsStore<ReturnType<typeof createIdeStore>>
  & InjectFace<IdeViewInjected>

/** Build an IDE view for the session. */
export function IdeView(props: IdeViewProps) {
  const { useStore, actions, control } = props
  const [chatOpen, setChatOpen] = useState(true)
  const openTabs = useStore(s => s.openTabs)
  const activeFile = useStore(s => s.activeFile)
  const dirty = useStore(s => s.dirty)
  const explorerCollapsed = useStore(s => s.explorerCollapsed)

  const onOpenFile = (path: string): void => {
    actions.openFile(path)
  }

  const onCloseTab = (path: string): void => {
    disposeModel(path)
    actions.closeFile(path)
  }

  const onSave = (): void => {
    if (activeFile === null) return
    void saveModel(control, activeFile).then(ok => {
      if (ok) actions.setDirty(activeFile, false)
    })
  }

  return (
    <div style={styles.root} data-conversation-composer-overlay="" data-conversation-composer-hidden="" data-ide-view="">
      <ActivityBar
        chatOpen={chatOpen}
        explorerOpen={!explorerCollapsed}
        onToggleChat={() => { setChatOpen(open => !open) }}
        onToggleExplorer={() => { actions.setExplorerCollapsed(!explorerCollapsed) }}
      />
      {!explorerCollapsed && (
        <FileExplorer
          useStore={useStore}
          setTree={actions.setTree}
          control={control}
          onOpenFile={onOpenFile}
          onCollapse={() => { actions.setExplorerCollapsed(true) }}
        />
      )}
      <div style={styles.editorColumn}>
        <div style={styles.tabStrip}>
          {openTabs.map(path => {
            const active = path === activeFile
            const name = path.split('/').pop() ?? path
            return (
              <div
                key={path}
                style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
                onClick={() => { actions.setActive(path) }}
                title={path}
              >
                <span style={styles.tabName}>{name}</span>
                {dirty[path] === true && <span style={styles.dirtyDot} title="Unsaved changes">●</span>}
                <button
                  type="button"
                  style={styles.tabClose}
                  aria-label={`Close ${name}`}
                  onClick={event => { event.stopPropagation(); onCloseTab(path) }}
                >
                  <CloseIcon />
                </button>
              </div>
            )
          })}
          <button type="button" style={styles.saveButton} onClick={onSave} title="Save file (Ctrl+S)">
            <SaveIcon />
            <span>Save</span>
          </button>
        </div>
        <MonacoView useStore={useStore} setDirty={actions.setDirty} control={control} />
        <div style={styles.statusBar}>
          <span style={styles.statusLeft}>
            {activeFile !== null ? activeFile : 'No file open'}
          </span>
          <span style={styles.statusRight}>Spaces: 2 · UTF-8 · Monaco</span>
        </div>
      </div>
      {chatOpen && <ChatPanel useSession={props.useSession} useInput={props.useInput} inputActions={props.inputActions} />}
    </div>
  )
}

/** Narrow vertical rail with the explorer/chat toggles (VS Code style). */
function ActivityBar(props: {
  chatOpen: boolean
  explorerOpen: boolean
  onToggleChat: () => void
  onToggleExplorer: () => void
}) {
  return (
    <div style={styles.activityBar}>
      <button
        type="button"
        style={{ ...styles.activityItem, ...(props.explorerOpen ? styles.activityActive : {}) }}
        onClick={props.onToggleExplorer}
        title="Toggle Explorer"
      >
        <FilesIcon />
      </button>
      <button
        type="button"
        style={{ ...styles.activityItem, ...(props.chatOpen ? styles.activityActive : {}) }}
        onClick={props.onToggleChat}
        title="Toggle assistant panel"
      >
        <ChatIcon />
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    minHeight: 0,
    background: '#1e1e1e',
    color: '#cccccc',
    fontSize: 13,
  },
  activityBar: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 44,
    flex: '0 0 auto',
    background: '#333333',
    paddingTop: 6,
  },
  activityItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 40,
    border: 'none',
    background: 'transparent',
    color: '#cccccc',
    cursor: 'pointer',
  },
  activityActive: {
    borderLeft: '2px solid #ffffff',
    background: '#2d2d2d',
  },
  editorColumn: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
  },
  tabStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 'none',
    background: '#252526',
    borderBottom: '1px solid #1e1e1e',
    overflowX: 'auto',
    minHeight: 34,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRight: '1px solid #1e1e1e',
    cursor: 'pointer',
    color: '#969696',
    userSelect: 'none',
  },
  tabActive: {
    background: '#1e1e1e',
    color: '#ffffff',
  },
  tabName: {
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dirtyDot: {
    color: '#ffffff',
    fontSize: 10,
  },
  tabClose: {
    display: 'flex',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    color: '#969696',
    cursor: 'pointer',
    padding: '0 2px',
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    marginRight: 8,
    background: '#0e639c',
    color: '#ffffff',
    border: 'none',
    borderRadius: 3,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flex: 'none',
    background: '#007acc',
    color: '#ffffff',
    padding: '0 10px',
    height: 22,
    fontSize: 11,
  },
  statusLeft: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusRight: {
    flex: 'none',
  },
}
