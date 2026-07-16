import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, Heading2, List, Quote, ImagePlus, Loader2 } from 'lucide-react'
import { fileToScaledBlob, blobToDataUrl } from '../lib/image'
import { ResizableImage } from './resizableImage'
import { ImageUploadPlaceholder, uploadImageWithPlaceholder } from './imageUpload'
import { createMention } from './noteMention'
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
   * data URL (legacy / signed-out behaviour).
   */
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /**
   * When false, images are refused outright rather than falling back to a data
   * URL. Guests have no Blob storage (uploads are signed-in only), and the
   * fallback would base64 a screenshot straight into the project's
   * `annotations` jsonb — so for them "no uploader" must mean "no image", not
   * "inline it".
   */
  allowImages?: boolean
}

/** Imperative handle: drop the caret into the editor (used to focus new notes). */
export interface AnnotationEditorHandle {
  focus: () => void
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

  const insertImageFile = async (file: File) => {
    const ed = editorRef.current
    if (!ed) return
    if (!allowImages) return
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
      createMention(mentionItems, noteId),
    ],
    content,
    autofocus: autofocus ? 'end' : false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'text-[13px] leading-[1.65] text-fg px-3.5 pt-3 pb-4',
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

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.commands.focus('end'),
    }),
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
          {uploading > 0 ? (
            <span className="ml-1 flex items-center gap-1 font-mono text-[10px] text-accentink">
              <Loader2 size={11} className="animate-spin" />
              Uploading image…
            </span>
          ) : (
            <span className="ml-1 font-mono text-[10px] text-muted">
              type @ to link a note
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
    </div>
  )
})

export default AnnotationEditor

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
      className={`flex h-[27px] min-w-[27px] items-center justify-center rounded-sm px-[5px] transition-colors ${
        active
          ? 'bg-accent/15 text-accentink'
          : 'text-muted hover:bg-raised hover:text-fg'
      }`}
    >
      {icon}
    </button>
  )
}
