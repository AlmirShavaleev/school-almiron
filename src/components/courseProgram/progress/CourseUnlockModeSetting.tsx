/**
 * §288. Настройка курса «Открытие уроков: по датам / по прохождению».
 * Переключает только админ или владелец платформы (`admin_course_unlock_mode_set`
 * отбивает остальных); персоналу курса режим просто показывается.
 */
import { useState } from 'react'
import { cn } from '@/utils/cn'
import { setCourseUnlockMode } from '@/lib/progressUnlock'

export function CourseUnlockModeSetting({ courseId, mode, canChange, onChanged }: {
  courseId: string
  mode: 'schedule' | 'progress'
  canChange: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function choose(next: 'schedule' | 'progress') {
    if (next === mode || busy) return
    const text = next === 'progress'
      ? 'Открывать уроки по прохождению? Ученикам сразу будут доступны первые 2 урока каждого раздела и уроки с наступившей датой, остальные — после закрытия предыдущего.'
      : 'Вернуть открытие уроков по датам? Персональные отметки сохранятся, но действовать не будут.'
    if (!window.confirm(text)) return
    setBusy(true)
    setErr(null)
    try {
      await setCourseUnlockMode(courseId, next)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2" data-testid="unlock-mode">
      <h3 className="text-[17px] font-semibold text-graphite-900">Открытие уроков</h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Открытие уроков">
        {(['schedule', 'progress'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={m === mode} disabled={!canChange || busy}
            onClick={() => choose(m)} data-testid={`unlock-mode-${m}`}
            className={cn('rounded-full px-4 py-2 text-[15px]',
              m === mode ? 'bg-gold-300 font-semibold text-graphite-900' : 'bg-white text-graphite-700 hover:bg-graphite-100',
              !canChange && 'cursor-default')}>
            {m === 'schedule' ? 'По датам' : 'По прохождению'}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-graphite-500">
        {mode === 'progress'
          ? 'Урок открыт ученику, если он один из первых двух в разделе, наступила его дата, закрыт предыдущий урок или учитель открыл его вручную на вкладке «Прохождение».'
          : 'Уроки открываются по датам и переключателю «Открыта/Закрыта», как раньше.'}
        {!canChange && ' Режим меняет администратор.'}
      </p>
      {err && <p className="text-[13px] text-verdict-bad-ink">✕ {err}</p>}
    </section>
  )
}
