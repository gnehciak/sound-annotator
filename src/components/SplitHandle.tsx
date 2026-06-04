import type { PointerEvent } from 'react'

/**
 * The draggable divider between the player and notes columns. Hidden until the
 * split goes horizontal (`variantClass` carries the breakpoint's `:block`).
 * Pairs with {@link useNotesSplit}; shared by the editor and the ShareViewer.
 */
export default function SplitHandle({
  variantClass,
  dragging,
  onPointerDown,
  onDoubleClick,
}: {
  variantClass: string
  dragging: boolean
  onPointerDown: (e: PointerEvent) => void
  onDoubleClick?: () => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize player and notes panels"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
      className={`hidden w-1 shrink-0 cursor-col-resize touch-none transition-colors ${variantClass} ${
        dragging ? 'bg-accent' : 'bg-line hover:bg-accent/60'
      }`}
    />
  )
}
