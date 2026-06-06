'use client'

import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
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
  const themeCompartmentRef = useRef(new Compartment())
  onChangeRef.current = onChange

  const { theme, systemTheme } = useTheme()
  const isDark = theme === 'dark' || (theme === 'system' && systemTheme === 'dark')

  const getThemeExtension = useCallback((dark: boolean) => {
    return dark ? oneDark : syntaxHighlighting(lightHighlightStyle)
  }, [])

  const getExtensions = useCallback((dark: boolean, compartment: Compartment) => {
    return [
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
      compartment.of(dark ? oneDark : syntaxHighlighting(lightHighlightStyle)),
    ]
  }, [])

  // Create editor once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const compartment = themeCompartmentRef.current

    const state = EditorState.create({
      doc: initialContent,
      extensions: getExtensions(isDark, compartment),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle initialContent changes via dispatch (preserves undo history)
  useEffect(() => {
    if (!viewRef.current) return

    const view = viewRef.current
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== initialContent) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: initialContent,
        },
      })
    }
  }, [initialContent])

  // Handle theme changes via compartment reconfiguration (preserves undo history)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        getThemeExtension(isDark)
      ),
    })
  }, [isDark, getThemeExtension])

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${className || ''}`}
    />
  )
}
