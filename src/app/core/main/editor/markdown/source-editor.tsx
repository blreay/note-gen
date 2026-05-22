'use client'

import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from 'next-themes'

interface SourceEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  className?: string
}

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
      extensions.push(syntaxHighlighting(defaultHighlightStyle))
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
