import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Eye, Filter, Inbox, Loader2, Paperclip, RefreshCw, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'
import { AiCheckPanel } from '@/components/courseProgram/AiCheckPanel'
import type { ImportedRegion } from '@/components/SubmissionReviewer'
import { CONFIDENCE_LABEL, findingsToRegions } from '@/lib/aiHomeworkCheck'
import { useHomeworkAiCheck } from '@/hooks/useHomeworkAiCheck'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'
import { useQueueAiJobs } from '@/hooks/useQueueAiJobs'
import { useReviewPresence } from '@/hooks/useReviewPresence'
import { courseFilterOptions, groupByDay, isSubmittedLate, type QueueRow } from '@/lib/homeworkQueue'
import { viewersLabel, viewersOfAttempt, type PresenceMeta } from '@/lib/reviewPresence'
import type { TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'
import type { QueueAiJob } from '@/hooks/useQueueAiJobs'

/** Дата ушла в заголовок дня, в строке остаётся только время сдачи. */
function formatTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Склонение слова "замечание" по числу. */
function findingsDeclension(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'замечание'
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return 'замечания'
  return 'замечаний'
}

/**
 * Строка очереди — только то, что нужно для решения «за какую работу взяться»:
 * кто сдал, что именно, не опоздал ли и не разбирает ли её уже коллега.
 * Комментарий, балл и кнопки вердикта из списка убраны сознательно (решение
 * владельца 2026-07-30): пока работа не открыта, оценивать нечего, а форма на
 * каждой карточке превращала список в стену полей.
 *
 * Строка — не одна большая кнопка, а две: широкая область с именем и отдельная
 * «Проверить» справа. Вкладывать кнопку в кнопку нельзя, а обе ведут в одно и
 * то же место, так что попасть мимо невозможно.
 */
function QueueRowItem({
  row, files, studentName, viewers, showCourse, selected, onToggleSelect, ai, aiBusy, onRunAi, onOpen,
}: {
  row: QueueRow
  files: TopicHomeworkAttemptFileRow[]
  studentName: string
  /** Коллеги, открывшие эту работу прямо сейчас. */
  viewers: PresenceMeta[]
  /** Показывать курс в строке: нужно, только когда в списке их несколько. */
  showCourse: boolean
  /** Выбрана ли работа в списке. */
  selected: boolean
  /** Обработчик переключения выделения. */
  onToggleSelect: () => void
  /** ИИ-задача для этой работы, если есть. */
  ai?: QueueAiJob
  /** Выполняется ли ИИ-проверка. */
  aiBusy: boolean
  /** Обработчик запуска проверки для одной работы. */
  onRunAi: () => void
  onOpen: () => void
}) {
  const { attempt } = row
  const late = isSubmittedLate(row)
  const busy = viewers.length > 0
  const time = formatTime(attempt.submitted_at)
  const showAiButton = !ai || ai.status === 'failed'

  return (
    <li
      data-testid="queue-attempt-card"
      data-attempt-id={attempt.id}
      data-late={late ? 'true' : 'false'}
      className="flex items-center gap-3 border-b border-gray-100 px-1 py-2.5 transition-colors last:border-b-0 hover:bg-primary-50/40"
    >
      <input
        type="checkbox"
        data-testid="queue-select"
        checked={selected}
        onChange={onToggleSelect}
        onClick={e => e.stopPropagation()}
        aria-label="Выбрать работу"
        className="h-4 w-4 shrink-0 accent-primary-600"
      />

      <button
        type="button"
        onClick={onOpen}
        title={`${row.topicTitle} · ${row.homeworkTitle}`}
        className="min-w-0 flex-1 truncate text-left text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <span className="font-medium">{studentName}</span>
        <span className="text-gray-400"> — </span>
        <span className="text-gray-600">{row.topicTitle}</span>
        {showCourse && (
          <span className="ml-2 text-xs text-gray-400">{row.courseTitle}</span>
        )}
        {attempt.attempt_number > 1 && (
          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
            попытка №{attempt.attempt_number}
          </span>
        )}
        {files.length > 0 && (
          <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] text-gray-400">
            <Paperclip size={10} />
            {files.length}
          </span>
        )}
      </button>

      {time && <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 sm:inline">{time}</span>}

      {/* ИИ-статус метка */}
      {(aiBusy || ai) && (
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium sm:inline-flex',
            aiBusy || ai?.status === 'pending' || ai?.status === 'processing'
              ? 'bg-gray-100 text-gray-600'
              : ai?.status === 'done'
                ? 'bg-violet-100 text-violet-800'
                : ai?.status === 'failed'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-600',
          )}
          title={ai?.confidence ? CONFIDENCE_LABEL[ai.confidence] : undefined}
        >
          {aiBusy || ai?.status === 'pending' || ai?.status === 'processing' ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              ИИ проверяет
            </>
          ) : ai?.status === 'done' ? (
            <>
              <span>
                ИИ: {ai.findings === 0 ? 'без замечаний' : `${ai.findings} ${findingsDeclension(ai.findings)}`}
                {ai.suggestedScore != null && ` · ${ai.suggestedScore} б.`}
              </span>
            </>
          ) : ai?.status === 'failed' ? (
            <>ИИ не смог</>
          ) : null}
        </span>
      )}

      {/* Плашка ровно одна. Раньше «Просрочено» и «Ожидает проверки» стояли
          рядом и спорили за внимание, хотя сообщали одно и то же состояние с
          разной срочностью. Порядок важности: за работу уже взялись → работа
          просрочена → обычное ожидание. */}
      {busy ? (
        <span
          data-testid="queue-viewer-badge"
          title={viewersLabel(viewers)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white"
        >
          <Eye size={11} />
          Проверяется
        </span>
      ) : late ? (
        <span
          data-testid="queue-late-badge"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
        >
          <AlertTriangle size={11} />
          Просрочено
        </span>
      ) : (
        <span className="hidden shrink-0 rounded-md bg-primary-100 px-2 py-1 text-xs font-medium text-primary-800 sm:inline-flex">
          Ожидает проверки
        </span>
      )}

      {showAiButton && (
        <button
          type="button"
          onClick={() => onRunAi()}
          disabled={aiBusy}
          title="Проверить этой работе черновик ИИ"
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50 sm:inline-flex"
        >
          {aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        </button>
      )}

      <Button size="sm" variant={busy ? 'secondary' : 'primary'} onClick={onOpen} className="shrink-0">
        Проверить
      </Button>
    </li>
  )
}

