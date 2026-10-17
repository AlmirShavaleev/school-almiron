import { useEffect, useState, type ReactNode } from 'react'
import { Check, ClipboardList, Loader2 } from 'lucide-react'
import {
  CLARITY, DIFFICULTY, EMPTY_ANSWERS, ERROR_WHERE, HARD_SPOTS, HW_SELF, PACE, TIME_SPENT, VIDEO,
  fetchMyTopicFeedback, saveTopicFeedback, toggleHardSpot,
  type FeedbackAnswers,
} from '@/lib/topicFeedback'
import { cn } from '@/utils/cn'

/**
 * Опрос по уроку (письмо ЛК_стиль_урок_опрос_качества.md, 16.10).
 *
 * Своя карточка «Опрос по уроку · 30 секунд» — рядом с оценкой 1–10 (§271),
 * не внутри неё и не всплывающим окном. Видна, пока ученик не прошёл опрос;
 * после — свёрнута в строку «Спасибо, ответы сохранены · Изменить». Шаги по
 * 1–2 вопроса, всё нажатиями, ничего не обязательно; на сдачу ДЗ не влияет.
 *
 * В предпросмотре (§178) карточка видна, но выключена: проходить не за кого.
 */
const STEPS = 5
export const TOPIC_FEEDBACK_PREVIEW_NOTE = 'В предпросмотре опрос не проходят'

