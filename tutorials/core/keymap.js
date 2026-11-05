// Key lookup is independent of DOM effects so browser/input conflicts can be tested.
export function editorAction(event, { lessons = false } = {}) {
  if (event.defaultPrevented || event.isComposing || event.repeat
    || event.target?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]')) return null;
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    if (!event.altKey && key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (!event.metaKey && event.code?.startsWith('Numpad') && ['Numpad1', 'Numpad3', 'Numpad7'].includes(event.code)) {
      return `opposite:${event.code.slice(-1)}`;
    }
    return null;
  }
  if (event.altKey) return null;
  // Radio groups and tabs handle their own arrow keys (and stop them there); Enter / Space stay with buttons.
  if (['Enter', ' '].includes(event.key) && event.target?.closest?.('button, a, summary')) return null;
  if (event.shiftKey && key === 'a') return 'add';
  if (!lessons && event.key === ' ' && !event.shiftKey) return 'play';   // Blender: Space plays the timeline
  if (!lessons && key === 'tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) return 'nodes';   // Tab: into the node editor                 // Blender: Shift+A, the Add menu
  const actions = { n: 'panel', p: 'panel', v: 'frame', home: 'frame', '?': 'help', g: 'grab', r: 'rotate',
    t: 'toolbar', x: 'delete', delete: 'delete' };
  if (actions[key]) return actions[key];
  const views = { Numpad1: 'view:1', Numpad3: 'view:3', Numpad7: 'view:7', Numpad5: 'projection', NumpadDecimal: 'selection' };
  if (views[event.code]) return views[event.code];
  if (lessons && ['ArrowRight', 'PageDown'].includes(event.key)) return 'next';
  if (lessons && ['ArrowLeft', 'PageUp'].includes(event.key)) return 'previous';
  return null;
}
