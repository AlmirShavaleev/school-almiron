import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Check, FileText, Loader2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SignedImage } from '@/components/ui/SignedImage'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useMockExamWorks, type WorksExam, type WorksStudent } from '@/hooks/useMockExamWorks'
import { MOCK_EXAMS_BUCKET, mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { canNotify, notifyState, formatSentAt } from '@/lib/mockExamNotify'
import {
  keyToPoints, markCounts, missingNote, nextToReview, reviewPosition, reviewTotals, sentLine, taskMark, workRows, type WorkRow,
} from '@/lib/mockExamV3'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §228. Проверка работы ученика по номерам (экран 3 макета) — по образцу
 * «Проверки работы» ДЗ (§226): шапка «← Пробник · работа N из M», имя,
 * «сдал … · K фото», «Следующая работа →» и сводка метками `VerdictMark`;
 * в центре — фото второй части (вкладки, масштаб, повернуть); справа — номера:
 * первая часть — ответ ученика рядом с ключом и балл ключа (исправить можно:
 * клетка перестаёт быть «авто», §221), вторая — кнопки 0…максимум шаблона.
 * Выбранный номер раскрыт: максимум, ответ ключа или решение PDF, место под
 * подсказку ИИ (этап Б, §222 — вызова ИИ нет). Клавиши: цифра ставит балл
 * выбранному, ↑↓ — номера, Delete — очистить.
 *
 * Сохранение — существующей `save_mock_exam_grid` строкой ученика целиком;
 * «Уведомить» — `notify_mock_exam_results(exam, [ученик])`, только когда все
 * номера оценены и сохранены. Ученик ничего не получает при сохранении (§219).
 */
export function MockExamReviewPage() {
  const { id, studentId } = useParams<{ id: string; studentId: string }>()
  const works = useMockExamWorks(id)
  const { exam, students, key, loading, error } = works
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
  return <Review key={student.id} exam={exam} students={students} student={student} answerKey={key} works={works} />
}

type Works = ReturnType<typeof useMockExamWorks>

function Review({ exam, students, student, answerKey, works }: {
  exam: WorksExam
  students: WorksStudent[]
  student: WorksStudent
  answerKey: (string | null)[] | null
  works: Works
}) {
  const navigate = useNavigate()
  const tpl = exam.template!
  const maxPts = tpl.max_points
  const n = maxPts.length
  const p1End = tpl.part1_last
  const [points, setPoints] = useState<(number | null)[]>(() => Array.from({ length: n }, (_, i) => student.points[i] ?? null))
  const [sel, setSel] = useState(() => {
    const firstMissing = Array.from({ length: n }, (_, i) => i).find(i => student.points[i] == null && i >= p1End)
    return firstMissing ?? Array.from({ length: n }, (_, i) => i).find(i => student.points[i] == null) ?? 0
  })
  const [busy, setBusy] = useState<'save' | 'next' | 'notify' | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [leaveTo, setLeaveTo] = useState<string | null>(null)

  // Окно на экране проверки уже закрыто — «сейчас» достаточно взять один раз.
  const [openedAt] = useState(() => Date.now())
  const rows: WorkRow[] = useMemo(() => workRows(students, tpl, exam.window, openedAt), [students, tpl, exam.window, openedAt])
  const next = nextToReview(rows, student.id)
  const pos = reviewPosition(rows, student.id)
  const saved = student.points
  const dirty = points.some((v, i) => v !== (saved[i] ?? null))
  const totals = reviewTotals(points, tpl)
  const counts = markCounts(points, maxPts)
  const ns = notifyState(student.result)
  const worksUrl = `/mock-exams/${exam.id}?tab=works`
  const nextUrl = next ? `/mock-exams/${exam.id}/review/${next.id}` : null

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

  async function save(then: 'stay' | 'next'): Promise<boolean> {
    setBusy(then === 'next' ? 'next' : 'save')
    setStatus(null)
    const r = await works.saveRow(student.id, points)
    setBusy(null)
    if (r.error) { setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); return false }
    if (then === 'next') {
      navigate(nextUrl ?? worksUrl)
      works.reload()
      return true
    }
    works.reload()
    setStatus({ kind: 'ok', text: totals.complete ? 'Сохранено. Ученик ничего не получил — отправьте кнопкой «Уведомить».' : `Сохранено. ${missingNote(points, n)[0].toUpperCase()}${missingNote(points, n).slice(1)}.` })
    return true
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
          <h1 className="text-xl font-semibold leading-tight text-graphite-900 [text-wrap:balance] sm:text-2xl" data-testid="mock-review-title">{student.name} — {exam.title}</h1>
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
          <span className="mr-auto">Есть несохранённые баллы.</span>
          <Button size="sm" onClick={async () => { const to = leaveTo; setLeaveTo(null); const r = await works.saveRow(student.id, points); if (r.error) { setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); return } works.reload(); navigate(to) }}>Сохранить и перейти</Button>
          <Button size="sm" variant="secondary" onClick={() => { const to = leaveTo; setLeaveTo(null); navigate(to) }}>Перейти без сохранения</Button>
          <Button size="sm" variant="ghost" onClick={() => setLeaveTo(null)}>Остаться</Button>
        </div>
      )}

      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        <PhotoPane photos={student.photoList} />
        <section className="flex max-h-none flex-col gap-1 border-t border-graphite-200 px-3 py-3.5 sm:px-[18px] lg:max-h-[calc(100vh-260px)] lg:overflow-auto lg:border-l lg:border-t-0" data-testid="mock-review-tasks" aria-label="Номера">
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
                <TaskRow i={i} max={maxPts[i]} value={points[i]} selected={sel === i} onSelect={() => setSel(i)} onSet={v => { setSel(i); setAt(i, v) }} />
                {sel === i && <Part2Expand max={maxPts[i]} solutionPath={exam.solution_path} onClear={() => setAt(i, null)} hasValue={points[i] != null} />}
              </div>
            )
          })}
        </section>
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3.5 rounded-b-card border-t border-graphite-200 bg-white px-4 py-3.5 shadow-[0_-8px_20px_rgba(31,85,224,.06)] sm:px-6" data-testid="mock-review-bar">
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