function Options<K extends string>({ list, value, onPick, disabled, name }: {
  list: ReadonlyArray<[K, string]>
  value: K | null
  onPick: (k: K | null) => void
  disabled: boolean
  name: string
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {list.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          disabled={disabled}
          onClick={() => onPick(value === k ? null : k)}
          className={cn(
            'min-h-10 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === k
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Q({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[15px] font-semibold text-gray-900"><span className="text-gray-400">{n}.</span> {title}</legend>
      {children}
    </fieldset>
  )
}

const field = 'h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-primary-400 focus:outline-none'

export function TopicFeedbackCard({ topicId, preview }: { topicId: string; preview: boolean }) {
  const [loaded, setLoaded] = useState<{ topicId: string; done: boolean } | null>(null)
  const [a, setA] = useState<FeedbackAnswers>(EMPTY_ANSWERS)
  const [step, setStep] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (preview) return
    let cancelled = false
    fetchMyTopicFeedback(topicId).then(res => {
      if (cancelled) return
      setA(res.answers ?? EMPTY_ANSWERS)
      setLoaded({ topicId, done: !!res.answers })
      setStep(0)
      setEditing(false)
      setJustSaved(false)
    })
    return () => { cancelled = true }
  }, [topicId, preview])

  const current = loaded?.topicId === topicId ? loaded : null
  if (!preview && !current) {
    return (
      <section data-testid="topic-feedback" className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" aria-hidden />Опрос по уроку…
      </section>
    )
  }

  // Пройден и не редактируется — одна строка.
  if (current?.done && !editing) {
    return (
      <section data-testid="topic-feedback" data-state="done" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
          <Check size={15} aria-hidden />{justSaved ? 'Спасибо, ответы сохранены' : 'Опрос по уроку пройден'}
        </span>
        <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => { setEditing(true); setStep(0) }} data-testid="topic-feedback-edit">
          Изменить
        </button>
      </section>
    )
  }

  const off = preview || saving
  const set = <K extends keyof FeedbackAnswers>(k: K, v: FeedbackAnswers[K]) => setA(prev => ({ ...prev, [k]: v }))

  async function submit() {
    if (preview) return
    setSaving(true)
    setError(null)
    const res = await saveTopicFeedback(topicId, a)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setLoaded({ topicId, done: true })
    setEditing(false)
    setJustSaved(true)
  }

  return (
    <section data-testid="topic-feedback" data-state="form" aria-labelledby="topic-feedback-title" className="space-y-4 rounded-2xl border border-gray-200 bg-white px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="shrink-0 text-primary-600" aria-hidden />
          <h2 id="topic-feedback-title" className="text-base font-semibold text-gray-900">Опрос по уроку · 30 секунд</h2>
        </div>
        <span className="shrink-0 text-xs font-semibold text-gray-400" data-testid="topic-feedback-step">{step + 1} из {STEPS}</span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary-500' : 'bg-gray-100')} />
        ))}
      </div>

      {step === 0 && (
        <>
          <Q n={1} title="Понятна ли тема после теории и видео?">
            <Options name="Понятность" list={CLARITY} value={a.clarity} onPick={v => set('clarity', v)} disabled={off} />
          </Q>
          <Q n={2} title="Видео">
            <Options name="Видео" list={VIDEO} value={a.video} onPick={v => set('video', v)} disabled={off} />
            {a.video && a.video !== 'none' && (
              <div className="space-y-2 pt-1">
                <p className="text-sm text-gray-600">Темп</p>
                <Options name="Темп видео" list={PACE} value={a.video_pace} onPick={v => set('video_pace', v)} disabled={off} />
              </div>
            )}
          </Q>
        </>
      )}

      {step === 1 && (
        <>
          <Q n={3} title="Задачи урока по сложности">
            <Options name="Сложность задач" list={DIFFICULTY} value={a.lesson_difficulty} onPick={v => set('lesson_difficulty', v)} disabled={off} />
          </Q>
          <Q n={4} title="Сколько задач ДЗ решил сам, не заглядывая в решения?">
            <Options name="ДЗ сам" list={HW_SELF} value={a.hw_self} onPick={v => set('hw_self', v)} disabled={off} />
          </Q>
        </>
      )}

      {step === 2 && (
        <Q n={5} title="Где было трудно? (можно несколько)">
          <div role="group" aria-label="Где было трудно" className="flex flex-wrap gap-2">
            {HARD_SPOTS.map(([k, text]) => {
              const on = a.hard_spots.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  disabled={off}
                  onClick={() => set('hard_spots', toggleHardSpot(a.hard_spots, k))}
                  className={cn(
                    'min-h-10 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50',
                    on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                  )}
                >
                  {text}
                </button>
              )
            })}
          </div>
          {(a.hard_spots.includes('lesson_task') || a.hard_spots.includes('hw_task')) && (
            <div className="flex flex-wrap gap-3 pt-1">
              {a.hard_spots.includes('lesson_task') && (
                <label className="flex items-center gap-2 text-sm text-gray-700">Задача урока №
                  <input className={cn(field, 'w-24')} inputMode="numeric" maxLength={40} value={a.hard_lesson_task} disabled={off}
                    onChange={e => set('hard_lesson_task', e.target.value)} data-testid="topic-feedback-lesson-task" />
                </label>
              )}
              {a.hard_spots.includes('hw_task') && (
                <label className="flex items-center gap-2 text-sm text-gray-700">Задача ДЗ №
                  <input className={cn(field, 'w-24')} inputMode="numeric" maxLength={40} value={a.hard_hw_task} disabled={off}
                    onChange={e => set('hard_hw_task', e.target.value)} data-testid="topic-feedback-hw-task" />
                </label>
              )}
            </div>
          )}
        </Q>
      )}

      {step === 3 && (
        <>
          <Q n={6} title="Нашёл ошибку или опечатку?">
            <Options name="Ошибка" list={[['no', 'Нет'], ['yes', 'Да']] as const}
              value={a.found_error == null ? null : a.found_error ? 'yes' : 'no'}
              onPick={v => set('found_error', v == null ? null : v === 'yes')} disabled={off} />
            {a.found_error && (
              <div className="space-y-2 pt-1">
                <p className="text-sm text-gray-600">Где</p>
                <Options name="Где ошибка" list={ERROR_WHERE} value={a.error_where} onPick={v => set('error_where', v)} disabled={off} />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">№ задачи
                    <input className={cn(field, 'w-24')} maxLength={40} value={a.error_task} disabled={off}
                      onChange={e => set('error_task', e.target.value)} data-testid="topic-feedback-error-task" />
                  </label>
                </div>
                <textarea className={cn(field, 'h-20 w-full py-2')} maxLength={2000} placeholder="Что не так (необязательно)" value={a.error_text} disabled={off}
                  onChange={e => set('error_text', e.target.value)} data-testid="topic-feedback-error-text" />
              </div>
            )}
          </Q>
          <Q n={7} title="Сколько времени ушло на тему?">
            <Options name="Время" list={TIME_SPENT} value={a.time_spent} onPick={v => set('time_spent', v)} disabled={off} />
          </Q>
        </>
      )}

      {step === 4 && (
        <Q n={8} title="Что улучшить в этом уроке?">
          <textarea className={cn(field, 'h-24 w-full py-2')} maxLength={2000} placeholder="Необязательно" value={a.improve} disabled={off}
            onChange={e => set('improve', e.target.value)} data-testid="topic-feedback-improve" />
        </Q>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          className="text-sm font-semibold text-gray-500 hover:text-gray-800 disabled:invisible"
          disabled={step === 0}
          onClick={() => setStep(s => s - 1)}
          data-testid="topic-feedback-back"
          aria-label="Предыдущий вопрос"
        >
          ← Назад
        </button>
        <div className="flex items-center gap-3">
          {editing && (
            <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setEditing(false)}>Отмена</button>
          )}
          {step < STEPS - 1 ? (
            <button type="button" className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white hover:bg-primary-700" onClick={() => setStep(s => s + 1)} data-testid="topic-feedback-next">
              Дальше
            </button>
          ) : (
            <button type="button" disabled={off} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50" onClick={submit} data-testid="topic-feedback-submit">
              {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}Отправить
            </button>
          )}
        </div>
      </div>
      {preview && <p className="text-xs text-gray-500" data-testid="topic-feedback-preview">{TOPIC_FEEDBACK_PREVIEW_NOTE}</p>}
      {error && <p className="text-xs text-red-600" data-testid="topic-feedback-error">{error}</p>}
    </section>
  )
}
