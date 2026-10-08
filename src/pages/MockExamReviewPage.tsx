import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Check, FileText, Loader2, RotateCw, Sparkles, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SignedImage } from '@/components/ui/SignedImage'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useMockExamWorks, type WorksExam, type WorksStudent } from '@/hooks/useMockExamWorks'
import { useMockExamAi, type MockExamAi } from '@/hooks/useMockExamAi'
import { useSignedPdf, type SignedPdfState } from '@/hooks/useSignedPdf'
import { PdfPageView } from '@/components/pdf/PdfPageView'
import { isPdfFile } from '@/lib/mockExamVariants'
import { MOCK_EXAMS_BUCKET, mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { canNotify, notifyState, formatSentAt } from '@/lib/mockExamNotify'
import {
  keyToPoints, markCounts, missingNote, nextToReview, reviewPosition, reviewTotals, sentLine, taskMark, workRows, type WorkRow,
} from '@/lib/mockExamV3'
import {
  AI_CONFIDENCE_LABEL, acceptAllAi, aiPointsLine, aiRunState, aiStatusLine, aiUsable, firstRegion, isAiActive, regionsOnSheet,
  suggestionsByTask, type AiRun, type AiRunState, type AiSuggestion,
} from '@/lib/mockExamAi'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §228. Проверка работы ученика по номерам (экран 3 макета) — по образцу
 * «Проверки работы» ДЗ (§226): шапка «← Пробник · работа N из M», имя,
 * «сдал … · K фото», «Следующая работа →» и сводка метками `VerdictMark`;
 * в центре — фото второй части (вкладки, масштаб, повернуть); справа — номера:
 * первая часть — ответ ученика рядом с ключом и балл ключа (исправить можно:
 * клетка перестаёт быть «авто», §221), вторая — кнопки 0…максимум шаблона.
 * Выбранный номер раскрыт: максимум, ответ ключа или решение PDF, предложение
 * ИИ (§222b). Клавиши: цифра ставит балл выбранному, ↑↓ — номера, Delete —
 * очистить.
 *
 * §222b, этап Б. У номеров второй части — предложение ИИ «ИИ: 2 из 3» с
 * уверенностью и комментарием; «Принять» кладёт балл в клетку как ручной ввод
 * (в базу — обычным «Сохранить»), «Принять все предложения ИИ» — только в
 * пустые клетки, поставленные баллы не трогает. Рамки предложения выбранного
 * номера — поверх фото. «Проверить ИИ» и статус — над номерами. Ученик ничего
 * из этого не видит (RLS), уведомление — по-прежнему только «Уведомить».
 *
 * Сохранение — существующей `save_mock_exam_grid` строкой ученика целиком;
 * «Уведомить» — `notify_mock_exam_results(exam, [ученик])`, только когда все
 * номера оценены и сохранены. Ученик ничего не получает при сохранении (§219).
 *
 * §270. В раскрытом номере второй части — «Комментарий ученику»: ученик видит
 * его в результатах пробника после «Уведомить». «Принять» / «Принять все»
 * переносят в пустое поле комментарий ИИ (написанное преподавателем не
 * трогают). «Сохранить» пишет сначала баллы, затем изменённые комментарии
 * (`save_mock_exam_task_comments`); комментарий к номеру без балла — ошибка до
 * сохранения, текст в поле остаётся.
 */
export function MockExamReviewPage() {
  const { id, studentId } = useParams<{ id: string; studentId: string }>()
  const works = useMockExamWorks(id)
  const ai = useMockExamAi(id)
  const { exam, students, key, variants, loading, error } = works
  const student = students.find(s => s.id === studentId) ?? null

  if (loading) return <div className="flex h-64 items-center justify-center gap-2 text-graphite-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
  if (error || !exam || !exam.template || !student) {
    return (
      <div className="space-y-3" data-testid="mock-review-error">
        <Link to={id ? `/mock-exams/${id}?tab=works` : '/mock-exams'} className="inline-flex items-center gap-1 text-[13px] text-graphite-500 hover:text-primary-700"><ArrowLeft size={14} aria-hidden />Пробник</Link>
        <p className="flex items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink"><AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error || (!exam ? 'Пробник не найден' : !exam.template ? 'У пробника нет шаблона — номеров нет' : 'Этого ученика нет в группе пробника')}
        </p>
      </div>
    )
  }
  // §229. Ключ — варианта ученика; у пробника без вариантов — прежний ключ пробника.
  const answerKey = student.variant ? student.variant.key : key
  return <Review key={student.id} exam={exam} students={students} student={student} answerKey={answerKey} variantCount={variants.length} works={works} ai={ai} />
}

type Works = ReturnType<typeof useMockExamWorks>

