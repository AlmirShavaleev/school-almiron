import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Switch } from '@/components/course/CourseReminderSettings'
import {
  REMINDER_KIND_OPTIONS, studentReminderPatch, studentReminderSwitches, type ReminderKind, type ReminderSwitches,
} from '@/lib/studentReminders'

/**
 * §264. Ученик у себя в «Настройках» → «Уведомления»: какие напоминания в Telegram ему не нужны. Колонки
 * `notification_prefs.remind_*` своей строки (по умолчанию всё включено). Что включено в курсе, решает учитель — здесь
 * ученик может только выключить для себя. Каждый переключатель сохраняется сразу.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface TableLike {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<Res<Record<string, unknown>>> } }
    upsert: (row: Record<string, unknown>, o: { onConflict: string }) => PromiseLike<Res<unknown>>
  }
}

export function StudentReminderPrefs({ profileId, telegramOn }: { profileId: string; telegramOn: boolean }) {
  const [state, setState] = useState<ReminderSwitches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const db = supabase as unknown as TableLike
    Promise.resolve(db.from('notification_prefs').select('*').eq('user_id', profileId).maybeSingle())
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message || 'Не удалось загрузить')
        setState(studentReminderSwitches(data))
      })
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить'); setState(studentReminderSwitches(null)) } })
    return () => { cancelled = true }
  }, [profileId])

  async function toggle(kind: ReminderKind) {
    if (!state) return
    const prev = state
    const next = { ...state, [kind]: !state[kind] }
    setState(next)
    setSaving(true)
    const db = supabase as unknown as TableLike
    const { error: e } = await db.from('notification_prefs').upsert(
      { user_id: profileId, ...studentReminderPatch(next), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setSaving(false)
    if (e) { setState(prev); setError(e.message || 'Не удалось сохранить') } else setError(null)
  }

  return (
    <section data-testid="student-reminder-prefs" className="platform-surface rounded-card p-4 sm:p-5">
      <h2 className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-graphite-950">
        <Send size={17} className="text-primary-600" aria-hidden />Напоминания в Telegram
      </h2>
      <p className="m-0 mt-0.5 text-sm text-graphite-500">
        {telegramOn
          ? 'Бот напомнит о сроках и работах. Ненужное можно выключить.'
          : 'Напоминания приходят только в Telegram — подключите его ниже, и они начнут приходить.'}
      </p>
      <div className="mt-2 divide-y divide-graphite-100">
        {REMINDER_KIND_OPTIONS.map(k => (
          <div key={k.kind} className="flex items-center justify-between gap-4 py-2.5" data-testid={`student-reminder-${k.kind}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-graphite-900">{k.label}</div>
              <div className="text-xs text-graphite-500">{k.when}</div>
            </div>
            <Switch on={state?.[k.kind] ?? true} label={k.label} disabled={!state || saving} testId={`student-reminder-toggle-${k.kind}`} onToggle={() => void toggle(k.kind)} />
          </div>
        ))}
      </div>
      <p className="m-0 mt-2 text-[12.5px] text-graphite-500">
        Не больше 2 напоминаний в день, с 22:00 до 08:00 — тишина. Какие напоминания есть в курсе, решает учитель.
      </p>
      {error && <p className="m-0 mt-1 text-[12.5px] font-semibold text-verdict-bad-ink" role="alert" data-testid="student-reminder-error">Не удалось сохранить — попробуйте ещё раз.</p>}
    </section>
  )
}
