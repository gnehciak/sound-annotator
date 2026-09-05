import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import Popover from '../../components/Popover'
import {
  ELEMENTS,
  LAYERS,
  categoriesPresent,
  type ElementsData,
} from '../../lib/musicElements'
import type { PluginEditorProps } from '../../lib/notePlugins'
import ElementSection from './ElementSection'

const emptyData = (): ElementsData => ({ fields: {} })

export default function ElementsEditor({ data, onChange, readOnly }: PluginEditorProps) {
  const value = (data as ElementsData | undefined) ?? emptyData()
  const fields = value.fields ?? {}

  // Visible categories: those with a value, plus any added this session.
  const [openIds, setOpenIds] = useState<string[]>(() =>
    categoriesPresent(value).map((c) => c.id),
  )
  const [addOpen, setAddOpen] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  const setLayer = (id: string | undefined) => onChange({ ...value, layer: id })

  const setField = (fieldId: string, v: string | undefined) => {
    const nextFields = { ...fields }
    if (v) nextFields[fieldId] = v
    else delete nextFields[fieldId]
    onChange({ ...value, fields: nextFields })
  }

  const addCategory = (id: string) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    setAddOpen(false)
  }

  const removeCategory = (catId: string) => {
    const cat = ELEMENTS.find((c) => c.id === catId)
    const nextFields = { ...fields }
    cat?.fields.forEach((f) => delete nextFields[f.id])
    setOpenIds((ids) => ids.filter((x) => x !== catId))
    onChange({ ...value, fields: nextFields })
  }

  const sections = ELEMENTS.filter((c) => openIds.includes(c.id))
  const addable = ELEMENTS.filter((c) => !openIds.includes(c.id))

  return (
    <div className="pb-3.5">
      {/* Layer — the note's identity */}
      <div className="px-3.5 pb-2.5 pt-3.5">
        <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
          Layer
        </div>
        <div className="flex flex-wrap gap-1">
          {LAYERS.map((l) => {
            const active = value.layer === l.id
            return (
              <button
                key={l.id}
                type="button"
                disabled={readOnly}
                onClick={() => setLayer(active ? undefined : l.id)}
                aria-pressed={active}
                className="chip chip-outline press gap-1.5 px-2.5 py-1.5 text-[11px]"
                style={{
                  ['--hue' as string]: l.color,
                  color: active ? l.color : 'rgb(var(--text-muted))',
                }}
              >
                {l.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Element sections */}
      {sections.map((cat) => (
        <ElementSection
          key={cat.id}
          category={cat}
          fields={fields}
          readOnly={readOnly}
          onChangeField={setField}
          onRemove={() => removeCategory(cat.id)}
        />
      ))}

      {sections.length === 0 && readOnly && (
        <div className="px-3.5 py-2.5 text-[12px] text-muted">No elements recorded.</div>
      )}

      {/* Add element — reveals a category section on demand. The menu is
          portalled (Popover) so it isn't clipped by the window's scroll area. */}
      {!readOnly && addable.length > 0 && (
        <div className="border-t border-line/60 px-3.5 pt-2.5">
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="btn-ghost btn-sm press hover:border-accent hover:text-accentink"
          >
            <Plus size={12} /> Add element
          </button>
          <Popover
            open={addOpen}
            anchorRef={addBtnRef}
            onClose={() => setAddOpen(false)}
            width={192}
            className="origin-top-left py-1"
          >
            {addable.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => addCategory(c.id)}
                className="flex w-full items-center px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:bg-raised hover:text-fg"
              >
                {c.label}
              </button>
            ))}
          </Popover>
        </div>
      )}
    </div>
  )
}
