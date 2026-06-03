import { useState } from 'react'
import { Plus } from 'lucide-react'
import { usePresence } from '../../lib/usePresence'
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
  const addPop = usePresence(addOpen)

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
    <div className="pb-3">
      {/* Layer — the note's identity */}
      <div className="px-3 pb-2 pt-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
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
                className={`press flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] uppercase tracking-wider ${
                  active ? '' : 'border-line text-muted hover:text-fg'
                }`}
                style={active ? { borderColor: l.color, color: l.color } : undefined}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
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
        <div className="px-3 py-2 text-[12px] text-muted">No elements recorded.</div>
      )}

      {/* Add element — reveals a category section on demand */}
      {!readOnly && addable.length > 0 && (
        <div className="relative border-t border-line/60 px-3 pt-2">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="press inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-accent hover:text-accent"
          >
            <Plus size={12} /> Add element
          </button>
          {addPop.mounted && (
            <div
              className={`absolute left-3 top-full z-30 mt-1 w-48 origin-top-left rounded border border-line bg-panel py-1 shadow-lg ${
                addPop.closing ? 'animate-pop-out' : 'animate-pop-in'
              }`}
            >
              {addable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addCategory(c.id)}
                  className="flex w-full items-center px-2.5 py-1 text-left font-mono text-[11px] uppercase tracking-wider text-muted hover:bg-raised hover:text-fg"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