function TaskRow({ i, max, value, selected, onSelect, onSet, answer, keyAnswer, auto, part1 }: {
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
        ) : <>из {max}</>}
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

function Part2Expand({ max, solutionPath, onClear, hasValue }: { max: number; solutionPath: string | null; onClear: () => void; hasValue: boolean }) {
  return (
    <div className="mb-2 ml-0 mt-1 flex flex-col gap-2 rounded-xl bg-graphite-50 px-3.5 py-3 sm:ml-[34px]" data-testid="mock-review-expand">
      <span className="text-[13px] font-semibold text-graphite-500">Максимум · {max} {plural(max, 'балл', 'балла', 'баллов')}</span>
      <span className="text-[13px] font-semibold text-graphite-500">Ответ в решении</span>
      {solutionPath ? (
        <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={solutionPath} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:underline">
          <FileText size={14} aria-hidden />решение — PDF
        </SignedFileLink>
      ) : <span className="text-sm text-graphite-500">Решение не загружено — его добавляют во вкладке «Настройка».</span>}
      <div className="rounded-[10px] bg-verdict-part-tint px-3 py-2.5 text-sm text-verdict-part-ink" data-testid="mock-review-ai">
        <b>Подсказка ИИ — позже (этап Б).</b> Здесь появится предложение балла с рамкой на фото; балл ставите вы.
      </div>
      {hasValue && <button type="button" onClick={onClear} className="self-start text-[13px] text-graphite-500 underline hover:text-graphite-900">очистить балл</button>}
    </div>
  )
}

/** Фото второй части: вкладки, масштаб, поворот текущего. Рамок-пометок в этом шаге нет. */
function PhotoPane({ photos }: { photos: WorksStudent['photoList'] }) {
  const [at, setAt] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [turn, setTurn] = useState<Record<string, number>>({})
  const photo = photos[Math.min(at, photos.length - 1)] ?? null
  const deg = photo ? (turn[photo.id] ?? 0) : 0
  return (
    <section className="flex min-w-0 flex-col gap-3 px-3 py-3.5 sm:px-[22px]" data-testid="mock-review-photos" aria-label="Фото второй части">
      {photos.length === 0 ? (
        <p className="rounded-[14px] bg-graphite-50 px-4 py-10 text-center text-sm text-graphite-500">Фото второй части ученик не прислал.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Фото">
              {photos.map((p, i) => (
                <button key={p.id} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)} data-testid="mock-review-photo-tab"
                  className={cn('min-h-9 rounded-full border-[1.5px] px-3 text-[13px] font-semibold', i === at ? 'border-primary-600 bg-primary-50 text-primary-600' : 'border-graphite-300 bg-white text-graphite-900 hover:border-primary-500')}>
                  Фото {i + 1}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-[13px] text-graphite-500">
              <button type="button" aria-label="Мельче" onClick={() => setZoom(z => Math.max(50, z - 25))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-primary-50"><ZoomOut size={16} /></button>
              <button type="button" onClick={() => setZoom(100)} className="min-w-[3.5rem] rounded-full px-1.5 py-1 hover:bg-primary-50" title="По ширине" data-testid="mock-review-zoom">{zoom} %</button>
              <button type="button" aria-label="Крупнее" onClick={() => setZoom(z => Math.min(300, z + 25))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-primary-50"><ZoomIn size={16} /></button>
              <button type="button" onClick={() => photo && setTurn(t => ({ ...t, [photo.id]: ((t[photo.id] ?? 0) + 90) % 360 }))}
                className="inline-flex h-9 items-center gap-1 rounded-full px-2 hover:bg-primary-50" data-testid="mock-review-rotate"><RotateCw size={15} aria-hidden />повернуть</button>
            </div>
          </div>
          <div className="h-[62vh] overflow-auto rounded-[14px] bg-graphite-50 lg:h-[calc(100vh-330px)] lg:min-h-[420px]" data-testid="mock-review-photo">
            {photo && (
              <div className="flex min-h-full items-start justify-center p-2" style={{ width: `${zoom}%` }}>
                <div className="transition-transform" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} data-rotate={deg || undefined}>
                  <SignedImage bucket={MOCK_EXAMS_BUCKET} path={photo.storage_path} alt={`Фото ${at + 1} — работа ученика`} sensitive
                    className="block h-auto max-w-full rounded shadow-sm" />
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
