export function matchesShortcut(event: KeyboardEvent, shortcutValue: string): boolean {
  if (!shortcutValue) return false

  const parts = shortcutValue.split('+').map(p => p.trim().toLowerCase())
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (event.key.toLowerCase() !== key) return false

  const needsCtrl = modifiers.includes('control') || modifiers.includes('commandorcontrol')
  const needsMeta = modifiers.includes('meta') || modifiers.includes('commandorcontrol')
  const needsShift = modifiers.includes('shift')
  const needsAlt = modifiers.includes('alt')

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlOrMeta = isMac ? event.metaKey : event.ctrlKey

  if (modifiers.includes('commandorcontrol')) {
    if (!ctrlOrMeta) return false
  } else {
    if (needsCtrl && !event.ctrlKey) return false
    if (needsMeta && !event.metaKey) return false
  }

  if (needsShift && !event.shiftKey) return false
  if (needsAlt && !event.altKey) return false

  if (!needsShift && event.shiftKey) return false
  if (!needsAlt && event.altKey) return false
  if (!modifiers.includes('commandorcontrol')) {
    if (!needsCtrl && event.ctrlKey) return false
    if (!needsMeta && event.metaKey) return false
  }

  return true
}
