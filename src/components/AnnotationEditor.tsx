import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Italic,
  Heading2,
  List,
  Quote,
  ImagePlus,
  Loader2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { fileToScaledBlob, blobToDataUrl } from '../lib/image'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'
import { ResizableImage } from './resizableImage'
import { ImageUploadPlaceholder, uploadImageWithPlaceholder } from './imageUpload'
import { createMention } from './noteMention'
import { PropertyTag } from './propertyTag'
import {
  PropertySuggest,
  suggestAt,
  suggestionsIn,
  type SuggestHit,
} from './propertySuggest'
import { ANALYSIS_TEMPLATE } from '../lib/propertyTags'
import Popover from './Popover'
import type { MentionItem } from './MentionList'

interface Props {
  content: string
  onChange: (html: string) => void
  autofocus?: boolean
  showToolbar?: boolean
  readOnly?: boolean
  noteId: string
  mentionItems: (query: string) => MentionItem[]
  /**
   * Upload a (downscaled) image blob to Cloud Storage and resolve with its
   * download URL, which is what gets stored in the note HTML. `onProgress`
   * receives a 0–1 fraction. When omitted, the image falls back to an inline
   * data URL (legacy behaviour, and the last resort if an upload fails).
   */
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /**
   * When false, images are refused outright rather than falling back to a data
   * URL — because that fallback base64s a screenshot straight into the
   * project's `annotations` jsonb, which is a far worse outcome than refusing.
   *
   * This used to be how guests were kept out of Blob storage. It no longer is:
   * guests upload with their project key like anyone else (imageCloud.ts). The
   * switch stays because "images are impossible here" and "the uploader
   * happens to be missing" must not collapse into "inline the bytes"; no
   * caller currently passes false.
   */
  allowImages?: boolean
}

/** Imperative handle: drop the caret into the editor (used to focus new notes). */
export interface AnnotationEditorHandle {
  focus: () => void
  /** Insert a property tag at the caret — the dictionary's way in. */
  insertProperty: (field: string, value: string) => void
  /** Drop the concept-by-concept scaffold in, and report whether it went. */
  insertTemplate: () => void
  /** Turn every underlined word into a tag at once; returns how many. */
  tagAllSuggestions: () => number
  /**
   * Insert a cross-reference to another note at the caret — the same atom the
   * "@" menu writes, reached instead from that note's own context menu (which
   * is the way round it happens when the note you want to name is the one you
   * are looking at in the list).
   */
  insertNoteRef: (id: string, label: string) => void
}

