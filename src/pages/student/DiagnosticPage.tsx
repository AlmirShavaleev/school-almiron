/**
 * §289. Стартовая диагностика (`/diagnostic`) — шаг пути ученика после анкеты.
 *
 * Вступление («Начать» / «Пройти позже») → по одной задаче на экран: условие из
 * каталога, поле ответа, «Ответить», «Не знаю». Правильность во время теста не
 * показывается (решение владельца). Мягкий таймер только показывает время.
 * Прервался — при следующем входе та же задача (прогресс хранит база).
 * Следующую задачу выбирает база (адаптивно, ≤ 20); кончились — результат.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { useAuthStore } from '@/store/authStore'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import {
  DiagnosticError,
  answerDiagnostic,
  diagnosticErrorText,
  fetchDiagnosticResult,
  skipDiagnostic,
  startDiagnostic,
  type DiagnosticState,
  type DiagnosticSubject,
} from '@/lib/diagnostic'

function useElapsed(since: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const ms = since ? Math.max(0, now - Date.parse(since)) : 0
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function TaskView({ state, onAnswer, busy, error }: {
  state: DiagnosticState
  onAnswer: (answer: string | null) => void
  busy: boolean
  error: string | null
}) {
  const task = state.task!
  const [value, setValue] = useState('')
  const html = useMemo(() => resolveTaskHtml(task.statement_html, task.assets), [task])
  const elapsed = useElapsed(task.shown_at)
  const step = state.answered + 1
  const pct = Math.round((state.answered / state.max) * 100)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onAnswer(value.trim()) }}
      data-testid="diagnostic-task"
    >
      <div>
        <div className="flex items-center justify-between text-[13px] text-graphite-500">
          <span data-testid="diagnostic-step">Задача {step} из ~{state.max}</span>
          <span className="inline-flex items-center gap-1 tabular-nums" aria-label="Время на задачу"><Clock size={13} aria-hidden />{elapsed}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-graphite-100" aria-hidden>
          <div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="platform-surface rounded-card p-4 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-[.03em] text-graphite-500">
          Задание №{task.n}{task.title ? ` · ${task.title}` : ''}
        </p>
        <div className="mt-3 min-w-0 overflow-x-auto text-[15px] text-graphite-900">
          <TaskContentRenderer html={html} />
        </div>
      </div>

      <Input
        label="Ответ"
        value={value}
        autoComplete="off"
        inputMode="text"
        onChange={(e) => setValue(e.target.value)}
        data-testid="diagnostic-answer"
      />
      {error && <p className="text-[15px] text-verdict-bad-ink" role="alert" data-testid="diagnostic-error">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" loading={busy} disabled={!value.trim()} data-testid="diagnostic-submit">Ответить</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onAnswer(null)} data-testid="diagnostic-dont-know">
          Не знаю
        </Button>
      </div>
      <p className="text-[13px] text-graphite-500">«Не знаю» лучше, чем угадывать: так план подготовки будет точнее.</p>
    </form>
  )
}

export function DiagnosticPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const subs = useSubscriptionsEnabled()
  const path = useStudentPathHome(profile?.id, subs.enabled)
  const subject: DiagnosticSubject = path.data?.onboarding.subject === 'math' ? 'math' : 'physics'

  const [phase, setPhase] = useState<'loading' | 'intro' | 'task' | 'done'>('loading')
  const [state, setState] = useState<DiagnosticState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Есть ли уже диагностика: идёт — сразу задача, пройдена — результат.
  useEffect(() => {
    if (subs.loading || path.loading || !subs.enabled) return
    let alive = true
    fetchDiagnosticResult(subject)
      .then(async (r) => {
        if (!alive) return
        if (!r) { setPhase('intro'); return }
        if (r.status === 'done') { setPhase('done'); return }
        const s = await startDiagnostic(subject)
        if (alive) { setState(s); setPhase(s.task ? 'task' : 'done') }
      })
      .catch(() => { if (alive) setPhase('intro') })
    return () => {
      alive = false
    }
  }, [subs.loading, subs.enabled, path.loading, subject])

  if (!subs.loading && !subs.enabled) return <Navigate to="/" replace />
  if (phase === 'done') return <Navigate to="/diagnostic/result" replace />
  if (phase === 'loading') return <p className="p-6 text-graphite-500">Загружаем…</p>

  async function begin() {
    setBusy(true)
    setError(null)
    try {
      const s = await startDiagnostic(subject)
      setState(s)
      setPhase(s.task ? 'task' : 'done')
    } catch (e) {
      setError(diagnosticErrorText(e instanceof DiagnosticError ? e.code : null))
    } finally {
      setBusy(false)
    }
  }

  async function later() {
    setBusy(true)
    try { await skipDiagnostic() } catch { /* «позже» — не страшно, если не записалось */ }
    navigate(`/courses?from=start&subject=${subject}`, { replace: true })
  }

  async function answer(value: string | null) {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const next = await answerDiagnostic(state, value)
      setState(next)
      if (!next.task) setPhase('done')
    } catch (e) {
      const code = e instanceof DiagnosticError ? e.code : null
      setError(diagnosticErrorText(code))
      if (code === 'STALE') {
        try { setState(await startDiagnostic(subject)) } catch { /* остаётся сообщение */ }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6" data-testid="diagnostic-page">
      {phase === 'intro' && (
        <div data-testid="diagnostic-intro">
          <h1 className="text-[28px] font-semibold text-graphite-900">Стартовая диагностика</h1>
          <p className="mt-2 text-[17px] text-graphite-700">
            15–20 задач первой части ЕГЭ, около 20 минут. Подберём задачи под ваш уровень, покажем прогноз балла,
            сильные и слабые темы и с чего начать.
          </p>
          <ul className="mt-4 space-y-1.5 text-[15px] text-graphite-700">
            <li>• Можно прерваться — продолжите с той же задачи.</li>
            <li>• Не знаете — нажмите «Не знаю», угадывать не нужно.</li>
            <li>• Правильные ответы покажем в конце.</li>
          </ul>
          {error && <p className="mt-4 text-[15px] text-verdict-bad-ink" role="alert" data-testid="diagnostic-error">{error}</p>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button onClick={begin} loading={busy} data-testid="diagnostic-begin">Начать</Button>
            <Button variant="ghost" onClick={later} disabled={busy} data-testid="diagnostic-later">Пройти позже</Button>
          </div>
        </div>
      )}

      {phase === 'task' && state?.task && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="text-[20px] font-semibold text-graphite-900">Диагностика</h1>
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} data-testid="diagnostic-pause">Прервать</Button>
          </div>
          <TaskView key={state.task.id} state={state} onAnswer={answer} busy={busy} error={error} />
        </>
      )}
    </div>
  )
}
