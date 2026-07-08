import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { SaveState } from '@/hooks/useVariantAttempt'

interface Props {
  itemId:    string
  value:     string
  onChange:  (itemId: string, value: string) => void
  saveState: SaveState
  disabled?: boolean
}

export function VariantAnswerInput({ itemId, value, onChange, saveState, disabled }: Props) {
  return (
    <div className="flex items-center gap-2 mt-3">
      <input
        type="text"
        value={value}
        onChange={e => onChange(itemId, e.target.value)}
        disabled={disabled}
        placeholder="Введите ответ"
        className="flex-1 max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                   disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        data-testid={`answer-input-${itemId}`}
      />
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        {saveState === 'saving' && (
          <Loader2 size={16} className="animate-spin text-gray-400" />
        )}
        {saveState === 'saved' && (
          <CheckCircle2 size={16} className="text-green-500" />
        )}
        {saveState === 'error' && (
          <XCircle size={16} className="text-red-500" aria-label="Ошибка сохранения" />
        )}
      </span>
    </div>
  )
}
