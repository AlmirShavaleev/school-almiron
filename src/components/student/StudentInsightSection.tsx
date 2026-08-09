import { useEffect, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronUp, Clock, Loader2, RefreshCw, Sparkles, TrendingDown, TrendingUp,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { useStudentInsights } from '@/hooks/useStudentInsights'
import { useStudentFeedback } from '@/hooks/useStudentFeedback'
import { useAttentionSignals } from '@/hooks/useAttentionSignals'
import { insightsForModel, type StudentInsights } from '@/lib/studentInsights'
import { SIGNAL_DISCLAIMER, signalText, type AttentionSignal } from '@/lib/attentionSignals'

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function dayWord(days: number): string {
  if (days % 10 === 1 && days % 100 !== 11) return 'день'
  if (days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20)) return 'дня'
  return 'дней'
}

/** Плитка. Рисуется, только когда под ней есть чем её наполнить. */
function Tile({ title, value, hint, tone = 'plain' }: {
  title: string
  value: string
  hint?: string
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div className={cn(
      'rounded-xl border px-3 py-2.5',
      tone === 'good' ? 'border-emerald-200 bg-emerald-50/60'
        : tone === 'warn' ? 'border-amber-200 bg-amber-50/60'
          : tone === 'bad' ? 'border-red-200 bg-red-50/60'
            : 'border-gray-200 bg-white',
    )}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-0.5 text-lg font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </div>
  )
}

function Numbers({ insights }: { insights: StudentInsights }) {
  const { works, score, revisions, activity } = insights

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile
        title="Работы"
        value={String(works.total)}
        hint={[
          works.pending > 0 ? `ждут проверки: ${works.pending}` : null,
          works.revision > 0 ? `на доработке: ${works.revision}` : null,
          works.accepted > 0 ? `принято: ${works.accepted}` : null,
        ].filter(Boolean).join(' · ') || undefined}
      />

      {/* Средний балл — только когда есть хоть одна оценка: «0%» здесь был бы
          не фактом, а выдумкой про ученика без вердиктов. */}
      {score.avgPercent != null && (
        <Tile
          title="Средний балл"
          value={`${score.avgPercent}%`}
          hint={`по ${score.samples} ${score.samples === 1 ? 'работе' : 'работам'}`}
          tone={score.avgPercent >= 80 ? 'good' : score.avgPercent >= 50 ? 'plain' : 'bad'}
        />
      )}

      {score.trend && score.trendDelta != null && (
        <Tile
          title="Динамика"
          value={score.trend === 'up' ? `рост +${score.trendDelta}` : score.trend === 'down' ? `спад ${score.trendDelta}` : 'ровно'}
          hint="вторая половина оценок против первой"
          tone={score.trend === 'up' ? 'good' : score.trend === 'down' ? 'bad' : 'plain'}
        />
      )}

      {revisions.returnedWorks > 0 && (
        <Tile
          title="Возвращали"
          value={String(revisions.returnedWorks)}
          hint={revisions.maxAttempts > 1 ? `максимум попыток: ${revisions.maxAttempts}` : undefined}
          tone="warn"
        />
      )}

      {works.late > 0 && (
        <Tile title="Сдано с опозданием" value={String(works.late)} tone="warn" />
      )}

      {activity.silentDays != null && (
        <Tile
          title="Последняя сдача"
          value={activity.silentDays === 0 ? 'сегодня' : `${activity.silentDays} ${dayWord(activity.silentDays)} назад`}
          hint={formatDateTime(activity.lastSubmission) ?? undefined}
          tone={activity.silentDays >= 21 ? 'bad' : activity.silentDays >= 10 ? 'warn' : 'plain'}
        />
      )}
    </div>
  )
}

