// The block model: a note's content is a list of typed blocks, each rendered and
// edited by a plugin (see notePlugins.ts). This module owns the migration shim
// that lets older notes — which only have `contentHtml` — be read uniformly as
// blocks, plus small helpers for the built-in `text` block.
import type { Annotation, NoteBlock } from '../types'

/** Plugin type key for the built-in rich-text block. */
export const TEXT_BLOCK = 'text'

/** Payload shape of a `text` block. */
export interface TextBlockData {
  html: string
}

const newId = () => crypto.randomUUID()

/** A fresh block of the given type. */
export function makeBlock(type: string, data: unknown): NoteBlock {
  return { id: newId(), type, data }
}

/** A fresh `text` block carrying the given HTML (empty by default). */
export function makeTextBlock(html = ''): NoteBlock {
  return makeBlock(TEXT_BLOCK, { html } satisfies TextBlockData)
}

/**
 * The blocks for an annotation, migrating legacy notes on the fly: a note with
 * no blocks becomes a single `text` block carrying its `contentHtml`. Idempotent
 * — a note that already has blocks is returned as-is.
 */
export function blocksOf(a: Annotation): NoteBlock[] {
  if (a.blocks && a.blocks.length > 0) return a.blocks
  return [makeTextBlock(a.contentHtml ?? '')]
}

/** Ensure an annotation carries an explicit `blocks` array (idempotent). */
export function withBlocks(a: Annotation): Annotation {
  if (a.blocks && a.blocks.length > 0) return a
  return { ...a, blocks: blocksOf(a) }
}

/** Narrow a block's payload to text-block data (undefined if it isn't one). */
export function asTextData(block: NoteBlock | undefined): TextBlockData | undefined {
  if (!block || block.type !== TEXT_BLOCK) return undefined
  const data = block.data as Partial<TextBlockData> | undefined
  return typeof data?.html === 'string' ? { html: data.html } : { html: '' }
}

/** The note's primary text-block HTML (falls back to legacy `contentHtml`). */
export function primaryTextHtml(a: Annotation): string {
  const text = (a.blocks ?? []).find((b) => b.type === TEXT_BLOCK)
  return asTextData(text)?.html ?? a.contentHtml ?? ''
}
