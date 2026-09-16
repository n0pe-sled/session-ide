/**
 * MonacoView: the editor pane of the IDE tab.
 *
 * Wraps the Monaco editor (the editor component used by VS Code and its
 * Codium builds), bound to one in-memory model per workspace file so
 * content, undo history, and view state survive tab switches (the models
 * live on the Monaco singleton, not the React tree). The host file server
 * feeds each model on first open; Ctrl/Cmd+S saves through the same
 * controller the explorer uses.
 *
 * Import shape: `editor.api` (the standalone editor core plus its standard
 * contributions) and `basic-languages` Monarch grammars only — the worker
 * backed language services (json/css/html/typescript and the LSP client)
 * are deliberately NOT imported: the harness serves no separate worker or
 * chunk files, and tokenization runs on the main thread.
 *
 * Everything visual is VS Code Dark+ (monaco's built-in `vs-dark` theme) and
 * the component owns no business state: open tabs and dirty flags arrive
 * through the declared IDE store.
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { IdeController } from './controller.ts'
import type { IdeBakedActions, IdeStoreState } from './ide-store.ts'

/** One registered editor instance (the component is single-instance per view). */
let editor: monaco.editor.IStandaloneCodeEditor | null = null
/** In-memory models keyed by workspace-relative path (survive remounts). */
const models = new Map<string, monaco.editor.ITextModel>()
/** Paths whose read is still in flight: a setValue there must not mark dirty. */
const loading = new Set<string>()

/** The in-memory URI one workspace file owns inside Monaco. */
function modelUri(path: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://dsh-ide/${encodeURIComponent(path)}`)
}

/** Get (or lazily create) the model for a workspace file. */
function modelFor(path: string): monaco.editor.ITextModel {
  const existing = models.get(path)
  if (existing !== undefined) return existing
  const model = monaco.editor.createModel('', undefined, modelUri(path))
  models.set(path, model)
  return model
}

/** Content of one workspace model ('' for never-loaded files). */
export function modelText(path: string): string {
  return models.get(path)?.getValue() ?? ''
}

/** Dispose one workspace model (tab closed for good). */
export function disposeModel(path: string): void {
  const model = models.get(path)
  if (model === undefined) return
  model.dispose()
  models.delete(path)
}

/** Whether a read is still in flight for a path (dirty-marker suppression). */
export function isModelLoading(path: string): boolean {
  return loading.has(path)
}

/** Save one open file through the host controller; true on success. */
export async function saveModel(control: IdeController, path: string): Promise<boolean> {
  const model = models.get(path)
  if (model === undefined) return false
  const outcome = await control.write(path, model.getValue())
  return outcome.ok
}

/** Props: the IDE store read hook, dirty-marker action, and the controller. */
export interface MonacoViewProps {
  useStore: SnapshotSelectorHook<IdeStoreState>
  setDirty: IdeBakedActions['setDirty']
  control: IdeController
}

const styles: Record<string, CSSProperties> = {
  root: {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    background: '#1e1e1e',
  },
}

/**
 * Render the editor pane for the active IDE tab.
 * @param props - store read hook, dirty-marker action, and the controller.
 */
export function MonacoView({ useStore, setDirty, control }: MonacoViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeFile = useStore(s => s.activeFile)

  // Create the editor once per mount; keep models and dirty flags across it.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const instance = monaco.editor.create(container, {
      theme: 'vs-dark',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      tabSize: 2,
      insertSpaces: true,
      padding: { top: 8, bottom: 8 },
      wordWrap: 'off',
    })
    editor = instance
    // Debug/inspection handle (harmless, module-table-isolated).
    ;(globalThis as { __dshIdeEditor?: unknown }).__dshIdeEditor = instance

    const changeSubscription = instance.onDidChangeModelContent(() => {
      const model = instance.getModel()
      if (model === null) return
      const path = [...models.entries()].find(([, m]) => m === model)?.[0]
      if (path === undefined || loading.has(path)) return
      setDirty(path, true)
    })

    // addCommand returns a keybinding id string; editor disposal removes it.
    instance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      async () => {
        const model = instance.getModel()
        if (model === null) return
        const path = [...models.entries()].find(([, m]) => m === model)?.[0]
        if (path === undefined) return
        if (await saveModel(control, path)) setDirty(path, false)
      },
    )

    return () => {
      changeSubscription.dispose()
      instance.dispose()
      if (editor === instance) editor = null
    }
  }, [control, setDirty])

  // Bind the editor to the active file; load content on first open.
  useEffect(() => {
    const instance = editor
    if (instance === null) return
    if (activeFile === null) {
      instance.setModel(null)
      return
    }
    const model = modelFor(activeFile)
    instance.setModel(model)
    if (model.getValue() === '' && !loading.has(activeFile)) {
      loading.add(activeFile)
      void control.read(activeFile).then((outcome) => {
        if (!outcome.ok) {
          model.setValue(`// ${outcome.error.message}`)
          loading.delete(activeFile)
          return
        }
        model.setValue(outcome.binary
          ? `Binary file: ${activeFile}\n\nThis file is not editable in the IDE tab.`
          : outcome.content)
        loading.delete(activeFile)
        setDirty(activeFile, false)
      })
    }
  }, [activeFile, control, setDirty])

  return <div ref={containerRef} style={styles.root} data-monaco-container="" />
}
