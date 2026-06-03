import { useEffect, useRef, type ReactNode } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Bold, Italic, Heading2, List, Quote, ImagePlus } from 'lucide-react'
import { fileToScaledDataUrl } from '../lib/image'
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
}

export default function AnnotationEditor({
  content,
  onChange,
  autofocus,
  showToolbar,
  readOnly = false,
  noteId,
  mentionItems,
}: Props) {
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const insertImageFile = async (file: File) => {
    const src = await fileToScaledDataUrl(file)
    editorRef.current?.chain().focus().setImage({ src }).run()
  }

  const insertImageFiles = (files: FileList) => {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    images.forEach((f) => void insertImageFile(f))
    return images.length > 0
  }

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      createMention(mentionItems, noteId),
    ],
    content,
    autofocus: autofocus ? 'end' : false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'text-[13px] leading-relaxed text-fg px-3 py-2',
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

  // Keep editability in sync when the global view-only mode is toggled live.
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  return (
    <div>
      {editor && showToolbar && !readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line/60 px-2 py-1">
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
          <span className="mx-1 h-3.5 w-px bg-line" />
          <ToolbarButton
            icon={<ImagePlus size={14} />}
            title="Insert image"
            onClick={() => fileInputRef.current?.click()}
          />
          <span className="ml-1 font-mono text-[10px] text-muted">
            type @ to link a note
          </span>
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
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-muted hover:bg-raised hover:text-fg'
      }`}
    >
      {icon}
    </button>
  )
}