/**
 * Общая очередь проверки ДЗ: все сданные работы по всем темам и курсам
 * преподавателя, старые сверху. Список — только для выбора работы; проверка
 * (рамки, комментарий, балл, вердикт) открывается по клику на строку.
 */
export function HomeworkReviewQueuePage() {
  const { rows, attemptFiles, studentNames, loading, error, reload, reviewAttempt } = useHomeworkReviewQueue()
  /**
   * `locked` снимается один раз — в момент открытия. Дальше кнопка «Всё равно
   * редактировать» его сбрасывает, а приход нового зрителя уже не возвращает:
   * иначе коллега, зашедший посмотреть, выбивал бы из редактирования того, кто
   * начал первым.
   */
  const [reviewing, setReviewing] = useState<{ row: QueueRow; locked: boolean } | null>(null)
  const filesOf = (attemptId: string) => attemptFiles.filter(f => f.attempt_id === attemptId)

  // Фильтры живут в обычном useState и никуда не синхронизируются. Связка
  // «состояние ↔ адрес через эффект» — ровно та конструкция, в которой сидел
  // бесконечный цикл из §35.2; здесь она не нужна.
  const [courseFilter, setCourseFilter] = useState<string>('all')
  const [order, setOrder] = useState<'oldest' | 'newest'>('oldest')
  const [onlyLate, setOnlyLate] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const courseOptions = useMemo(() => courseFilterOptions(rows), [rows])

  const visibleRows = useMemo(() => {
    let out = rows
    if (courseFilter !== 'all') out = out.filter(r => r.courseId === courseFilter)
    if (onlyLate) out = out.filter(isSubmittedLate)
    if (order === 'newest') out = [...out].reverse()
    return out
  }, [rows, courseFilter, onlyLate, order])

  const visibleAttemptIds = useMemo(() => visibleRows.map(r => r.attempt.id), [visibleRows])
  const { jobs: aiJobs, running: aiRunning, runChecks, reload: reloadAi } = useQueueAiJobs(visibleAttemptIds)

  const groups = useMemo(() => groupByDay(visibleRows), [visibleRows])

  const selectedVisible = useMemo(
    () => visibleAttemptIds.filter(id => selected.has(id)),
    [selected, visibleAttemptIds],
  )

  // Курс в строке нужен, только когда их в списке несколько: при выбранном
  // курсе повторять его название в каждой строке — шум.
  const showCourseInRow = courseFilter === 'all' && courseOptions.length > 1
  const lateCount = rows.filter(isSubmittedLate).length

  // Фильтр по курсу мог отсечь всё — это не то же самое, что пустая очередь,
  // и говорить про «всё проверено» здесь было бы враньём.
  const hiddenByFilter = rows.length > 0 && visibleRows.length === 0

  const courseIds = useMemo(() => rows.map(r => r.courseId), [rows])
  const { viewers } = useReviewPresence({ courseIds, attemptId: reviewing?.row.attempt.id ?? null })
  const viewersOf = (attemptId: string) => viewersOfAttempt(viewers, attemptId)

  // ── Черновик ИИ ─────────────────────────────────────────────────────
  const openAttemptId = reviewing?.row.attempt.id ?? null
  const ai = useHomeworkAiCheck(openAttemptId)
  // Перенос рамок делает сам аннотатор: он владеет страницами и умеет их
  // сохранять. Отсюда ref вместо проброса данных вниз.
  const importRegionsRef = useRef<((regions: ImportedRegion[]) => Promise<number>) | null>(null)
  const [fillRequest, setFillRequest] = useState<{ comment?: string } | null>(null)

  async function applyAiFrames(): Promise<number> {
    const importRegions = importRegionsRef.current
    if (!importRegions) throw new Error('Разбор ещё не готов — попробуйте через секунду')
    // Находка ссылается на файл по id, аннотатор адресует страницы по пути.
    const pathById = Object.fromEntries(attemptFiles.map(f => [f.id, f.storage_path]))
    const count = await importRegions(findingsToRegions(ai.findings, pathById))
    if (count > 0 && ai.job) {
      // Отметка «черновик забрали» — для статистики пользы ИИ, а не для логики.
      // Её сбой не должен выглядеть как несработавший перенос.
      try { await ai.markAccepted(ai.job.id) } catch { /* рамки уже перенесены */ }
    }
    return count
  }

  /**
   * Черновик ИИ переносится в разметку САМ, как только работа открыта.
   *
   * Раньше это была вторая кнопка: сначала «Проверить с ИИ», потом «Перенести
   * рамки». Второе нажатие ничего не решало — отказаться от переноса всё равно
   * никто не отказывался, а рамки черновые и ученику до публикации не видны.
   * Поэтому переносим молча и один раз: признак «уже забрали» — accepted_at
   * у задачи, его же читает список очереди.
   *
   * Аннотатор выставляет importRegionsRef после монтирования, а оно ленивое
   * (pdfjs грузится отдельным чанком). Поэтому не одна попытка, а несколько с
   * паузой — иначе на медленном канале перенос молча не случался бы.
   */
  const autoAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    const job = ai.job
    if (!openAttemptId || !job || job.status !== 'done' || job.accepted_at) return
    if (ai.findings.length === 0) return
    if (autoAppliedRef.current === job.id) return
    if (reviewing?.locked) return

    autoAppliedRef.current = job.id
    let cancelled = false
    let tries = 0

    async function attempt() {
      while (!cancelled && tries < 20) {
        if (importRegionsRef.current) {
          try {
            await applyAiFrames()
            if (!cancelled) setFillRequest({ comment: job!.summary ?? undefined })
          } catch { /* причина уже показана панелью разбора */ }
          return
        }
        tries += 1
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    void attempt()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAttemptId, ai.job?.id, ai.job?.status, ai.findings.length, reviewing?.locked])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Проверка домашних заданий</h1>
          <p data-testid="queue-count" className="mt-0.5 text-sm text-gray-500">
            {loading
              ? 'Загрузка…'
              : rows.length === 0
                ? 'Всё проверено'
                : `Ждут проверки: ${rows.length}${lateCount > 0 ? ` · просрочено: ${lateCount}` : ''}`}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Панель фильтров. Курсов в очереди обычно немного, поэтому список
          строится из самой очереди и рядом с каждым курсом стоит счётчик —
          видно, где скопился хвост, ещё до выбора. */}
      {rows.length > 0 && (
        <div
          data-testid="queue-filters"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5"
        >
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={selectedVisible.length === visibleAttemptIds.length && visibleAttemptIds.length > 0}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelected(new Set(visibleAttemptIds))
                } else {
                  setSelected(new Set())
                }
              }}
              aria-label="Выбрать все видимые работы"
              className="h-4 w-4 shrink-0 accent-primary-600"
            />
            Выбрать все
          </label>

          <label className="flex items-center gap-2 text-xs text-gray-500">
            <Filter size={13} />
            Курс
            <select
              data-testid="queue-course-filter"
              aria-label="Курс"
              value={courseFilter}
              onChange={e => setCourseFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="all">Все курсы · {rows.length}</option>
              {courseOptions.map(c => (
                <option key={c.id} value={c.id}>{c.title} · {c.count}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-gray-500">
            Порядок
            <select
              aria-label="Порядок"
              value={order}
              onChange={e => setOrder(e.target.value === 'newest' ? 'newest' : 'oldest')}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="oldest">Сначала давние</option>
              <option value="newest">Сначала свежие</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => setOnlyLate(v => !v)}
            aria-pressed={onlyLate}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              onlyLate
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900',
            )}
          >
            <AlertTriangle size={12} />
            Только просроченные{lateCount > 0 ? ` · ${lateCount}` : ''}
          </button>

          {(courseFilter !== 'all' || onlyLate || order !== 'oldest') && (
            <button
              type="button"
              onClick={() => { setCourseFilter('all'); setOnlyLate(false); setOrder('oldest') }}
              className="ml-auto text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Панель массового действия */}
      {selectedVisible.length > 0 && (
        <div
          data-testid="queue-bulk-bar"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5"
        >
          <span className="text-sm font-medium text-primary-900">Выбрано: {selectedVisible.length}</span>
          <Button
            size="sm"
            onClick={() => runChecks(selectedVisible)}
            loading={aiRunning.size > 0}
            disabled={aiRunning.size > 0}
          >
            <Sparkles size={14} />
            Проверить с ИИ
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-primary-700 underline-offset-2 hover:underline"
          >
            Снять выделение
          </button>
          {aiRunning.size > 0 && <span className="text-xs text-primary-700">Осталось: {aiRunning.size}</span>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Собираем сданные работы…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-gray-700">Очередь пуста</p>
          <p className="mt-1 text-xs text-gray-400">Новые сдачи учеников появятся здесь автоматически</p>
        </div>
      ) : hiddenByFilter ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <Inbox size={26} className="mx-auto text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">Под фильтр ничего не подошло</p>
          <p className="mt-1 text-xs text-gray-400">В очереди {rows.length} работ — снимите ограничения, чтобы увидеть их</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(g => (
            <section key={g.dayKey}>
              <h2 className="mb-1 px-1 text-base font-bold text-gray-900">{g.label}</h2>
              <ul className="rounded-xl border border-gray-200 bg-white px-3">
                {g.rows.map(row => (
                  <QueueRowItem
                    key={row.attempt.id}
                    row={row}
                    files={filesOf(row.attempt.id)}
                    studentName={studentNames[row.attempt.student_id] ?? 'Ученик'}
                    viewers={viewersOf(row.attempt.id)}
                    showCourse={showCourseInRow}
                    selected={selected.has(row.attempt.id)}
                    onToggleSelect={() => {
                      const next = new Set(selected)
                      if (next.has(row.attempt.id)) {
                        next.delete(row.attempt.id)
                      } else {
                        next.add(row.attempt.id)
                      }
                      setSelected(next)
                    }}
                    ai={aiJobs[row.attempt.id]}
                    aiBusy={aiRunning.has(row.attempt.id)}
                    onRunAi={() => runChecks([row.attempt.id])}
                    onOpen={() => setReviewing({ row, locked: viewersOf(row.attempt.id).length > 0 })}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {reviewing && (
        <AttemptAnnotationOverlay
          attemptId={reviewing.row.attempt.id}
          files={filesOf(reviewing.row.attempt.id)}
          title={reviewing.row.homeworkTitle}
          subtitle={
            `${studentNames[reviewing.row.attempt.student_id] ?? 'Ученик'} · ${reviewing.row.topicTitle}`
            + (isSubmittedLate(reviewing.row) ? ' · сдано с опозданием' : '')
          }
          viewers={viewersOf(reviewing.row.attempt.id)}
          solutionTopicId={reviewing.row.topicId}
          locked={reviewing.locked}
          onForceEdit={() => setReviewing(r => (r ? { ...r, locked: false } : r))}
          // Решение принимает форма вердикта ниже — своя кнопка публикации в
          // тулбаре только путала: две зелёные кнопки читались как одно действие.
          hideToolbarPublish
          importRegionsRef={importRegionsRef}
          footer={({ publishAnnotations }) => (
            <ReviewActions
              attempt={reviewing.row.attempt}
              gradeScale={reviewing.row.gradeScale}
              hint="Рамки сохраняются сразу. Ученик увидит их, когда вы примете работу или вернёте на доработку — отдельно публиковать не нужно."
              above={
                <AiCheckPanel
                  job={ai.job}
                  findings={ai.findings}
                  running={ai.running}
                  error={ai.error}
                  onRun={ai.runCheck}
                  onApplyFrames={applyAiFrames}
                  // Новый объект на каждое нажатие: вставить один и тот же
                  // текст второй раз тоже должно получаться.
                  onUseText={text => setFillRequest({ comment: text })}
                />
              }
              fillRequest={fillRequest}
              onReview={async (attemptId, decision, comment, score) => {
                // Сначала пометки, потом вердикт: иначе ученик мог бы увидеть
                // «на доработку» без рамок, на которые ссылается комментарий.
                // Ошибку не глотаем — ReviewActions покажет её и оставит форму.
                const ok = await publishAnnotations(decision === 'accepted' ? 'checked' : 'revision')
                if (!ok) throw new Error('Не удалось опубликовать пометки — вердикт не сохранён')
                await reviewAttempt(attemptId, decision, comment, score)
                setReviewing(null)
                reloadAi()
              }}
            />
          )}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  )
}