function Review({ exam, students, student, answerKey, variantCount, works, ai }: {
  exam: WorksExam
  students: WorksStudent[]
  student: WorksStudent
  answerKey: (string | null)[] | null
  variantCount: number
  works: Works
  ai: MockExamAi
}) {
  const navigate = useNavigate()
  const tpl = exam.template!
  const maxPts = tpl.max_points
  const n = maxPts.length
  const p1End = tpl.part1_last
  const [points, setPoints] = useState<(number | null)[]>(() => Array.from({ length: n }, (_, i) => student.points[i] ?? null))
  // §270. Комментарии ученику — строками ('' — нет); сравниваются с сохранёнными после обрезки пробелов.
  const [comments, setComments] = useState<string[]>(() => Array.from({ length: n }, (_, i) => student.comments?.[i] ?? ''))
  const [sel, setSel] = useState(() => {
    const firstMissing = Array.from({ length: n }, (_, i) => i).find(i => student.points[i] == null && i >= p1End)
    return firstMissing ?? Array.from({ length: n }, (_, i) => i).find(i => student.points[i] == null) ?? 0
  })
  const [busy, setBusy] = useState<'save' | 'next' | 'notify' | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  // Окно на экране проверки уже закрыто — «сейчас» достаточно взять один раз.
  const [openedAt] = useState(() => Date.now())
  const rows: WorkRow[] = useMemo(() => workRows(students, tpl, exam.window, openedAt), [students, tpl, exam.window, openedAt])
  const next = nextToReview(rows, student.id)
  const pos = reviewPosition(rows, student.id)
  const saved = student.points
  const pointsDirty = points.some((v, i) => v !== (saved[i] ?? null))
  const commentsReady = works.commentsReady
  const changedComments = commentsReady ? commentChanges(comments, student.comments, p1End) : []
  const dirty = pointsDirty || changedComments.length > 0
  const totals = reviewTotals(points, tpl)
  const counts = markCounts(points, maxPts)
  const ns = notifyState(student.result)
  const worksUrl = `/mock-exams/${exam.id}?tab=works`
  const nextUrl = next ? `/mock-exams/${exam.id}/review/${next.id}` : null

  // §222b. Предложения ИИ этого ученика и состояние его проверки.
  const aiByTask = useMemo(() => suggestionsByTask(ai.suggestions, student.id), [ai.suggestions, student.id])
  const aiRun = ai.runs.find(r => r.student_id === student.id) ?? null
  const dbState = aiRunState(aiRun, ai.now)
  // Вызов ещё идёт, а строка не перечитана — «в очереди», а не прошлый итог.
  const aiState: AiRunState = ai.inFlight.has(student.id) && !isAiActive(dbState) ? 'queued' : dbState
  const aiActive = isAiActive(aiState)
  const aiPart2 = p1End < n && ai.available
  const aiAcceptable = acceptAllAi(points, aiByTask, p1End, maxPts).accepted.length
  const selSuggestion = sel >= p1End ? aiByTask.get(sel + 1) ?? null : null

  const setAt = useCallback((i: number, v: number | null) => {
    setPoints(prev => { const nx = prev.slice(); nx[i] = v; return nx })
    setStatus(null)
  }, [])

  // Клавиши — как в проверке ДЗ (§209/§226): цифра — балл выбранному, ↑↓ — номера.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const a = document.activeElement
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(n - 1, s + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { setAt(sel, null); return }
      const v = keyToPoints(e.key, maxPts[sel] ?? 0)
      if (v != null) { e.preventDefault(); setAt(sel, v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, n, maxPts, setAt])

  // Выбранный номер — в видимую часть колонки номеров. Только на ноутбуке, где
  // колонка прокручивается сама: на телефоне это прокрутило бы весь экран мимо фото.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(min-width: 1024px)').matches) return
    document.querySelector(`[data-task-row="${sel + 1}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])

  const setCommentAt = useCallback((i: number, v: string) => {
    setComments(prev => { const nx = prev.slice(); nx[i] = v; return nx })
    setStatus(null)
  }, [])

  /**
   * §270. Баллы строкой ученика (как до §270) → изменённые комментарии.
   * Комментарий к номеру без балла — ошибка до записи: ничего не пишем, текст
   * в поле остаётся.
   */
  async function persist(): Promise<{ error: string | null; pointsSaved: boolean }> {
    const orphan = commentsReady ? commentWithoutPoints(comments, points, p1End) : null
    if (orphan != null) {
      setSel(orphan)
      return { error: `задание №${orphan + 1}: сначала поставьте балл — комментарий без балла не сохранить.`, pointsSaved: false }
    }
    const r = await works.saveRow(student.id, points)
    if (r.error) return { error: r.error, pointsSaved: false }
    // Номер без балла после сохранения строки не имеет — его комментарий ушёл вместе с баллом.
    const toSave = changedComments.filter(i => points[i] != null)
    if (toSave.length > 0) {
      const c = await works.saveComments(student.id, Object.fromEntries(toSave.map(i => [String(i + 1), comments[i].trim() || null])))
      if (c.error) return { error: pointsDirty ? `баллы сохранены, комментарии — нет: ${c.error}` : c.error, pointsSaved: true }
    }
    return { error: null, pointsSaved: true }
  }

  async function save(then: 'stay' | 'next'): Promise<boolean> {
    setBusy(then === 'next' ? 'next' : 'save')
    setStatus(null)
    const r = await persist()
    setBusy(null)
    if (r.error) { setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); if (r.pointsSaved) works.reload(); return false }
    if (then === 'next') {
      navigate(nextUrl ?? worksUrl)
      works.reload()
      return true
    }
    works.reload()
    setStatus({ kind: 'ok', text: totals.complete ? 'Сохранено. Ученик ничего не получил — отправьте кнопкой «Уведомить».' : `Сохранено. ${missingNote(points, n)[0].toUpperCase()}${missingNote(points, n).slice(1)}.` })
    return true
  }

  // §270. Комментарий ИИ — в пустое поле комментария; текст преподавателя не трогаем.
  function fillAiComments(tasks: number[]) {
    if (!commentsReady) return
    setComments(prev => {
      const nx = prev.slice()
      for (const t of tasks) {
        const c = aiByTask.get(t)?.comment?.trim()
        if (c && !(nx[t - 1] ?? '').trim()) nx[t - 1] = c.slice(0, COMMENT_MAX)
      }
      return nx
    })
  }

  function acceptAi(i: number, s: AiSuggestion) {
    setSel(i)
    setAt(i, s.points)
    fillAiComments([i + 1])
  }

  function acceptAllSuggestions() {
    const r = acceptAllAi(points, aiByTask, p1End, maxPts)
    if (r.accepted.length === 0) return
    setPoints(r.points)
    fillAiComments(r.accepted)
    setStatus({ kind: 'ok', text: `Принято предложений ИИ: ${r.accepted.length} (${r.accepted.map(t => `№${t}`).join(', ')}). Проверьте и нажмите «Сохранить».` })
  }

  async function runAi() {
    setAiError(null)
    setStatus(null)
    const r = await ai.request([student.id])
    if (r.error) { setAiError(r.error); return }
    if (r.queued.length === 0) {
      const o = r.skipped[0]?.outcome
      setAiError(o === 'no_photos' ? 'Фото второй части нет — ИИ проверять нечего.' : o === 'running' ? 'ИИ уже проверяет эту работу.' : 'Проверка не запустилась.')
    }
  }

  async function notifyOne() {
    setBusy('notify')
    const r = await works.notify([student.id])
    setBusy(null)
    if (r.error) { setStatus({ kind: 'error', text: `Не отправлено: ${r.error}` }); return }
    works.reload()
    setStatus({ kind: 'ok', text: sentLine(r.summary, student.name) })
  }

  function go(url: string) {
    if (dirty) { setLeaveTo(url); return }
    navigate(url)
  }

  const sheet = student.sheet
  const variant = student.variant ?? null
  const variantLabel = variant && variantCount > 1 ? ((variant.label ?? '').trim() || `Вариант ${variant.position}`) : null
  // Файлы варианта ученика; у пробника без вариантов — файлы пробника.
  const files = {
    condition: variant ? variant.condition_path : exam.condition_path,
    solution: variant ? variant.solution_path : exam.solution_path,
    criteria: variant ? variant.criteria_path : null,
  }
  const meta = [
    exam.groupName,
    sheet?.submitted_at ? `сдал ${mskDayLong(sheet.submitted_at)} в ${mskTime(sheet.submitted_at)}`
      : student.photos > 0 || (sheet?.answers ?? []).some(a => (a ?? '').trim()) ? 'время вышло, «Сдать» не нажал' : 'работы на сайте нет',
    `${student.photos} фото`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col rounded-card bg-white shadow-card" data-testid="mock-review-page">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-graphite-200 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <button type="button" onClick={() => go(worksUrl)} className="inline-flex items-center gap-1 self-start text-[13px] text-graphite-500 hover:text-primary-700" data-testid="mock-review-back">
            <ArrowLeft size={13} aria-hidden />{exam.title}{pos ? ` · работа ${pos.n} из ${pos.of}` : ''}
          </button>
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold leading-tight text-graphite-900 [text-wrap:balance] sm:text-2xl" data-testid="mock-review-title">
            <span>{student.name} — {exam.title}</span>
            {variantLabel && <span className="rounded-full bg-gold-300 px-3 py-0.5 text-[13px] font-extrabold text-graphite-900" data-testid="mock-review-variant">{variantLabel}</span>}
          </h1>
          <span className="text-[13px] text-graphite-500" data-testid="mock-review-meta">{meta}</span>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {nextUrl && (
            <button type="button" onClick={() => go(nextUrl)} className="text-sm font-semibold text-primary-600 hover:underline" data-testid="mock-review-next-link">Следующая работа →</button>
          )}
          <div className="flex flex-wrap gap-3.5 text-[13px] text-graphite-500 sm:text-xs" data-testid="mock-review-marks">
            {(['ok', 'part', 'bad', 'unk'] as const).filter(k => counts[k] > 0).map(k => (
              <span key={k} className="inline-flex items-center gap-1.5" data-mark={k}>
                <VerdictMark state={k} size={16} />{counts[k]}{k === 'unk' ? ' не оценено' : ''}
              </span>
            ))}
          </div>
        </div>
      </header>

      {leaveTo && (
        <div className="flex flex-wrap items-center gap-2 border-b border-graphite-200 bg-verdict-part-tint px-4 py-2.5 text-sm text-verdict-part-ink sm:px-6" role="alertdialog" data-testid="mock-review-leave">
          <span className="mr-auto">{pointsDirty ? 'Есть несохранённые баллы.' : 'Есть несохранённые комментарии.'}</span>
          <Button size="sm" onClick={async () => { const to = leaveTo; setLeaveTo(null); const r = await persist(); if (r.error) { setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); if (r.pointsSaved) works.reload(); return } works.reload(); navigate(to) }}>Сохранить и перейти</Button>
          <Button size="sm" variant="secondary" onClick={() => { const to = leaveTo; setLeaveTo(null); navigate(to) }}>Перейти без сохранения</Button>
          <Button size="sm" variant="ghost" onClick={() => setLeaveTo(null)}>Остаться</Button>
        </div>
      )}

      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        <PhotoPane photos={student.photoList} suggestion={aiPart2 ? selSuggestion : null} />
        <section className="flex max-h-none flex-col gap-1 border-t border-graphite-200 px-3 py-3.5 sm:px-[18px] lg:max-h-[calc(100vh-260px)] lg:overflow-auto lg:border-l lg:border-t-0" data-testid="mock-review-tasks" aria-label="Номера">
          <VariantFiles label={variantLabel} files={files} />
          {aiPart2 && (
            <AiPanel state={aiState} run={aiRun} count={aiByTask.size} acceptable={aiAcceptable} active={aiActive}
              error={aiError && aiError !== aiRun?.last_error ? aiError : null} hasPhotos={student.photos > 0}
              onRun={runAi} onAcceptAll={acceptAllSuggestions} />
          )}
          <Eyebrow>Часть 1 · по ключу</Eyebrow>
          {Array.from({ length: p1End }, (_, i) => {
            const auto = !!student.auto?.[i] && points[i] === (saved[i] ?? null)
            return (
              <div key={i}>
                <TaskRow i={i} max={maxPts[i]} value={points[i]} selected={sel === i} onSelect={() => setSel(i)} onSet={v => { setSel(i); setAt(i, v) }}
                  answer={sheet?.answers?.[i] ?? null} keyAnswer={answerKey?.[i] ?? null} auto={auto} part1 />
                {sel === i && (
                  <div className="mb-2 mt-1 flex flex-col gap-1 rounded-xl bg-graphite-50 px-3.5 py-2.5 text-sm text-graphite-700 sm:ml-[34px]" data-testid="mock-review-expand">
                    <span className="text-[13px] font-semibold text-graphite-500">Максимум · {maxPts[i]} {plural(maxPts[i], 'балл', 'балла', 'баллов')} · ключ: <code className="font-mono text-graphite-900">{answerKey?.[i] ?? 'не внесён'}</code></span>
                    <span>{points[i] == null
                      ? (answerKey?.[i] ? 'Ключ этот ответ не проверил — поставьте балл сами.' : 'Ответа в ключе нет — поставьте балл сами.')
                      : auto ? 'Поставлено по ключу. Исправьте, если в ключе опечатка — балл станет ручным.' : 'Поставлено вручную.'}</span>
                  </div>
                )}
              </div>
            )
          })}
          {p1End < n && <Eyebrow className="pt-2.5">Часть 2 · по фото</Eyebrow>}
          {Array.from({ length: n - p1End }, (_, k) => {
            const i = p1End + k
            return (
              <div key={i}>
                <TaskRow i={i} max={maxPts[i]} value={points[i]} selected={sel === i} onSelect={() => setSel(i)} onSet={v => { setSel(i); setAt(i, v) }}
                  aiHint={aiPart2 && aiUsable(aiByTask.get(i + 1), maxPts[i]) ? aiByTask.get(i + 1)!.points : null} />
                {sel === i && (
                  <Part2Expand max={maxPts[i]} solutionPath={files.solution} criteriaPath={files.criteria} onClear={() => setAt(i, null)} hasValue={points[i] != null}
                    ai={aiPart2 ? { suggestion: aiByTask.get(i + 1) ?? null, state: aiState, value: points[i], onAccept: s => acceptAi(i, s) } : null}
                    comment={commentsReady ? { task: i + 1, value: comments[i], onChange: v => setCommentAt(i, v) } : null} />
                )}
              </div>
            )
          })}
        </section>
      </div>

      {/* §230: справа поле под компактную кнопку помощи (isFabCompactPath) — она не ложится на «Следующая →». */}
      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3.5 rounded-b-card border-t border-graphite-200 bg-white py-3.5 pl-4 pr-12 shadow-[0_-8px_20px_rgba(31,85,224,.06)] sm:pl-6 sm:pr-8" data-testid="mock-review-bar">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-graphite-900">
          <span>Первичный <b className="text-[22px]" data-testid="mock-review-primary">{totals.primary ?? '—'}</b> <span className="text-graphite-500">из {totals.of}</span></span>
          {tpl.score_scale?.length ? <span>Тестовый <b className="text-[22px]" data-testid="mock-review-test">{totals.test ?? '—'}</b></span> : null}
          <span className={cn('text-[13px]', totals.complete ? 'text-verdict-ok-ink' : 'text-graphite-500')} data-testid="mock-review-missing">{missingNote(points, n)}</span>
          {!dirty && (ns.kind === 'sent' || ns.kind === 'changed') && (
            <span className={cn('text-[13px]', ns.kind === 'changed' ? 'text-verdict-part-ink' : 'text-graphite-500')}>
              {ns.kind === 'sent' ? `✓ отправлено ${formatSentAt(ns.at)}` : 'итог изменён после отправки'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totals.complete && !dirty && canNotify(ns) && (
            <Button variant="secondary" onClick={notifyOne} loading={busy === 'notify'} disabled={busy != null || !student.profileId} data-testid="mock-review-notify"
              title={!student.profileId ? 'У ученика нет учётной записи' : undefined}>Уведомить</Button>
          )}
          <Button variant="secondary" onClick={() => save('stay')} loading={busy === 'save'} disabled={!dirty || busy != null} data-testid="mock-review-save">
            {!dirty ? <><Check size={15} aria-hidden />Сохранено</> : 'Сохранить'}
          </Button>
          <Button onClick={() => save('next')} loading={busy === 'next'} disabled={busy != null || (!dirty && !nextUrl)} data-testid="mock-review-save-next">
            {nextUrl ? (dirty ? 'Сохранить и следующая →' : 'Следующая →') : 'Сохранить и к списку'}
          </Button>
        </div>
        {status && (
          <p role="status" data-testid="mock-review-status" className={cn('w-full rounded-lg px-3 py-2 text-sm', status.kind === 'error' ? 'bg-verdict-bad-tint text-verdict-bad-ink' : 'bg-verdict-ok-tint text-verdict-ok-ink')}>{status.text}</p>
        )}
      </footer>
    </div>
  )
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-2 pb-1 pt-1 font-mono text-xs font-medium uppercase tracking-[.05em] text-graphite-500', className)}>{children}</div>
}

function TaskRow({ i, max, value, selected, onSelect, onSet, answer, keyAnswer, auto, part1, aiHint }: {
  i: number
  max: number
  value: number | null
  selected: boolean
  onSelect: () => void
  onSet: (v: number) => void
  answer?: string | null
  keyAnswer?: string | null
  auto?: boolean
  part1?: boolean
  /** §222b. Балл, предложенный ИИ (вторая часть); null — предложения нет. */
  aiHint?: number | null
}) {
  const mark = taskMark(value, max)
  return (
    <div
      className={cn('grid cursor-pointer grid-cols-[22px_26px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-2 py-[7px]',
        selected ? 'bg-primary-50 shadow-[inset_3px_0_0_theme(colors.primary.600)]' : 'hover:bg-graphite-50')}
      onClick={onSelect}
      data-testid="mock-review-task"
      data-task-row={i + 1}
      data-mark={mark}
      data-selected={selected || undefined}
      aria-current={selected || undefined}
    >
      <VerdictMark state={mark} size={20} label={mark === 'unk' ? 'Не оценено' : undefined} />
      <span className="font-bold text-graphite-900">{i + 1}</span>
      <span className="min-w-0 truncate text-[13px] text-graphite-600">
        {part1 ? (
          <>
            <code className="font-mono text-[13px] text-graphite-900" data-testid="mock-review-answer">{answer?.trim() || 'пусто'}</code>
            <span className="text-graphite-400"> · ключ </span>
            <code className="font-mono text-[13px] text-graphite-700" data-testid="mock-review-key">{keyAnswer ?? '—'}</code>
            {auto && <span className="ml-1.5 rounded bg-graphite-100 px-1 text-[11px] text-graphite-500" title="Поставлено по ключу. Исправьте, если в ключе опечатка — балл станет ручным">авто</span>}
          </>
        ) : <>из {max}{aiHint != null && <span className="text-graphite-500" data-testid="mock-review-ai-hint"> · ИИ {aiHint}</span>}</>}
      </span>
      <div className="flex gap-1" role="group" aria-label={`Балл за №${i + 1}`}>
        {Array.from({ length: max + 1 }, (_, v) => (
          <button key={v} type="button" aria-pressed={value === v}
            onClick={e => { e.stopPropagation(); onSet(v) }}
            data-testid="mock-review-pt"
            className={cn('h-11 w-9 rounded-lg border-[1.5px] text-[13px] font-bold sm:h-[30px] sm:w-[30px]',
              value === v ? 'border-primary-600 bg-primary-600 text-white' : 'border-graphite-300 bg-white text-graphite-900 hover:border-primary-500',
              'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-gold-300')}>
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * §229. Файлы варианта ученика над номерами: условие, решение, критерии —
 * открываются в новой вкладке (рядом с проверкой). Критерии видит только
 * персонал (политика хранилища), ученику их не выдать.
 */
function VariantFiles({ label, files }: { label: string | null; files: { condition: string | null; solution: string | null; criteria: string | null } }) {
  const link = (path: string | null, text: string, testid: string) => path
    ? <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={path} className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-primary-600 hover:underline"><span className="inline-flex items-center gap-1" data-testid={testid}><FileText size={13} aria-hidden />{text}</span></SignedFileLink>
    : <span className="text-[13px] text-graphite-400" data-testid={`${testid}-none`}>{text} — нет</span>
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-graphite-200 px-2 pb-2" data-testid="mock-review-files">
      <span className="text-[13px] font-semibold text-graphite-500">{label ? `${label}:` : 'Файлы:'}</span>
      {link(files.condition, 'Условие', 'mock-review-file-condition')}
      {link(files.solution, 'Решение', 'mock-review-file-solution')}
      {link(files.criteria, 'Критерии', 'mock-review-file-criteria')}
    </div>
  )
}

interface Part2Ai {
  suggestion: AiSuggestion | null
  state: AiRunState
  value: number | null
  onAccept: (s: AiSuggestion) => void
}

/** §270. Предел длины комментария ученику — как check в базе (mock_exam_task_scores_comment_len). */
const COMMENT_MAX = 2000

/** §270. Номера второй части (индексы с 0), где комментарий отличается от сохранённого (после обрезки пробелов). */
function commentChanges(comments: readonly string[], saved: readonly (string | null)[] | undefined, p1End: number): number[] {
  const out: number[] = []
  for (let i = p1End; i < comments.length; i += 1) {
    if ((comments[i] ?? '').trim() !== (saved?.[i] ?? '').trim()) out.push(i)
  }
  return out
}

/** §270. Первый номер второй части с текстом комментария, но без балла; null — таких нет. */
function commentWithoutPoints(comments: readonly string[], points: readonly (number | null)[], p1End: number): number | null {
  for (let i = p1End; i < comments.length; i += 1) {
    if (points[i] == null && (comments[i] ?? '').trim()) return i
  }
  return null
}

interface Part2Comment {
  task: number
  value: string
  onChange: (v: string) => void
}

function Part2Expand({ max, solutionPath, criteriaPath, onClear, hasValue, ai, comment }: { max: number; solutionPath: string | null; criteriaPath: string | null; onClear: () => void; hasValue: boolean; ai: Part2Ai | null; comment: Part2Comment | null }) {
  return (
    <div className="mb-2 ml-0 mt-1 flex flex-col gap-2 rounded-xl bg-graphite-50 px-3.5 py-3 sm:ml-[34px]" data-testid="mock-review-expand">
      <span className="text-[13px] font-semibold text-graphite-500">Максимум · {max} {plural(max, 'балл', 'балла', 'баллов')}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {criteriaPath ? (
          <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={criteriaPath} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:underline">
            <span className="inline-flex items-center gap-1" data-testid="mock-review-criteria"><FileText size={14} aria-hidden />Критерии — PDF</span>
          </SignedFileLink>
        ) : <span className="text-sm text-graphite-500">Критериев нет — их добавляют во вкладке «Настройка».</span>}
        {solutionPath ? (
          <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={solutionPath} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:underline">
            <span className="inline-flex items-center gap-1" data-testid="mock-review-solution"><FileText size={14} aria-hidden />Решение — PDF</span>
          </SignedFileLink>
        ) : <span className="text-sm text-graphite-500">Решение не загружено — его добавляют во вкладке «Настройка».</span>}
      </div>
      {ai && <AiSuggestionBox max={max} ai={ai} />}
      {comment && (
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-graphite-500">Комментарий ученику</span>
          <textarea value={comment.value} onChange={e => comment.onChange(e.target.value)} maxLength={COMMENT_MAX} rows={3}
            data-testid="mock-review-comment" aria-describedby={`mock-review-comment-hint-${comment.task}`}
            placeholder="Что не так в решении и как исправить"
            className="w-full resize-y rounded-lg border-[1.5px] border-graphite-300 bg-white px-3 py-2 text-sm text-graphite-900 placeholder:text-graphite-400 focus:border-primary-500 focus:outline-none" />
          <span id={`mock-review-comment-hint-${comment.task}`} className="text-xs text-graphite-500" data-testid="mock-review-comment-hint">
            {hasValue ? 'Ученик увидит комментарий в результатах пробника — после «Уведомить».' : 'Сначала поставьте балл: комментарий сохраняется только вместе с баллом.'}
            {comment.value.length > COMMENT_MAX - 200 && ` ${comment.value.length} / ${COMMENT_MAX}`}
          </span>
        </label>
      )}
      {hasValue && <button type="button" onClick={onClear} className="self-start text-[13px] text-graphite-500 underline hover:text-graphite-900">очистить балл</button>}
    </div>
  )
}

/**
 * §222b. Над номерами: состояние ИИ-проверки этой работы, «Проверить ИИ» и
 * «Принять все предложения ИИ» (только в пустые клетки второй части).
 */
function AiPanel({ state, run, count, acceptable, active, error, hasPhotos, onRun, onAcceptAll }: {
  state: AiRunState
  run: AiRun | null
  count: number
  acceptable: number
  active: boolean
  error: string | null
  hasPhotos: boolean
  onRun: () => void
  onAcceptAll: () => void
}) {
  const line = aiStatusLine(state, run, count)
  return (
    <div className="mb-1.5 flex flex-col gap-2 border-b border-graphite-200 px-2 pb-2.5" data-testid="mock-review-ai-panel" data-state={state}>
      <span className={cn('inline-flex items-start gap-1.5 text-[13px]',
        line.tone === 'error' ? 'text-verdict-bad-ink' : line.tone === 'ok' ? 'text-verdict-ok-ink' : 'text-graphite-600')} data-testid="mock-review-ai-status" role="status">
        {line.tone === 'busy' ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" aria-hidden /> : <Sparkles size={14} className="mt-0.5 shrink-0" aria-hidden />}
        {line.text}
      </span>
      {state === 'done' && run?.note && <span className="text-xs text-graphite-500" data-testid="mock-review-ai-note">{run.note}</span>}
      {error && <span className="text-[13px] text-verdict-bad-ink" data-testid="mock-review-ai-error">{error}</span>}
      <div className="flex flex-wrap gap-2">
        {acceptable > 0 && (
          <Button size="sm" onClick={onAcceptAll} data-testid="mock-review-ai-accept-all"
            title="Только в номера без балла — поставленные баллы не меняются">
            Принять все предложения ИИ · {acceptable}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onRun} loading={active} disabled={active || !hasPhotos} data-testid="mock-review-ai-run"
          title={!hasPhotos ? 'Фото второй части нет' : 'Баллы ИИ — только предложение; ставите вы'}>
          {count > 0 || state === 'done' ? 'Проверить ИИ заново' : 'Проверить ИИ'}
        </Button>
      </div>
    </div>
  )
}

/** §222b. Предложение ИИ в раскрытом номере второй части: балл, уверенность, комментарий, «Принять». */
function AiSuggestionBox({ max, ai }: { max: number; ai: Part2Ai }) {
  const s = ai.suggestion
  if (!s) {
    const text = isAiActive(ai.state) ? 'ИИ проверяет работу…'
      : ai.state === 'done' ? 'ИИ не предложил балла за этот номер — поставьте сами.'
        : ai.state === 'error' || ai.state === 'stale' ? 'ИИ не проверил работу — причина над номерами.'
          : 'ИИ ещё не проверял эту работу — кнопка «Проверить ИИ» над номерами.'
    return <div className="rounded-[10px] bg-white px-3 py-2.5 text-sm text-graphite-600" data-testid="mock-review-ai">{text}</div>
  }
  const usable = aiUsable(s, max)
  const accepted = ai.value === s.points
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-verdict-part-tint px-3 py-2.5 text-sm text-verdict-part-ink" data-testid="mock-review-ai" data-confidence={s.confidence}>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b data-testid="mock-review-ai-line">{aiPointsLine(s, max)}</b>
        <span className="text-[13px]" data-testid="mock-review-ai-confidence">· {AI_CONFIDENCE_LABEL[s.confidence]}</span>
        {s.regions.length > 0 && <span className="text-[13px]">· рамка на фото</span>}
      </span>
      {s.comment && <span className="text-graphite-800" data-testid="mock-review-ai-comment">{s.comment}</span>}
      {usable ? (
        <Button size="sm" variant={accepted ? 'secondary' : 'primary'} className="self-start" disabled={accepted} onClick={() => ai.onAccept(s)} data-testid="mock-review-ai-accept">
          {accepted ? <><Check size={14} aria-hidden />Принято</> : ai.value != null ? `Принять ${s.points} вместо ${ai.value}` : `Принять ${s.points}`}
        </Button>
      ) : (
        <span className="text-[13px]" data-testid="mock-review-ai-unusable">Максимум номера теперь {max} — предложение устарело, поставьте сами.</span>
      )}
      <span className="text-xs text-graphite-500">Балл ИИ — только предложение: в работу он попадёт, когда вы его примете и сохраните.</span>
    </div>
  )
}

/**
 * Фото второй части: вкладки, масштаб, поворот текущего. §222b: рамки
 * предложения ИИ выбранного номера — поверх листа; при выборе номера фото
 * переключается на лист его первой рамки.
 * §229: PDF вместо фото — страницы листами, вкладки «Фото N · стр. K» (до §229 на
 * месте PDF стояло «Не удалось показать изображение»: `<img>` его не рисует).
 */
function PhotoPane({ photos, suggestion }: { photos: WorksStudent['photoList']; suggestion?: AiSuggestion | null }) {
  const [at, setAt] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [turn, setTurn] = useState<Record<string, number>>({})
  const [pdfs, setPdfs] = useState<Record<string, SignedPdfState>>({})
  const sheets = useMemo(() => photos.flatMap((p, i) => {
    if (!isPdfFile(p)) return [{ key: p.id, photo: p, n: i + 1, page: null as number | null, label: `Фото ${i + 1}` }]
    const st = pdfs[p.id]
    if (st?.status === 'ready' && st.pages > 0) {
      return Array.from({ length: st.pages }, (_, j) => ({ key: `${p.id}:${j + 1}`, photo: p, n: i + 1, page: j + 1, label: `Фото ${i + 1} · стр. ${j + 1}` }))
    }
    return [{ key: p.id, photo: p, n: i + 1, page: null, label: `Фото ${i + 1} · PDF` }]
  }), [photos, pdfs])
  const sheet = sheets[Math.min(at, sheets.length - 1)] ?? null
  const deg = sheet ? (turn[sheet.key] ?? 0) : 0
  const pdfState = sheet && isPdfFile(sheet.photo) ? pdfs[sheet.photo.id] : undefined
  // У PDF, ещё не разложенного на страницы, рамок не рисуем — не к чему привязать.
  const boxes = sheet ? regionsOnSheet(suggestion, sheet.photo.id, isPdfFile(sheet.photo) ? (sheet.page ?? -1) : null) : []
  const focus = firstRegion(suggestion)
  // Состояние подправляем во время отрисовки (а не эффектом) — когда сменился
  // номер с рамкой или PDF разложился на страницы.
  const focusSig = focus ? `${focus.photo_id}:${focus.page}:${sheets.length}` : ''
  const [seenFocus, setSeenFocus] = useState('')
  if (focusSig !== seenFocus) {
    setSeenFocus(focusSig)
    const idx = focus ? sheets.findIndex(sh => sh.photo.id === focus.photo_id && (sh.page == null || sh.page === focus.page)) : -1
    if (idx >= 0 && idx !== at) setAt(idx)
  }
  return (
    <section className="flex min-w-0 flex-col gap-3 px-3 py-3.5 sm:px-[22px]" data-testid="mock-review-photos" aria-label="Фото второй части">
      {photos.filter(p => isPdfFile(p)).map(p => (
        <PdfProbe key={p.id} path={p.storage_path} onState={st => setPdfs(prev => (prev[p.id]?.status === st.status ? prev : { ...prev, [p.id]: st }))} />
      ))}
      {photos.length === 0 ? (
        <p className="rounded-[14px] bg-graphite-50 px-4 py-10 text-center text-sm text-graphite-500">Фото второй части ученик не прислал.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Фото">
              {sheets.map((sh, i) => (
                <button key={sh.key} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)} data-testid="mock-review-photo-tab"
                  className={cn('min-h-9 rounded-full border-[1.5px] px-3 text-[13px] font-semibold', i === at ? 'border-primary-600 bg-primary-50 text-primary-600' : 'border-graphite-300 bg-white text-graphite-900 hover:border-primary-500')}>
                  {sh.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-[13px] text-graphite-500">
              <button type="button" aria-label="Мельче" onClick={() => setZoom(z => Math.max(50, z - 25))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-primary-50"><ZoomOut size={16} /></button>
              <button type="button" onClick={() => setZoom(100)} className="min-w-[3.5rem] rounded-full px-1.5 py-1 hover:bg-primary-50" title="По ширине" data-testid="mock-review-zoom">{zoom} %</button>
              <button type="button" aria-label="Крупнее" onClick={() => setZoom(z => Math.min(300, z + 25))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-primary-50"><ZoomIn size={16} /></button>
              <button type="button" onClick={() => sheet && setTurn(t => ({ ...t, [sheet.key]: ((t[sheet.key] ?? 0) + 90) % 360 }))}
                className="inline-flex h-9 items-center gap-1 rounded-full px-2 hover:bg-primary-50" data-testid="mock-review-rotate"><RotateCw size={15} aria-hidden />повернуть</button>
            </div>
          </div>
          <div className="h-[62vh] overflow-auto rounded-[14px] bg-graphite-50 lg:h-[calc(100vh-330px)] lg:min-h-[420px]" data-testid="mock-review-photo">
            {sheet && (
              <div className="flex min-h-full items-start justify-center p-2" style={{ width: `${zoom}%` }}>
                <div className={cn('relative transition-transform', sheet.page != null && 'w-full')} style={deg ? { transform: `rotate(${deg}deg)` } : undefined} data-rotate={deg || undefined}>
                  {!isPdfFile(sheet.photo) ? (
                    <SignedImage bucket={MOCK_EXAMS_BUCKET} path={sheet.photo.storage_path} alt={`Фото ${sheet.n} — работа ученика`} sensitive
                      className="block h-auto max-w-full rounded shadow-sm" />
                  ) : pdfState?.status === 'ready' && sheet.page != null ? (
                    <PdfPageView doc={pdfState.doc} page={sheet.page} className="w-full" label={`Фото ${sheet.n} (PDF), страница ${sheet.page} из ${pdfState.pages} — работа ученика`} />
                  ) : pdfState?.status === 'failed' ? (
                    <p className="px-4 py-10 text-center text-sm text-graphite-600" data-testid="mock-review-pdf-failed">
                      PDF не удалось показать страницами.{' '}
                      <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={sheet.photo.storage_path} className="font-semibold text-primary-600 hover:underline">Открыть файл</SignedFileLink>
                    </p>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-4 py-10 text-sm text-graphite-400"><Loader2 size={16} className="animate-spin" />Готовлю страницы PDF…</span>
                  )}
                  {boxes.map((r, k) => (
                    <div key={k} aria-hidden data-testid="mock-review-ai-region"
                      className="pointer-events-none absolute rounded-md border-[2.5px] border-gold-500 bg-gold-300/20 shadow-[0_0_0_2px_rgba(255,255,255,.7)]"
                      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
          {deg !== 0 && <span className="sr-only">повёрнуто на {deg}°</span>}
        </>
      )}
    </section>
  )
}

/** Загрузить PDF-файл работы (число страниц и документ) и сообщить наверх. */
function PdfProbe({ path, onState }: { path: string; onState: (st: SignedPdfState) => void }) {
  const st = useSignedPdf(MOCK_EXAMS_BUCKET, path)
  useEffect(() => { onState(st) }, [st.status]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
