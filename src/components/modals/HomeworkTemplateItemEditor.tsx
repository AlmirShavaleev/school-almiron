import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Settings2, X } from 'lucide-react'
import { Select, Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import type { BuilderItem } from '@/hooks/useHomeworkTemplateBuilder'
import { GRADING_MODE_LABELS, validateGradingSpec, type HomeworkGradingMode } from '@/types/homeworkGrading'

interface Props {
  item: BuilderItem
  index: number
  count: number
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onUpdate: (patch: Partial<Pick<BuilderItem, 'custom_number' | 'max_score' | 'grading_mode' | 'grading_spec' | 'ai_check_enabled'>>) => void
}

const MODES: HomeworkGradingMode[] = ['manual', 'exact_answer', 'numeric_tolerance', 'multiple_choice', 'formula', 'rubric', 'ai_assisted']

export function HomeworkTemplateItemEditor({ item, index, count, onMove, onRemove, onUpdate }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [specText, setSpecText] = useState(() => JSON.stringify(item.grading_spec, null, 2))
  const [specError, setSpecError] = useState<string | null>(null)

  function applySpecText() {
    try {
      const parsed = JSON.parse(specText)
      const result = validateGradingSpec(item.grading_mode, parsed, item.max_score)
      if (!result.ok) { setSpecError(result.error); return }
      setSpecError(null)
      onUpdate({ grading_spec: parsed })
    } catch {
      setSpecError('Невалидный JSON')
    }
  }

  function handleModeChange(mode: HomeworkGradingMode) {
    onUpdate({ grading_mode: mode, ...(mode === 'manual' ? { grading_spec: {}, ai_check_enabled: false } : {}) })
    setSpecText(mode === 'manual' ? '{}' : specText)
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <div className="flex flex-col gap-0.5">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="disabled:opacity-30 text-gray-400 hover:text-gray-700"><ChevronUp size={14} /></button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="disabled:opacity-30 text-gray-400 hover:text-gray-700"><ChevronDown size={14} /></button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <span>№{index + 1}</span>
            <span className="text-xs text-gray-400 truncate">задача №{item.task.external_id}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{item.max_score ?? '—'} б.</span>
            <span>{GRADING_MODE_LABELS[item.grading_mode]}</span>
            <span className={cn(item.ai_check_enabled ? 'text-primary-600' : 'text-gray-400')}>
              AI: {item.ai_check_enabled ? 'вкл' : 'выкл'}
            </span>
          </div>
        </div>
        <button type="button" onClick={() => setSettingsOpen(o => !o)} className="text-gray-400 hover:text-primary-600" aria-label="Настройки проверки">
          <Settings2 size={16} />
        </button>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500" aria-label="Удалить">
          <Trash2 size={16} />
        </button>
      </div>

      {settingsOpen && (
        <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/60">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Custom-номер (для PDF)" value={item.custom_number} onChange={e => onUpdate({ custom_number: e.target.value })} />
            <Input label="Максимальный балл" type="number" min={0}
              value={item.max_score ?? ''} onChange={e => onUpdate({ max_score: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <Select label="Тип проверки" value={item.grading_mode} onChange={e => handleModeChange(e.target.value as HomeworkGradingMode)}
            options={MODES.map(m => ({ value: m, label: GRADING_MODE_LABELS[m] }))} />

          {item.grading_mode !== 'manual' && (
            <>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={item.ai_check_enabled} onChange={e => onUpdate({ ai_check_enabled: e.target.checked })} />
                Разрешить AI-проверку (в будущем)
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Параметры проверки (JSON)</label>
                <textarea rows={5} value={specText} onChange={e => setSpecText(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                {specError && <p className="text-xs text-red-500 mt-1">{specError}</p>}
                <Button size="sm" variant="secondary" className="mt-2" onClick={applySpecText}>Применить</Button>
              </div>
            </>
          )}
          <button type="button" onClick={() => setSettingsOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <X size={12} />Свернуть настройки
          </button>
        </div>
      )}
    </div>
  )
}
