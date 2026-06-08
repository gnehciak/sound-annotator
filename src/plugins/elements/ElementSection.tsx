import { X } from 'lucide-react'
import type { ElementCategory } from '../../lib/musicElements'
import FieldSelect from '../../components/FieldSelect'

interface Props {
  category: ElementCategory
  fields: Record<string, string>
  readOnly?: boolean
  onChangeField: (fieldId: string, value: string | undefined) => void
  onRemove: () => void
}

/** One element category: a mono-labelled group of FieldSelects. */
export default function ElementSection({
  category,
  fields,
  readOnly,
  onChangeField,
  onRemove,
}: Props) {
  return (
    <div className="border-t border-line/60">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg">
          {category.label}
        </span>
        <div className="flex-1" />
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            title={`Remove ${category.label}`}
            aria-label={`Remove ${category.label}`}
            className="press rounded p-0.5 text-muted hover:text-danger"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3.5 pb-3.5">
        {category.fields.map((f) => (
          <FieldSelect
            key={f.id}
            label={f.label}
            value={fields[f.id]}
            options={f.options}
            allowCustom={f.allowCustom}
            readOnly={readOnly}
            onChange={(v) => onChangeField(f.id, v)}
          />
        ))}
      </div>
    </div>
  )
}
