import { useCallback, useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/utils/cn'
import { supabase } from '@/lib/supabase'
import {
  REMINDER_KIND_OPTIONS, courseReminderRow, courseReminderSwitches, studentReminderText, type ReminderKind, type ReminderSwitches,
} from '@/lib/studentReminders'

/**
 * §264. «Напоминания в Telegram» во вкладке курса «Настройки» (макет §264, экран В): какие напоминания ученикам
 * этого курса отправлять. Строка `course_reminder_settings` (нет строки — по умолчанию: всё, кроме «Пробник завтра»);
 * писать может персонал курса (RLS через course_is_staff). Каждый переключатель сохраняется сразу.
 *
 * Слева — как выглядят сообщения: тексты собирает тот же модуль, что очередь (`studentReminderText`), — пример не
 * может разойтись с тем, что придёт ученику.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface TableLike {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<Res<Record<string, unknown>>> } }
    upsert: (row: Record<string, unknown>, o: { onConflict: string }) => PromiseLike<Res<unknown>>
  }
}

/**
 * Примеры для превью — придуманы, как в макете. «Скоро проверочная» в 08:45: момент 07:45 попадает в тишину, поэтому
 * сообщение придёт в 08:00 и честно скажет «через 45 минут» (в макете было 07:45 — до правила тишины).
 */
const SAMPLE_NOW = new Date('2026-10-03T05:00:00Z')
const SAMPLES: { kind: ReminderKind; payload: Record<string, unknown>; now?: Date; at: string; button: string }[] = [
  { kind: 'hw_due_tomorrow', payload: { kind: 'hw_due_tomorrow', title: 'Динамика. Законы Ньютона' }, at: 'вт 19:00', button: 'Открыть ДЗ' },
  {
    kind: 'check_soon', at: 'сб 08:00', button: 'Открыть работу', now: SAMPLE_NOW,
    payload: { kind: 'check_soon', title: 'Движение по окружности', work_kind: 'check', opens_at: '2026-10-03T05:45:00Z', closes_at: '2026-10-03T06:30:00Z' },
  },
  {
    kind: 'no_photo', at: 'сб 09:20', button: 'Загрузить фото', now: new Date('2026-10-03T06:20:00Z'),
    payload: { kind: 'no_photo', work_kind: 'check', closes_at: '2026-10-03T06:30:00Z' },
  },
  { kind: 'streak', payload: { kind: 'streak', streak: 6 }, at: 'чт 18:30', button: 'Задача дня' },
]

export function CourseReminderSettings({ courseId }: { courseId: string }) {
  const [state, setState] = useState<ReminderSwitches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<ReminderKind | null>(null)
  const [saved, setSaved] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    const db = supabase as unknown as TableLike
    Promise.resolve(db.from('course_reminder_settings').select('*').eq('course_id', courseId).maybeSingle())
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) { setError(e.message || 'Не удалось загрузить'); return }
        setState(courseReminderSwitches(data))
      })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить') })
    return () => { cancelled = true }
  }, [courseId, tick])

  const toggle = useCallback(async (kind: ReminderKind) => {
    if (!state) return
    const prev = state
    const next = { ...state, [kind]: !state[kind] }
    setState(next)
    setSaving(kind)
    setSaved(false)
    const db = supabase as unknown as TableLike
    const { error: e } = await db.from('course_reminder_settings').upsert(courseReminderRow(courseId, next), { onConflict: 'course_id' })
    setSaving(null)
    if (e) {
      setState(prev)
      setError(e.message || 'Не удалось сохранить')
    } else {
      setError(null)
      setSaved(true)
    }
  }, [state, courseId])

  return (
    <section data-testid="course-reminder-settings" className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 flex items-center gap-2 text-[17px] font-extrabold text-graphite-950">
          <Send size={17} className="text-primary-600" aria-hidden />Напоминания в Telegram
        </h2>
        <p className="m-0 mt-0.5 text-sm text-graphite-500">Какие напоминания отправлять ученикам этого курса. Ученик может выключить любое у себя в настройках.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="flex max-w-[420px] flex-col gap-2.5 rounded-card bg-[#d9e8f3] p-3.5" aria-label="Пример сообщений бота" data-testid="reminder-samples">
          {SAMPLES.map(s => (
            <div key={s.kind} className="max-w-[92%] rounded-[14px] rounded-bl-[4px] bg-[#effdde] px-3 py-2 text-[13.5px] text-[#1d2b14]">
              {studentReminderText(s.payload, s.now ?? SAMPLE_NOW)}
              <span className="mt-1.5 block font-bold underline">{s.button}</span>
              <small className="mt-1 block text-right text-[11px] opacity-70">{s.at}</small>
            </div>
          ))}
        </div>

        <div className="platform-surface overflow-hidden rounded-card">
          {error && (
            <div className="flex flex-wrap items-center gap-2 border-b border-graphite-100 px-4 py-2.5 text-sm text-verdict-bad-ink" role="alert">
              <span data-testid="reminder-settings-error">Не удалось {state ? 'сохранить' : 'загрузить'} настройки напоминаний.</span>
              {!state && <button type="button" onClick={() => setTick(t => t + 1)} className="font-semibold text-primary-700 hover:underline">Повторить</button>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr>
                  {['Напоминание', 'Когда', 'Кому', 'Вкл.'].map(h => (
                    <th key={h} className="bg-graphite-50 px-3 py-2 text-left text-[11.5px] font-semibold text-graphite-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REMINDER_KIND_OPTIONS.map(k => {
                  const on = state?.[k.kind] ?? k.defaultOn
                  return (
                    <tr key={k.kind} data-testid={`reminder-row-${k.kind}`}>
                      <td className="border-t border-graphite-100 px-3 py-2 font-bold text-graphite-900">{k.label}</td>
                      <td className="border-t border-graphite-100 px-3 py-2 text-graphite-600">{k.when}</td>
                      <td className="border-t border-graphite-100 px-3 py-2 text-graphite-600">{k.who}</td>
                      <td className="border-t border-graphite-100 px-3 py-2">
                        <Switch
                          on={on}
                          label={k.label}
                          disabled={!state || saving != null}
                          testId={`reminder-toggle-${k.kind}`}
                          onToggle={() => void toggle(k.kind)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="m-0 px-4 py-3 text-[12.5px] text-graphite-500">
            Не больше 2 напоминаний в день одному ученику; с 22:00 до 08:00 — тишина. Без привязанного Telegram — ничего не отправляется.
            {saved && <span className="ml-1 font-semibold text-verdict-ok-ink" data-testid="reminder-settings-saved">Сохранено.</span>}
          </p>
        </div>
      </div>
    </section>
  )
}

export function Switch({ on, label, disabled, testId, onToggle }: { on: boolean; label: string; disabled?: boolean; testId?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60',
        on ? 'bg-primary-600' : 'bg-graphite-400',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}
