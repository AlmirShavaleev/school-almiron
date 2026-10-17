import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ClipboardCheck, CreditCard, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Switch } from '@/components/course/CourseReminderSettings'
import { TelegramConnectionBlock } from '@/pages/SettingsPage'
import { STUDENT_NOTIF_GROUPS, studentPrefsFrom, type StudentPrefKey } from '@/lib/studentNotifGroups'

/**
 * «Настройки → Уведомления» у ученика (письмо ЛК_стиль_настройки_ученика.md,
 * 16.10): только то, что реально отправляется, по группам — «Домашние
 * задания», «Пробники», «Подписка», «Каналы». Что убрано и почему —
 * `src/lib/studentNotifGroups.ts`.
 *
 * Всё уходит в Telegram: пока он не привязан, переключатели неактивны, а
 * «Привязать Telegram» — сверху группы «Каналы». Каждый переключатель
 * сохраняется сразу, своей колонкой `notification_prefs` (остальные колонки
 * строки не трогаем).
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface TableLike {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<Res<Record<string, unknown>>> } }
    upsert: (row: Record<string, unknown>, o: { onConflict: string }) => PromiseLike<Res<unknown>>
  }
}
const db = () => supabase as unknown as TableLike

const ICON = { homework: <ClipboardCheck size={18} aria-hidden />, mocks: <BookOpen size={18} aria-hidden /> }

export function StudentNotificationsTab({ profileId }: { profileId: string }) {
  const [prefs, setPrefs] = useState<Record<StudentPrefKey, boolean> | null>(null)
  const [telegram, setTelegram] = useState(false)
  const [variant, setVariant] = useState(true)
  const [linked, setLinked] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve(db().from('notification_prefs').select('*').eq('user_id', profileId).maybeSingle())
      .then(({ data }) => {
        if (cancelled) return
        setPrefs(studentPrefsFrom(data))
        setTelegram(data?.telegram === true)
        setVariant(data?.telegram_variant_assignments !== false)
      })
      .catch(() => { if (!cancelled) setPrefs(studentPrefsFrom(null)) })
    return () => { cancelled = true }
  }, [profileId])

  async function save(patch: Record<string, boolean>, rollback: () => void) {
    const { error: e } = await db().from('notification_prefs').upsert(
      { user_id: profileId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (e) { rollback(); setError('Не удалось сохранить — попробуйте ещё раз.') } else setError(null)
  }

  function toggle(key: StudentPrefKey) {
    if (!prefs) return
    const prev = prefs
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    if (key === 'telegram_variant_assignments') setVariant(next[key])
    void save({ [key]: next[key] }, () => { setPrefs(prev); if (key === 'telegram_variant_assignments') setVariant(prev[key]) })
  }

  const onLinkedChange = useCallback((v: boolean) => setLinked(v), [])
  const off = !linked || !telegram
  const hint = linked === false ? 'Привяжите Telegram в «Каналах» ниже — уведомления приходят туда.'
    : linked && !telegram ? 'Сообщения в Telegram выключены — включите их в «Каналах» ниже.'
    : null

  return (
    <div className="space-y-4" data-testid="student-notif-settings">
      {hint && <p className="stu-note-warn" data-testid="student-notif-hint">{hint}</p>}

      {STUDENT_NOTIF_GROUPS.map(g => (
        <section key={g.id} className="stu-card stu-set" data-testid={`student-notif-group-${g.id}`}>
          <h2 className="stu-set-h">{ICON[g.id]}{g.title}</h2>
          {g.note && <p className="stu-muted text-[13px]">{g.note}</p>}
          <div className="stu-set-rows">
            {g.items.map(i => (
              <div key={i.key} className="stu-set-row" data-testid={`student-notif-${i.key}`}>
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold">{i.label}</div>
                  <div className="stu-muted text-[13px]">{i.sub}</div>
                </div>
                <Switch
                  on={(i.key === 'telegram_variant_assignments' ? variant : prefs?.[i.key]) ?? i.def}
                  label={i.label}
                  disabled={!prefs || off}
                  testId={`student-notif-toggle-${i.key}`}
                  onToggle={() => toggle(i.key)}
                />
              </div>
            ))}
          </div>
          {g.id === 'homework' && (
            <p className="stu-muted text-[12.5px]">Напоминаний не больше 2 в день, с 22:00 до 08:00 — тишина. Какие напоминания есть в курсе, решает преподаватель.</p>
          )}
        </section>
      ))}

      <section className="stu-card stu-set" data-testid="student-notif-group-subscription">
        <h2 className="stu-set-h"><CreditCard size={18} aria-hidden />Подписка</h2>
        <div className="stu-set-row">
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold">Подписка заканчивается, списание не прошло</div>
            <div className="stu-muted text-[13px]">Приходят всегда — в Telegram и на почту, иначе можно незаметно потерять доступ к курсу</div>
          </div>
          <span className="stu-tag t-grey shrink-0">всегда</span>
        </div>
      </section>

      <section className="space-y-2" data-testid="student-notif-group-channels">
        <h2 className="stu-set-h px-1"><Send size={18} aria-hidden />Каналы</h2>
        <TelegramConnectionBlock
          profileId={profileId}
          telegramEnabled={telegram}
          variantTelegramEnabled={variant}
          onToggleTelegram={() => {
            const prev = telegram
            setTelegram(!prev)
            void save({ telegram: !prev }, () => setTelegram(prev))
          }}
          onLinkedChange={onLinkedChange}
        />
        <p className="stu-muted px-1 text-[13px]" data-testid="student-notif-email">
          Почта: на неё приходят только письма о подписке — чек, продление, окончание.
        </p>
      </section>

      {error && <p className="text-[13px] font-semibold text-[var(--redInk)]" role="alert" data-testid="student-notif-error">{error}</p>}
    </div>
  )
}