function WeakTopics({ insights }: { insights: StudentInsights }) {
  if (insights.weakTopics.length === 0) return null
  return (
    <div data-testid="student-weak-topics" className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Где проседает</div>
      <ul className="mt-2 space-y-1.5">
        {insights.weakTopics.map(t => (
          <li key={t.topic} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-800">{t.topic}</span>
            {t.avgPercent != null && (
              <span className="text-xs text-gray-500">{t.avgPercent}%</span>
            )}
            {t.returns > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                <AlertTriangle size={10} />
                возвратов: {t.returns}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-gray-400">
        Ниже собственного среднего этого ученика или с повторными возвратами.
      </p>
    </div>
  )
}

/**
 * Сигналы внимания.
 *
 * Формулировки намеренно наблюдательные: «стоит посмотреть», а не «списал».
 * Каждый сигнал объясняется и обычным образом, поэтому оговорка стоит НАД
 * списком, а не мелким шрифтом под ним — иначе она не читается.
 *
 * Блок виден только персоналу: он смонтирован на преподавательской карточке,
 * а данные под ним закрыты RLS (ученик к чужим ответам не допущен вовсе).
 */
function AttentionSignals({ signals, comparable }: { signals: AttentionSignal[]; comparable: number }) {
  if (signals.length === 0) return null

  return (
    <div data-testid="student-attention-signals" className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        <AlertTriangle size={12} />
        Сигналы внимания · подозрение, не факт
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-amber-900/80">{SIGNAL_DISCLAIMER}</p>

      <ul className="mt-2 space-y-1.5">
        {signals.map((s, i) => (
          <li key={`${s.kind}-${i}`} className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-gray-800">
            {signalText(s)}
          </li>
        ))}
      </ul>

      {/*
        Пустота здесь не равна «ничего не было»: преподаватель видит только свои
        выдачи, куратор к ответам не допущен. Пишем прямо, с чем сравнивали.
      */}
      <p className="mt-2 text-[11px] text-amber-900/60">
        Сравнение шло по {comparable} доступным вам прохождениям других учеников.
        Работы, выданные не вами, сюда не попадают.
      </p>
    </div>
  )
}

/**
 * Карточка ученика: цифры и обратная связь.
 *
 * Видит только персонал — и это держит база (политики
 * `student_feedback_notes` и RLS работ), а не то, что компонент смонтирован на
 * преподавательской странице.
 */
export function StudentInsightSection({ studentId }: { studentId: string }) {
  const { insights, loading, error, reload } = useStudentInsights(studentId)
  const feedback = useStudentFeedback(studentId)
  const attention = useAttentionSignals(studentId)

  // Скачки уровня считаются по тем же оценкам, что и средний балл, поэтому
  // приезжают вместе с цифрами, а не отдельным запросом.
  const signals: AttentionSignal[] = [
    ...attention.signals,
    ...(insights?.levelJumps ?? []),
  ]

  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Сохранённый текст подхватывается, пока преподаватель не начал печатать:
  // затирать начатое приходом данных нельзя.
  const currentBody = feedback.current?.body ?? ''
  useEffect(() => {
    if (!dirty) setText(currentBody)
  }, [currentBody, dirty])

  async function onSave() {
    setSaving(true); setFailure(null); setNote(null)
    try {
      await feedback.save(text)
      setDirty(false)
      setNote('Сохранено')
    } catch (e: any) {
      setFailure(e?.message ?? 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function onGenerate() {
    if (!insights?.hasData) { setFailure('У ученика нет работ — черновик собирать не из чего'); return }
    setGenerating(true); setFailure(null); setNote(null)
    try {
      setDraft(await feedback.generate(insightsForModel(insights)))
    } catch (e: any) {
      setFailure(e?.message ?? 'Не удалось собрать черновик')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-gray-900">Анализ и обратная связь</div>
        <button
          type="button"
          onClick={() => { reload(); feedback.reload(); attention.reload() }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
        >
          <RefreshCw size={12} />
          Обновить
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
          <Loader2 size={15} className="animate-spin" />
          Считаем работы ученика…
        </div>
      ) : !insights?.hasData ? (
        <p data-testid="student-insights-empty" className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
          Ученик ещё не сдавал работ — считать нечего
        </p>
      ) : (
        <div className="space-y-3">
          <Numbers insights={insights} />
          <AttentionSignals signals={signals} comparable={attention.comparable} />
          <WeakTopics insights={insights} />
          {insights.score.recent.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Последние оценки</div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {insights.score.recent.map(r => (
                  <li key={`${r.topic}-${r.at}`} className="rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-700">
                    {r.topic} · <span className="font-semibold">{r.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Обратная связь ─────────────────────────────────────────────── */}
      <div className="space-y-2 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">Текст о работе ученика</div>
          <Button size="sm" variant="secondary" onClick={onGenerate} loading={generating} disabled={generating}>
            <Sparkles size={14} />
            Собрать черновик ИИ
          </Button>
        </div>

        <p className="text-[11px] text-gray-400">
          Виден только преподавателям и кураторам курса. Ученику и родителям не показывается.
        </p>

        {draft && (
          <div data-testid="student-feedback-draft" className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Черновик ИИ</div>
            <p className="mt-1.5 whitespace-pre-line text-sm text-gray-800">{draft}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Перенос — отдельное нажатие: сохранённый текст не должен
                  меняться от того, что кто-то посмотрел черновик. */}
              <Button size="sm" variant="secondary" onClick={() => { setText(draft); setDirty(true) }}>
                Перенести в текст
              </Button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-xs text-gray-500 underline-offset-2 hover:underline"
              >
                Скрыть
              </button>
            </div>
          </div>
        )}

        <textarea
          data-testid="student-feedback-input"
          value={text}
          onChange={e => { setText(e.target.value); setDirty(true) }}
          rows={6}
          aria-label="Обратная связь по ученику"
          placeholder="Что получается, что проседает, что делать дальше"
          className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        />

        {failure && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failure}</div>}
        {note && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{note}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onSave} loading={saving} disabled={saving || !text.trim() || !dirty}>
            Сохранить
          </Button>
          {feedback.current && (
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <Clock size={11} />
              Сохранено {formatDateTime(feedback.current.created_at)}
            </span>
          )}
        </div>

        {feedback.saved.length > 1 && (
          <div>
            <button
              type="button"
              onClick={() => setHistoryOpen(o => !o)}
              aria-expanded={historyOpen}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            >
              {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Прошлые версии ({feedback.saved.length - 1})
            </button>
            {historyOpen && (
              <ul data-testid="student-feedback-history" className="mt-2 space-y-2">
                {feedback.saved.slice(1).map(v => (
                  <li key={v.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                    <div className="text-[11px] text-gray-400">{formatDateTime(v.created_at)}</div>
                    <p className="mt-1 whitespace-pre-line text-xs text-gray-700">{v.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