const AnnotationEditor = forwardRef<AnnotationEditorHandle, Props>(function AnnotationEditor(
  {
    content,
    onChange,
    autofocus,
    showToolbar,
    readOnly = false,
    noteId,
    mentionItems,
    uploadImage,
    allowImages = true,
  },
  ref,
) {
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  /** Transient: a guest tried to add an image (see insertImageFile). */
  const [imagesRefused, setImagesRefused] = useState(false)
  /**
   * The underlined word whose card is open, and the DOM span it points at.
   * The span is held in a ref rather than state because Popover anchors to a
   * live element, and the decoration is re-rendered on every keystroke.
   */
  const [suggestion, setSuggestion] = useState<SuggestHit | null>(null)
  const suggestAnchor = useRef<HTMLElement | null>(null)

  const insertImageFile = async (file: File) => {
    const ed = editorRef.current
    if (!ed) return
    // Refused (guest): say so. The image button is already hidden, but paste
    // and drag-drop have no button to hide — without this the image would just
    // vanish and the student would assume the app was broken.
    if (!allowImages) {
      setImagesRefused(true)
      window.setTimeout(() => setImagesRefused(false), 4000)
      return
    }
    // No uploader available → keep the old inline-data-URL behaviour.
    if (!uploadImage) {
      try {
        const blob = await fileToScaledBlob(file)
        ed.chain().focus().setImage({ src: await blobToDataUrl(blob) }).run()
      } catch (err) {
        console.error('Could not read image:', err)
      }
      return
    }
    // Cloud upload: an "Uploading…" placeholder shows in the note until the
    // download URL is ready, then the real image swaps in. (setUploading also
    // drives the toolbar chip.)
    setUploading((n) => n + 1)
    try {
      await uploadImageWithPlaceholder(ed, file, uploadImage)
    } finally {
      setUploading((n) => Math.max(0, n - 1))
    }
  }

  const insertImageFiles = (files: FileList) => {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    images.forEach((f) => void insertImageFile(f))
    return images.length > 0
  }

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      // trailingNode off: StarterKit otherwise force-appends an empty paragraph
      // after a terminal block (e.g. an image), creating an undeletable line
      // under it. With it off, the trailing line can be removed (Backspace —
      // see ResizableImage's keyboard shortcut).
      StarterKit.configure({ trailingNode: false }),
      ResizableImage.configure({ inline: false }),
      ImageUploadPlaceholder,
      PropertyTag,
      PropertySuggest,
      createMention(mentionItems, noteId),
    ],
    content,
    autofocus: autofocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
      // The word the card was offered for has just moved or changed (and if the
      // change *was* the tag being applied, the card's work is done).
      setSuggestion(null)
    },
    editorProps: {
      attributes: {
        class: 'text-[13px] leading-[1.65] text-fg px-3.5 pt-3 pb-4',
      },
      // Clicking an underlined word offers to make it a tag. `false` so the
      // click also does its ordinary job of placing the caret — the card is an
      // offer alongside the edit, never instead of it.
      handleClick: (view, pos, event) => {
        if (readOnly) return false
        const span = (event.target as HTMLElement | null)?.closest?.('.prop-suggest')
        const hit = span ? suggestAt(view.state, pos) : undefined
        suggestAnchor.current = hit ? (span as HTMLElement) : null
        setSuggestion(hit ?? null)
        return false
      },
      handlePaste: (_view, event) => {
        if (readOnly) return false
        const files = event.clipboardData?.files
        if (files && files.length && insertImageFiles(files)) {
          event.preventDefault()
          return true
        }
        return false
      },
      handleDrop: (_view, event) => {
        if (readOnly) return false
        const files = (event as DragEvent).dataTransfer?.files
        if (files && files.length && insertImageFiles(files)) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
  })
  editorRef.current = editor

  /**
   * Drop an inline atom at the caret with the spacing prose needs around it —
   * a trailing space the way the "@" menu does, and a leading one unless there
   * is already whitespace (or nothing) behind. Without it two atoms picked in
   * a row run together into what reads as a single word.
   */
  const putAtCaret = (node: { type: string; attrs: Record<string, unknown> }) => {
    const ed = editorRef.current
    if (!ed) return
    const before = ed.state.selection.$from.nodeBefore
    const spaced = !before || (before.isText && /\s$/.test(before.text ?? ''))
    ed
      .chain()
      .focus()
      .insertContent([
        ...(spaced ? [] : [{ type: 'text', text: ' ' }]),
        node,
        { type: 'text', text: ' ' },
      ])
      .run()
  }

  /**
   * Replace a range (or just the caret) with a property tag. `text` is the word
   * as the sentence spells it — passed when a word already on the page is being
   * turned into a chip, so the prose keeps its own capitalisation.
   */
  const putTag = (
    field: string,
    value: string,
    range?: { from: number; to: number },
    text?: string,
  ) => {
    const ed = editorRef.current
    if (!ed) return
    const chain = ed.chain().focus()
    const node = { type: 'propertyTag', attrs: { field, value, text: text ?? '' } }
    // Replacing a word leaves the spacing around it alone; inserting at the
    // caret has to supply it (see putAtCaret).
    if (range) {
      chain.insertContentAt(range, node)
      chain.run()
    } else {
      putAtCaret(node)
    }
  }

  /**
   * The analysis scaffold: one bullet per concept, each opening with that
   * concept's own tag. Written as real chips rather than bold words so the
   * headings are the same data as everything else — they colour themselves,
   * and a finished note reads back as "this paragraph is about Texture"
   * without the teacher having to tag the heading afterwards.
   */
  const insertTemplate = () => {
    const ed = editorRef.current
    if (!ed) return
    const list = {
      type: 'bulletList',
      content: ANALYSIS_TEMPLATE.map(([field, value]) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'propertyTag', attrs: { field, value, text: '' } },
              { type: 'text', text: ' — ' },
            ],
          },
        ],
      })),
    }
    // An untouched note is one empty paragraph; appending to it would leave a
    // blank line above the list, so the scaffold becomes the note instead.
    const empty = ed.state.doc.textContent.trim() === '' && ed.state.doc.childCount <= 1
    if (empty) ed.chain().focus().setContent(list).run()
    else ed.chain().focus('end').insertContent(list).run()
  }

  /**
   * Accept every underline at once. Applied back to front so each replacement
   * leaves the positions of the ones before it untouched, and in a single
   * chain so the whole sweep is one undo step.
   *
   * Where a word names two concepts ("thin" is Timbre and Texture) this takes
   * the first; the chip's own menu is how the other is chosen. That is the
   * trade a bulk action makes, and why the card still exists.
   */
  const tagAll = (): number => {
    const ed = editorRef.current
    if (!ed) return 0
    const hits = [...suggestionsIn(ed.state)].sort((a, b) => b.from - a.from)
    if (!hits.length) return 0
    let chain = ed.chain().focus()
    for (const h of hits) {
      const opt = h.options[0]
      chain = chain.insertContentAt(
        { from: h.from, to: h.to },
        { type: 'propertyTag', attrs: { field: opt.field, value: opt.value, text: h.text } },
      )
    }
    chain.run()
    return hits.length
  }

  // Deliberately built once. Every method here reaches the editor through
  // `editorRef`, so the closures captured on the first render stay correct for
  // the life of the component; listing them as dependencies would rebuild the
  // handle on each keystroke and buy nothing.
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.commands.focus('end'),
      insertProperty: (field, value) => putTag(field, value),
      insertTemplate: () => insertTemplate(),
      tagAllSuggestions: () => tagAll(),
      insertNoteRef: (id, label) => putAtCaret({ type: 'mention', attrs: { id, label } }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Keep editability in sync when the global view-only mode is toggled live.
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // Read-only previews: mirror external content changes (e.g. while the same
  // note is being edited in the inspector). `content` is otherwise only applied
  // once at mount. Skipped for editable instances so it never clobbers the caret.
  useEffect(() => {
    if (!editor || !readOnly) return
    if (content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [editor, readOnly, content])

  return (
    <div>
      {editor && showToolbar && !readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line/60 px-[11px] py-[7px]">
          <ToolbarButton
            icon={<Bold size={14} />}
            title="Bold"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={<Italic size={14} />}
            title="Italic"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={<Heading2 size={14} />}
            title="Heading"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          />
          <ToolbarButton
            icon={<List size={14} />}
            title="Bullet list"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={<Quote size={14} />}
            title="Quote"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          {allowImages && (
            <>
              <span className="mx-1.5 h-4 w-px bg-line" />
              <ToolbarButton
                icon={<ImagePlus size={14} />}
                title="Insert image"
                onClick={() => fileInputRef.current?.click()}
              />
            </>
          )}
          {imagesRefused ? (
            <span className="ml-1 flex animate-fade-in items-center gap-1 font-mono text-[10px] text-peak">
              <TriangleAlert size={11} />
              Images need an account — sign in to add them
            </span>
          ) : uploading > 0 ? (
            <span className="ml-1 flex items-center gap-1 font-mono text-[10px] text-accentink">
              <Loader2 size={11} className="animate-spin" />
              Uploading image…
            </span>
          ) : (
            <span className="ml-1 font-mono text-[10px] text-muted">
              type @, or click an underlined word
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) insertImageFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      )}
      <EditorContent editor={editor} />
      <SuggestCard
        hit={suggestion}
        anchorRef={suggestAnchor}
        onClose={() => setSuggestion(null)}
        onPick={(field, value, range, text) => {
          setSuggestion(null)
          putTag(field, value, range, text)
        }}
      />
    </div>
  )
})

export default AnnotationEditor

/**
 * The card behind an underlined word: the concept (or concepts) it names, one
 * click each. Nothing is applied until one is picked, and dismissing leaves the
 * prose exactly as typed — the underline is a reading of the text, not a claim
 * about it.
 */
function SuggestCard({
  hit,
  anchorRef,
  onClose,
  onPick,
}: {
  hit: SuggestHit | null
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  onPick: (
    field: string,
    value: string,
    range: { from: number; to: number },
    text: string,
  ) => void
}) {
  const theme = useResolvedTheme()
  return (
    <Popover
      open={!!hit}
      anchorRef={anchorRef}
      onClose={onClose}
      width={214}
      className="origin-top-left py-1"
    >
      <div className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        Tag as
      </div>
      {hit?.options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() =>
            onPick(opt.field, opt.value, { from: hit.from, to: hit.to }, hit.text)
          }
          title={`${opt.category} — ${opt.fieldLabel}`}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-raised hover:text-fg"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: opt.color }}
          />
          <span
            className="truncate"
            style={{ color: hueText(opt.color, theme) }}
          >
            {opt.value}
          </span>
          <span className="ml-auto shrink-0 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
            {opt.category}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClose}
        className="mt-1 flex w-full items-center gap-1.5 border-t border-line/60 px-2.5 pb-0.5 pt-2 text-left text-[12px] text-muted hover:text-fg"
      >
        <X size={12} /> Leave it as text
      </button>
    </Popover>
  )
}

function ToolbarButton({
  icon,
  title,
  active,
  onClick,
}: {
  icon: ReactNode
  title: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      data-active={active || undefined}
      className="btn-icon press h-[27px] w-auto min-w-[27px] px-[5px]"
    >
      {icon}
    </button>
  )
}
