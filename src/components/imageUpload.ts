import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'
import { fileToScaledBlob, blobToDataUrl } from '../lib/image'

const imageUploadKey = new PluginKey<DecorationSet>('imageUploadPlaceholder')

type Meta =
  | { add: { id: string; pos: number; dom: HTMLElement } }
  | { remove: { id: string } }

/**
 * Shows an "Uploading…" placeholder where an image is being uploaded, then the
 * real image replaces it. The placeholder is a ProseMirror *decoration* — it
 * lives outside the document, so it never appears in `getHTML()` and can't be
 * persisted. Nothing broken is ever saved, even if the doc autosaves mid-upload:
 * the note simply has no image until the upload resolves and a real node is
 * inserted. See {@link uploadImageWithPlaceholder}.
 */
export const ImageUploadPlaceholder = Extension.create({
  name: 'imageUploadPlaceholder',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: imageUploadKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, set: DecorationSet) {
            set = set.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(imageUploadKey) as Meta | undefined
            if (meta && 'add' in meta) {
              set = set.add(tr.doc, [
                Decoration.widget(meta.add.pos, meta.add.dom, {
                  id: meta.add.id,
                  // Stable key → the view keeps this exact DOM node across
                  // redraws, so live progress mutations to it persist.
                  key: meta.add.id,
                }),
              ])
            } else if (meta && 'remove' in meta) {
              const { id } = meta.remove
              set = set.remove(
                set.find(undefined, undefined, (spec) => spec.id === id),
              )
            }
            return set
          },
        },
        props: {
          decorations(state: EditorState) {
            return imageUploadKey.getState(state)
          },
        },
      }),
    ]
  },
})

function placeholderPos(editor: Editor, id: string): number | null {
  const set = imageUploadKey.getState(editor.state)
  const found = set?.find(undefined, undefined, (spec) => spec.id === id)
  return found && found.length ? found[0].from : null
}

/**
 * Insert an "Uploading…" placeholder at the cursor, upload the (downscaled)
 * image, then swap the placeholder for the real image node carrying the Cloud
 * Storage URL. On failure the image is inserted inline as a data URL so it isn't
 * lost. The placeholder shows a dimmed local preview of the very image, so the
 * note immediately reflects what's coming.
 */
export async function uploadImageWithPlaceholder(
  editor: Editor,
  file: File,
  upload: (blob: Blob, onProgress?: (fraction: number) => void) => Promise<string>,
): Promise<void> {
  let blob: Blob
  try {
    blob = await fileToScaledBlob(file)
  } catch (err) {
    console.error('Could not read image:', err)
    return
  }

  const previewUrl = URL.createObjectURL(blob)
  const id = crypto.randomUUID()
  const { dom, setProgress } = buildPlaceholder(previewUrl)

  if (editor.isDestroyed) {
    URL.revokeObjectURL(previewUrl)
    return
  }
  editor.view.dispatch(
    editor.state.tr.setMeta(imageUploadKey, {
      add: { id, pos: editor.state.selection.from, dom },
    }),
  )

  const swapIn = (src: string) => {
    if (editor.isDestroyed) return
    const at = placeholderPos(editor, id)
    const tr = editor.state.tr.setMeta(imageUploadKey, { remove: { id } })
    const node = editor.schema.nodes.image.create({ src })
    if (at != null) tr.replaceWith(at, at, node)
    else tr.insert(editor.state.selection.from, node)
    editor.view.dispatch(tr)
  }

  try {
    const url = await upload(blob, setProgress)
    // The uploaded URL is a remote Storage link the browser hasn't fetched yet.
    // Preload it (into cache) before swapping, so the placeholder stays put and
    // the real image renders instantly instead of blanking out while it loads.
    await preloadImage(url)
    swapIn(url)
  } catch (err) {
    console.error('Image upload failed; keeping it inline:', err)
    swapIn(await blobToDataUrl(blob)) // inline data URL renders immediately
  } finally {
    URL.revokeObjectURL(previewUrl)
  }
}

/** Resolve once the browser has loaded `src` (or errored — never hang). */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

function buildPlaceholder(previewUrl: string): {
  dom: HTMLElement
  setProgress: (fraction: number) => void
} {
  const wrap = document.createElement('div')
  wrap.className = 'image-uploading'
  wrap.setAttribute('contenteditable', 'false')

  const img = document.createElement('img')
  img.src = previewUrl
  img.alt = ''
  wrap.appendChild(img)

  const label = document.createElement('span')
  label.className = 'image-uploading__label'
  const spinner = document.createElement('span')
  spinner.className = 'image-uploading__spinner'
  const text = document.createElement('span')
  text.textContent = 'Uploading…'
  label.append(spinner, text)
  wrap.appendChild(label)

  const bar = document.createElement('span')
  bar.className = 'image-uploading__bar'
  const fill = document.createElement('span')
  fill.className = 'image-uploading__fill'
  bar.appendChild(fill)
  wrap.appendChild(bar)

  const setProgress = (fraction: number) => {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100)
    text.textContent = `Uploading… ${pct}%`
    fill.style.width = `${pct}%`
  }

  return { dom: wrap, setProgress }
}
