'use client'

import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from 'next-themes'

interface SourceEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  className?: string
}

const lightHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: 'bold', fontSize: '1.4em' },
  { tag: t.heading2, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: t.heading3, fontWeight: 'bold', fontSize: '1.1em' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.link, color: '#0366d6', textDecoration: 'underline' },
  { tag: t.url, color: '#0366d6' },
  { tag: t.monospace, color: '#e01e5a', backgroundColor: '#f6f8fa' },
  { tag: t.meta, color: '#6f42c1' },
  { tag: t.comment, color: '#6a737d' },
  { tag: t.processingInstruction, color: '#22863a' },
])

export function SourceEditor({ initialContent, onChange, className }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { theme, systemTheme } = useTheme()
  const isDark = theme === 'dark' || (theme === 'system' && systemTheme === 'dark')

  const getExtensions = useCallback((dark: boolean) => {
    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      markdown(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString())
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ]

    if (dark) {
      extensions.push(oneDark)
    } else {
      extensions.push(syntaxHighlighting(lightHighlightStyle))
    }

    return extensions
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: initialContent,
      extensions: getExtensions(isDark),
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!viewRef.current) return

    const view = viewRef.current
    const currentDoc = view.state.doc.toString()

    const state = EditorState.create({
      doc: currentDoc,
      extensions: getExtensions(isDark),
    })

    view.setState(state)
  }, [isDark, getExtensions])

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${className || ''}`}
    />
  )
}
