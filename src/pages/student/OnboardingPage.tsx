/**
 * §290-B. Анкета ученика «с улицы» (`/start`), шаг 1 пути после регистрации:
 * класс, экзамен (пока только ЕГЭ), предмет, желаемый балл; месяцев до
 * экзамена и часов в неделю — по желанию (месяцы подставляются по классу).
 *
 * Кому показывать, решает база (`onboarding_state().needed`): ученик без
 * школьной группы, анкета не пройдена. Школьник, персонал и тот, кому
 * подписка ещё не открыта, сюда не попадают — уходят на главную.
 *
 * Дальше по плану — диагностика (§289); пока её нет, после анкеты — «Курсы»
 * с курсом выбранного предмета наверху.
 */
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import {
  PathError,
  defaultMonthsToExam,
  onboardingErrors,
  saveOnboarding,
  type OnboardingForm,
  type Subject,
} from '@/lib/studentPath'

const GRADES = [9, 10, 11] as const
const SUBJECTS: Array<{ value: Subject; label: string }> = [
  { value: 'physics', label: 'Физика ЕГЭ' },
  { value: 'math', label: 'Математика ЕГЭ' },
]

function Choice<T extends string | number>({ value, current, onPick, children, testId }: {
  value: T
  current: T | null
  onPick: (v: T) => void
  children: React.ReactNode
  testId: string
}) {
  const on = value === current
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onPick(value)}
      className={cn(
        'min-h-12 rounded-full border-[1.5px] px-5 text-[15px] font-semibold transition sm:min-h-10',
        on ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-graphite-300 bg-white text-graphite-900 hover:border-primary-500',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const subs = useSubscriptionsEnabled()
  const path = useStudentPathHome(profile?.id, subs.enabled)
  const [form, setForm] = useState<OnboardingForm>({
    grade: null, subject: null, target_score: '', months_to_exam: '', hours_per_week: '',
  })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errors = touched ? onboardingErrors(form) : {}
  const set = <K extends keyof OnboardingForm>(k: K, v: OnboardingForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (subs.loading || path.loading) return <p className="p-6 text-graphite-500">Загружаем…</p>
  if (!subs.enabled || !path.data?.onboarding.needed) return <Navigate to="/" replace />

  function pickGrade(g: 9 | 10 | 11) {
    setForm((f) => ({
      ...f,
      grade: g,
      // подсказка по классу, пока ученик не вписал своё
      months_to_exam: f.months_to_exam && f.grade ? f.months_to_exam : String(defaultMonthsToExam(g)),
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (Object.keys(onboardingErrors(form)).length > 0) return
    setBusy(true)
    try {
      await saveOnboarding(form)
      navigate(`/courses?from=start&subject=${form.subject}`, { replace: true })
    } catch (err) {
      setError(err instanceof PathError && err.code === 'BAD_INPUT' ? 'Проверьте поля анкеты.' : 'Не удалось сохранить. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  return (
    <form className="mx-auto max-w-xl p-4 sm:p-6" onSubmit={submit} noValidate data-testid="onboarding">
      <h1 className="text-[28px] font-semibold text-graphite-900">Давайте знакомиться</h1>
      <p className="mt-1 text-[17px] text-graphite-700">Минута — и подберём, с чего начать подготовку.</p>

      <div className="platform-surface mt-6 space-y-6 rounded-card p-5 sm:p-6">
        <fieldset>
          <legend className="text-[15px] font-semibold text-graphite-900">Класс</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {GRADES.map((g) => (
              <Choice key={g} value={g} current={form.grade} onPick={pickGrade} testId={`onboarding-grade-${g}`}>{g} класс</Choice>
            ))}
          </div>
          {errors.grade && <p className="mt-1 text-[13px] text-verdict-bad-ink">✕ {errors.grade}</p>}
        </fieldset>

        <fieldset>
          <legend className="text-[15px] font-semibold text-graphite-900">Экзамен и предмет</legend>
          <p className="mt-1 text-[13px] text-graphite-500">Пока готовим к ЕГЭ.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUBJECTS.map((s) => (
              <Choice key={s.value} value={s.value} current={form.subject} onPick={(v) => set('subject', v)}
                testId={`onboarding-subject-${s.value}`}>{s.label}</Choice>
            ))}
          </div>
          {errors.subject && <p className="mt-1 text-[13px] text-verdict-bad-ink">✕ {errors.subject}</p>}
        </fieldset>

        <Input
          label="Желаемый балл"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={form.target_score}
          onChange={(e) => set('target_score', e.target.value)}
          error={errors.target_score}
          data-testid="onboarding-target"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Месяцев до экзамена"
            type="number"
            inputMode="numeric"
            min={1}
            max={36}
            value={form.months_to_exam}
            onChange={(e) => set('months_to_exam', e.target.value)}
            error={errors.months_to_exam}
            data-testid="onboarding-months"
          />
          <Input
            label="Часов в неделю на подготовку"
            type="number"
            inputMode="numeric"
            min={1}
            max={40}
            value={form.hours_per_week}
            onChange={(e) => set('hours_per_week', e.target.value)}
            error={errors.hours_per_week}
            data-testid="onboarding-hours"
          />
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-verdict-bad-tint px-4 py-3 text-[15px] text-verdict-bad-ink" data-testid="onboarding-error">{error}</p>}

      <Button type="submit" className="mt-6 w-full sm:w-auto" loading={busy} data-testid="onboarding-submit">Продолжить</Button>
    </form>
  )
}
