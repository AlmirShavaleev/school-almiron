import { useNavigate } from 'react-router-dom'
import { Eye, Undo2 } from 'lucide-react'
import { useStaffMode } from '@/store/staffModeStore'

/**
 * Жёлтая полоса предпросмотра «глазами ученика» (§178). Стоит под шапкой на
 * всю ширину содержимого — на каждой странице, пока режим включён, чтобы
 * владелец ни на одном экране не принял предпросмотр за настоящий кабинет и
 * не ждал, что его ответы и отметки куда-то запишутся.
 *
 * «Вернуться» переводит в режим учителя и уводит на `/dashboard` — из
 * ученической страницы возвращаться некуда, кроме как в свой кабинет.
 */
export function StudentPreviewBanner() {
  const { preview, exitPreview } = useStaffMode()
  const navigate = useNavigate()

  if (!preview) return null

  function handleExit() {
    exitPreview()
    navigate('/dashboard', { replace: true })
  }

  return (
    <div
      role="status"
      data-testid="student-preview-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 md:px-8"
    >
      <Eye size={16} className="shrink-0 text-amber-700" />
      <span className="font-semibold">Предпросмотр глазами ученика</span>
      <span className="hidden text-amber-800 sm:inline">·</span>
      <span className="text-amber-800">ответы и отметки не сохраняются</span>
      <button
        type="button"
        onClick={handleExit}
        data-testid="student-preview-exit"
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-50"
      >
        <Undo2 size={13} />
        Вернуться
      </button>
    </div>
  )
}
