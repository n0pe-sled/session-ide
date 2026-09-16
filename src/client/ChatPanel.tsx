/**
 * ChatPanel: the Copilot-style chat column of the IDE tab.
 *
 * Reads the live conversation through the framework hooks the view slot
 * already receives (`useSession` snapshot, `useInput` machine state,
 * `inputActions`), renders a compact transcript (user / assistant / context /
 * error nodes; tool calls as chips) and submits through the same input
 * machine the Chat tab uses — so drafts and sent messages are continuous
 * between the two tabs. Assistant text renders through the shared
 * `MarkdownText` component (untrusted-Markdown safe, baseline external).
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the 'conversation.view' props seat (declared by the slot's owner)
// is what types useSession / useInput / inputActions below.
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Props: the framework conversation-view seats this panel consumes. */
export type ChatPanelProps = Pick<ConvViewProps, 'useSession' | 'useInput' | 'inputActions'>

/** Extract plain text from a ContentBlock via structural duck-typing. */
function blockText(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null
  const candidate = block as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : null
}

/** Render one message row. */
function MessageRow(props: { role: 'user' | 'assistant' | 'system'; children: ReactNode; label?: string }) {
  const role = props.role
  return (
    <div style={role === 'user' ? styles.userRow : styles.row}>
      {role !== 'user' && (
        <div style={styles.label}>{props.label ?? (role === 'assistant' ? 'Assistant' : 'System')}</div>
      )}
      <div style={role === 'user' ? styles.userBubble : styles.bubble}>{props.children}</div>
    </div>
  )
}

/**
 * Render the chat column for the active session.
 * @param props - conversation-view seats (useSession / useInput / inputActions).
 */
export function ChatPanel({ useSession, useInput, inputActions }: ChatPanelProps) {
  const nodes = useSession(s => s.nodes)
  const partial = useSession(s => s.partial)
  const running = useSession(s => s.running)
  const draft = useInput(s => s.draft)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const partialText = partial?.blocks
    .filter(block => block.kind === 'text')
    .map(block => (block as { kind: 'text'; text: string }).text)
    .join('\n\n') ?? ''

  const transcriptLength = nodes.length + (partialText.length > 0 ? 1 : 0)
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [transcriptLength, partialText])

  const send = (): void => {
    if (draft.trim() === '') return
    inputActions.submit()
  }

  return (
    <div style={styles.root} data-ide-chat="">
      <div style={styles.header}>
        <span style={styles.headerText}>ASSISTANT</span>
        <span style={running ? styles.running : styles.idle}>{running ? '●' : '○'}</span>
      </div>
      <div ref={scrollRef} style={styles.transcript}>
        {transcriptLength === 0 && (
          <div style={styles.empty}>Ask the agent about the code you are editing.</div>
        )}
        {nodes.map(node => {
          switch (node.kind) {
            case 'user':
            case 'steering': {
              const text = node.content.map(blockText).filter((part): part is string => part !== null).join('\n\n')
              if (text === '') return null
              return <MessageRow key={node.seq} role="user">{text}</MessageRow>
            }
            case 'assistant': {
              const text = node.blocks
                .filter(block => block.kind === 'text')
                .map(block => (block as { kind: 'text'; text: string }).text)
                .join('\n\n')
              const reasoning = node.blocks
                .filter(block => block.kind === 'reasoning')
                .map(block => (block as { kind: 'reasoning'; text: string }).text)
                .join('\n\n')
              const tools = node.blocks
                .filter(block => block.kind === 'tool-call')
                .map(block => (block as { kind: 'tool-call'; name: string }).name)
              return (
                <MessageRow key={node.seq} role="assistant">
                  {text !== '' && <MarkdownText text={text} />}
                  {reasoning !== '' && <div style={styles.reasoning}>… {reasoning.slice(0, 400)}</div>}
                  {tools.length > 0 && (
                    <div style={styles.tools}>
                      {tools.map(name => <span key={name} style={styles.toolChip}>⚙ {name}</span>)}
                    </div>
                  )}
                </MessageRow>
              )
            }
            case 'context': {
              const text = node.content.map(blockText).filter((part): part is string => part !== null).join('\n\n')
              if (text === '') return null
              return <MessageRow key={node.seq} role="system" label="Context"><span style={styles.systemText}>{text.slice(0, 200)}</span></MessageRow>
            }
            case 'turn-error':
              return <MessageRow key={node.seq} role="system" label="Error"><span style={styles.errorText}>{node.message}</span></MessageRow>
            case 'compaction':
              return <div key={node.seq} style={styles.systemText}>— history compacted —</div>
            case 'turn-max-tokens':
              return <div key={node.seq} style={styles.systemText}>— response hit the token cap —</div>
            default:
              return null
          }
        })}
        {partialText !== '' && (
          <MessageRow role="assistant">
            <MarkdownText text={partialText} streaming />
          </MessageRow>
        )}
      </div>
      <div style={styles.composer}>
        <textarea
          style={styles.textarea}
          placeholder="Ask the agent…  (Enter to send, Shift+Enter for newline)"
          value={draft}
          onChange={event => { inputActions.setDraft(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button type="button" style={styles.send} onClick={send}>
          Send
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: 320,
    flex: '0 0 auto',
    background: '#1f1f1f',
    borderLeft: '1px solid #333333',
    minHeight: 0,
  },
  header: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    letterSpacing: 1,
    fontSize: 11,
    color: '#cccccc',
    borderBottom: '1px solid #333333',
  },
  headerText: {},
  running: { color: '#4ec9b0', fontSize: 10 },
  idle: { color: '#6e6e6e', fontSize: 10 },
  transcript: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  empty: {
    fontSize: 12,
    color: '#808080',
    padding: '4px 0',
  },
  row: {},
  userRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.5,
    color: '#7f7f7f',
    marginBottom: 2,
  },
  bubble: {
    fontSize: 13,
    lineHeight: 1.45,
    color: '#d4d4d4',
    wordBreak: 'break-word',
  },
  userBubble: {
    fontSize: 13,
    lineHeight: 1.45,
    color: '#e8e8e8',
    background: '#2d2d2d',
    borderRadius: 6,
    padding: '6px 10px',
    maxWidth: '85%',
    wordBreak: 'break-word',
  },
  reasoning: {
    fontSize: 12,
    color: '#808080',
    fontStyle: 'italic',
    marginTop: 2,
  },
  tools: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  toolChip: {
    fontSize: 11,
    color: '#9cdcfe',
    background: '#2d2d30',
    border: '1px solid #3c3c3c',
    borderRadius: 4,
    padding: '1px 6px',
  },
  systemText: {
    fontSize: 11,
    color: '#6a9955',
  },
  errorText: {
    fontSize: 12,
    color: '#f48771',
  },
  composer: {
    flex: 'none',
    borderTop: '1px solid #333333',
    padding: 8,
    display: 'flex',
    gap: 6,
    alignItems: 'stretch',
  },
  textarea: {
    flex: '1 1 auto',
    minHeight: 64,
    maxHeight: 160,
    resize: 'none',
    background: '#2d2d2d',
    color: '#d4d4d4',
    border: '1px solid #3c3c3c',
    borderRadius: 4,
    padding: '6px 8px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  },
  send: {
    flex: 'none',
    background: '#0e639c',
    color: '#ffffff',
    border: 'none',
    borderRadius: 4,
    padding: '0 12px',
    fontSize: 12,
    cursor: 'pointer',
  },
}
