import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, Clock, Images, Loader2, Lock, PenLine, ListChecks } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { useMyTimedWindow, useServerNow } from '@/hooks/useTimedWork'
import { useReviewTasksOfAttempts } from '@/hooks/useHomeworkReviewTasks'
import { PREVIEW_NOOP_MESSAGE, usePreviewMode } from '@/store/staffModeStore'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { TopicMaterialItems } from './TopicMaterialItems'
import { AttemptFeedback, type OpenPageTarget } from './AttemptFeedback'
import { AttemptAnnotationOverlay } from './AttemptAnnotationOverlay'
import { CameraInput, PageGrid } from './TopicHomeworkStudent'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import { plural } from '@/lib/plural'
import {
  HOMEWORK_FILE_ACCEPT, TOPIC_HOMEWORK_BUCKET, latestReview, namePastedFile, splitHomeworkFiles,
  type RejectedHomeworkFile,
} from '@/lib/topicHomework'
import {
  TOPIC_KIND_LABEL, durationLabel, formatCountdown, formatMoscowDay, formatMoscowShort, formatMoscowTime,
  isTimerWarning, submittedLabel, timedPhase, type TimedPhase, type TopicKind,
} from '@/lib/timedWork'
import { cn } from '@/utils/cn'

/**
 * §240. Ученический экран проверочной / контрольной работы — пять состояний
 * макета: до начала (отсчёт), идёт (таймер), сдано, не сдал, проверено.
 *
 * Правила держит сервер: условие до открытия не приходит вовсе, фото и сдача
 * вне окна отвергаются, в момент закрытия черновик с фото сдаётся сам. Экран
 * только показывает то же самое по СЕРВЕРНОМУ времени (`useServerNow`) и не
 * рисует кнопок, которые заведомо кончатся отказом: вне окна кнопки сдачи нет.
 *
 * Одна попытка: после «Сдать работу» изменить нельзя, «Исправить и сдать
 * заново» в разборе нет.
 */
export function TopicTimedWorkStudent({
  topicId, kind, className, onOpenSection, onPhaseChange,
}: {
  topicId: string
  kind: TopicKind
  className?: string
  /** Открыть рубрику темы (решение, критерии, условие) на странице темы. */
  onOpenSection?: (section: 'solution' | 'criteria' | 'worksheet_homework') => void
  /** Состояние сменилось (например, окно открылось) — странице пора перечитать материалы. */
  onPhaseChange?: (phase: TimedPhase) => void
}) {
  const preview = usePreviewMode()
  const {
    homework, files, attempts, attemptFiles, reviews, loading, error, reload,
    startAttempt, uploadAttemptFiles, removeAttemptFile, reorderAttemptFiles, submitAttempt,
  } = useTopicHomework(topicId, { preview })
  const { window: win, offsetMs, reload: reloadWindow } = useMyTimedWindow(
    homework?.id ?? null,
    { opensAt: homework?.opens_at ?? null, closesAt: homework?.closes_at ?? null },
    !loading,
  )

  const coarse = useCoarsePointer()
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<{ name: string; percent: number }[]>([])
  const [rejected, setRejected] = useState<RejectedHomeworkFile[]>([])
  const [confirming, setConfirming] = useState(false)
  const [viewing, setViewing] = useState<({ attemptId: string } & Partial<OpenPageTarget>) | null>(null)
  const uploading = uploads.length > 0

  // Последняя попытка — одна-единственная у работы по времени.
  const attempt = useMemo(
    () => [...attempts].sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null,
    [attempts],
  )
  const draftFiles = attempt ? attemptFiles.filter(f => f.attempt_id === attempt.id) : []

  const reviewIds = useMemo(() => (attempt ? [attempt.id] : []), [attempt])
  const reviewTasks = useReviewTasksOfAttempts(reviewIds)

  // Таймер тикает, пока есть что отсчитывать.
  const ticking = !attempt || attempt.status === 'draft'
  const now = useServerNow(offsetMs, ticking)
  const phase = timedPhase({
    opensAt: win.opensAt,
    closesAt: win.closesAt,
    attemptStatus: attempt?.status ?? null,
    draftFiles: draftFiles.length,
    nowMs: now,
  })

  // Смена состояния по часам: окно открылось — условие теперь отдаётся,
  // перечитываем ДЗ (файлы задания) и зовём страницу (материалы). Окно
  // закрылось с фото в черновике — через минуту сервер сдаст его сам:
  // перечитываем, пока не увидим «сдано».
  const prevPhase = useRef<TimedPhase | null>(null)
  useEffect(() => {
    if (loading) return
    const before = prevPhase.current
    prevPhase.current = phase
    if (before === null || before === phase) return
    onPhaseChange?.(phase)
    if (before === 'before' && phase === 'live') { reload(); reloadWindow() }
  }, [phase, loading, onPhaseChange, reload, reloadWindow])

  useEffect(() => {
    if (phase !== 'sending') return
    const id = setInterval(() => reload(), 20_000)
    return () => clearInterval(id)
  }, [phase, reload])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  /** Черновик — тот, что есть, или новый: отдельной кнопки «Начать» у работы по времени нет. */
  const ensureDraft = useCallback(async (): Promise<string | null> => {
    if (attempt?.status === 'draft') return attempt.id
    if (attempt) return null
    const id = await startAttempt()
    return id || null
  }, [attempt, startAttempt])

  const uploadPicked = useCallback(async (incoming: File[], { fromPaste = false } = {}) => {
    if (incoming.length === 0) return
    const { accepted, rejected: bad } = splitHomeworkFiles(incoming)
    const picked = fromPaste ? accepted.map(namePastedFile) : accepted
    setRejected(bad)
    setLocalError(null)
    if (picked.length === 0) return
    setUploads(picked.map(f => ({ name: f.name, percent: 0 })))
    try {
      const id = await ensureDraft()
      if (!id) return
      await uploadAttemptFiles(id, picked, (index, percent) => {
        setUploads(prev => prev.map((u, i) => (i === index ? { ...u, percent } : u)))
      })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Не удалось загрузить фото')
    } finally {
      setUploads([])
    }
  }, [ensureDraft, uploadAttemptFiles])

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка работы…
      </div>
    )
  }
  if (!homework) {
    return (
      <p className={cn('rounded-2xl border border-dashed border-graphite-200 px-4 py-8 text-center text-sm text-graphite-500', className)}>
        Работа ещё не выдана.
      </p>
    )
  }

  const opensAt = win.opensAt
  const closesAt = win.closesAt
  const closeTime = formatMoscowTime(closesAt)
  const msToOpen = opensAt ? Date.parse(opensAt) - now : 0
  const msLeft = closesAt ? Date.parse(closesAt) - now : 0
  const warn = phase === 'live' && isTimerWarning(msLeft)
  const duration = durationLabel(opensAt, closesAt)
  const review = attempt ? latestReview(reviews, attempt.id) : null

  const conditionBlock = (
    <section data-testid="timed-condition" className="space-y-2">
      <h3 className="px-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-graphite-500">Условие</h3>
      {files.map(f => (
        <SignedFileLink
          key={f.id}
          bucket={TOPIC_HOMEWORK_BUCKET}
          url={f.storage_path}
          className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-graphite-200 hover:ring-primary-300"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-verdict-bad-tint text-[11px] font-extrabold text-verdict-bad-ink">PDF</span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[13.5px] font-bold text-graphite-900">{f.original_filename}</b>
            <small className="block text-xs text-graphite-500">открыть</small>
          </span>
        </SignedFileLink>
      ))}
      {/* Ключ — состояние: материалы перечитываются в момент открытия окна. */}
      <TopicMaterialItems key={phase} topicId={topicId} canManage={false} section="worksheet_homework" />
    </section>
  )

  const lockRow = (title: string, sub: string, testId: string) => (
    <div data-testid={testId} className="flex items-center gap-3 rounded-2xl border border-dashed border-graphite-300 bg-white px-3.5 py-3 text-[13.5px]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-verdict-none-tint text-graphite-500"><Lock size={16} /></span>
      <span className="min-w-0">
        <b className="block font-bold text-graphite-900">{title}</b>
        <small className="block text-xs text-graphite-500">{sub}</small>
      </span>
    </div>
  )

  return (
    <div data-testid="timed-work" data-phase={phase} className={cn('flex flex-col gap-3', className)}>
      {(error || localError) && (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      {/* ── 0. Время не назначено ── */}
      {phase === 'unscheduled' && (
        <div data-testid="timed-unscheduled" className="rounded-[20px] bg-white p-4 ring-1 ring-graphite-200">
          <p className="text-[15px] font-bold text-primary-900">Время работы ещё не назначено</p>
          <p className="mt-1 text-[13px] text-graphite-500">
            Учитель поставит дату и время — здесь появится отсчёт. Условие откроется в момент начала.
          </p>
        </div>
      )}

      {/* ── 1. До начала ── */}
      {phase === 'before' && (
        <>
          <div data-testid="timed-before" className="flex flex-col gap-2.5 rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-graphite-200">
            <div className="text-[12.5px] text-graphite-500">Откроется через</div>
            <div data-testid="timed-countdown" className="text-[34px] font-extrabold leading-none tabular-nums text-primary-900">{formatCountdown(msToOpen)}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-graphite-50 px-2.5 py-2 text-xs text-graphite-500">
                Открывается<b className="block text-[15px] font-bold tabular-nums text-graphite-900">{formatMoscowShort(opensAt)}</b>
              </div>
              <div className="rounded-xl bg-graphite-50 px-2.5 py-2 text-xs text-graphite-500">
                Закрывается<b className="block text-[15px] font-bold tabular-nums text-graphite-900">{closeTime}</b>
              </div>
            </div>
            <p className="text-[12.5px] text-graphite-500">
              {duration ? `${duration}. ` : ''}Условие появится ровно в {formatMoscowTime(opensAt)}. Приготовь листы и зарядку телефона.
              {win.personal && ' Время назначено лично тебе.'}
            </p>
          </div>
          {lockRow('Условие', `откроется ${formatMoscowShort(opensAt).replace(',', ' в')}`, 'timed-lock-condition')}
        </>
      )}

      {/* ── 2. Идёт ── */}
      {phase === 'live' && (
        <>
          <div
            data-testid="timed-timer"
            data-warn={warn ? 'true' : 'false'}
            role="timer"
            aria-live="off"
            className={cn(
              // top-[4.5rem]: шапка приложения — h-16 и sticky (DashboardLayout), таймер встаёт под ней.
              'sticky top-[4.5rem] z-20 flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-white shadow-md',
              warn ? 'bg-verdict-bad-ink' : 'bg-primary-900',
            )}
          >
            <Clock size={18} className="shrink-0 opacity-80" />
            <div className="text-[26px] font-extrabold leading-none tabular-nums">{formatCountdown(msLeft)}</div>
            <div className="min-w-0 text-xs leading-snug text-primary-100">
              осталось · закроется в {closeTime}
              <br />
              загруженное сдастся само
            </div>
          </div>

          {conditionBlock}

          <div data-testid="timed-photos" className="flex flex-col gap-2.5 rounded-[20px] bg-white p-3.5 shadow-sm ring-1 ring-graphite-200">
            <b className="text-sm font-bold text-graphite-900">
              Фото решения{draftFiles.length > 0 ? ` · ${draftFiles.length} стр.` : ''}
            </b>

            {rejected.length > 0 && (
              <div role="alert" className="rounded-xl bg-gold-50 px-3 py-2 text-[13px] text-gold-900">
                {Array.from(new Set(rejected.map(r => r.problem))).map(p => <p key={p}>{p}</p>)}
              </div>
            )}

            {draftFiles.length > 0 && attempt && (
              <PageGrid
                files={draftFiles}
                disabled={busy || uploading || preview}
                coarse={coarse}
                onReorder={ids => run(() => reorderAttemptFiles(attempt.id, ids))}
                onDelete={f => run(() => removeAttemptFile(f.id, f.storage_path))}
              />
            )}

            {uploading && (
              <ul className="space-y-1.5">
                {uploads.map((u, i) => (
                  <li key={`${u.name}-${i}`}>
                    <div className="flex items-center justify-between gap-2 text-xs text-graphite-500">
                      <span className="truncate">{u.name}</span>
                      <span className="shrink-0 tabular-nums">{u.percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-graphite-100">
                      <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${u.percent}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <label
                data-testid="timed-camera"
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-3 py-3 text-center',
                  uploading || preview ? 'cursor-not-allowed border-graphite-200 opacity-60' : 'cursor-pointer border-primary-300 bg-primary-50 hover:border-primary-400',
                )}
              >
                <Camera size={20} className="text-primary-600" />
                <span className="text-[13px] font-bold text-primary-700">+ Фото</span>
                <CameraInput testId="timed-camera-input" ariaLabel="Снять фото страницы" disabled={uploading || preview} onPick={picked => uploadPicked(picked)} />
              </label>
              <label
                data-testid="timed-gallery"
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 py-3 text-center',
                  uploading || preview ? 'cursor-not-allowed border-graphite-200 opacity-60' : 'cursor-pointer border-graphite-200 bg-white hover:border-primary-300',
                )}
              >
                <Images size={20} className="text-graphite-500" />
                <span className="text-[13px] font-bold text-graphite-700">Из галереи</span>
                <input
                  data-testid="timed-gallery-input"
                  type="file"
                  accept={HOMEWORK_FILE_ACCEPT}
                  multiple
                  disabled={uploading || preview}
                  aria-label="Выбрать фото работы"
                  className="hidden"
                  onChange={async e => {
                    const picked = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    await uploadPicked(picked)
                  }}
                />
              </label>
            </div>

            <p className="text-[12.5px] text-graphite-500">
              Каждая страница — отдельным фото. Можно добавлять и переставлять до {closeTime}.
            </p>

            {confirming ? (
              <div data-testid="timed-submit-confirm" className="flex flex-col gap-2 rounded-2xl bg-gold-50 p-3">
                <p className="text-[13px] font-semibold text-gold-900">
                  Сдать {plural(draftFiles.length, 'страницу', 'страницы', 'страниц')} ({draftFiles.length})? Изменить работу после сдачи будет нельзя.
                </p>
                <div className="flex gap-2">
                  <Button
                    data-testid="timed-submit-yes"
                    className="flex-1"
                    loading={busy}
                    onClick={() => run(async () => { await submitAttempt(attempt!.id); setConfirming(false) })}
                  >
                    Сдать
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>Отмена</Button>
                </div>
              </div>
            ) : (
              <Button
                data-testid="timed-submit"
                className="w-full"
                disabled={!attempt || attempt.status !== 'draft' || draftFiles.length === 0 || uploading || preview}
                title={preview ? PREVIEW_NOOP_MESSAGE : draftFiles.length === 0 ? 'Сначала загрузи фото' : undefined}
                onClick={() => setConfirming(true)}
              >
                Сдать работу
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── 3. Сдано (или сдаётся автоматически) ── */}
      {(phase === 'sent' || phase === 'sending') && (
        <>
          <div data-testid="timed-sent" className="flex flex-col gap-1.5 rounded-[18px] border-2 border-gold-300 bg-white p-3.5">
            <b className="text-[17px] font-extrabold text-graphite-900">
              {phase === 'sending'
                ? `Сдаётся автоматически в ${closeTime}`
                : attempt?.auto_submitted
                  ? `Сдано автоматически в ${formatMoscowTime(attempt.submitted_at)}`
                  : `Сдано в ${formatMoscowTime(attempt?.submitted_at)}`}
            </b>
            <span className="text-[13px] text-graphite-500">
              {draftFiles.length > 0 && `${draftFiles.length} фото. `}
              Изменить уже нельзя. Оценка и решение появятся после проверки.
            </span>
          </div>
          {conditionBlock}
          {lockRow('Решение, ответы и критерии', 'откроются после проверки учителем', 'timed-lock-solution')}
        </>
      )}

      {/* ── 4. Время вышло, не сдано ── */}
      {phase === 'missed' && (
        <>
          <div data-testid="timed-missed" className="flex flex-col gap-1.5 rounded-[18px] bg-verdict-bad-tint p-3.5 text-verdict-bad-ink">
            <b className="text-[17px] font-extrabold">Время вышло</b>
            <span className="text-[13px]">Работа не сдана: фото не было загружено до {closeTime}.</span>
          </div>
          <p className="px-0.5 text-[12.5px] text-graphite-500">
            Сдача закрылась {formatMoscowDay(closesAt)} в {closeTime}. Если была уважительная причина — напиши учителю: он может открыть работу заново.
          </p>
          {conditionBlock}
        </>
      )}

      {/* ── 5. Проверено ── */}
      {phase === 'done' && attempt && (
        <>
          <div data-testid="timed-done" className="flex flex-wrap items-center gap-2 rounded-[18px] bg-verdict-ok-tint px-3.5 py-2.5 text-verdict-ok-ink">
            <CheckCircle2 size={16} className="shrink-0" />
            <span className="text-[12px] font-extrabold uppercase tracking-wide">Проверено</span>
            <span className="text-[12.5px]">· {submittedLabel(attempt.submitted_at, attempt.auto_submitted)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              data-testid="timed-open-solution"
              onClick={() => onOpenSection?.('solution')}
              className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-graphite-200 hover:ring-primary-300"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-50 text-primary-600"><PenLine size={17} /></span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-bold text-graphite-900">Решение</b>
                <small className="block text-xs text-graphite-500">открылось после проверки</small>
              </span>
            </button>
            <button
              type="button"
              data-testid="timed-open-criteria"
              onClick={() => onOpenSection?.('criteria')}
              className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-graphite-200 hover:ring-primary-300"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-verdict-ok-tint text-verdict-ok-ink"><ListChecks size={17} /></span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-bold text-graphite-900">Ответы и критерии оценивания</b>
                <small className="block text-xs text-graphite-500">открылись после проверки</small>
              </span>
            </button>
          </div>
          <AttemptFeedback
            homework={{ title: homework.title, due_at: null, grade_scale: homework.grade_scale }}
            attempt={attempt}
            review={review}
            files={draftFiles}
            rows={reviewTasks.filter(t => t.attempt_id === attempt.id)}
            resubmit={null}
            onOpenPage={target => setViewing({ attemptId: attempt.id, ...target })}
          />
        </>
      )}

      {preview && phase === 'live' && (
        <p className="text-xs text-gold-800">{PREVIEW_NOOP_MESSAGE}: ученик здесь загружает фото и сдаёт работу.</p>
      )}

      {viewing && (
        <AttemptAnnotationOverlay
          attemptId={viewing.attemptId}
          files={attemptFiles.filter(f => f.attempt_id === viewing.attemptId)}
          title={`${TOPIC_KIND_LABEL[kind]}: ${homework.title}`}
          subtitle="Пометки учителя — нажмите на рамку, чтобы прочитать замечание"
          readOnly
          initialPage={viewing.page ?? null}
          initialRegionId={viewing.regionId ?? null}
          onClose={() => setViewing(null)}
        />
      )}

    </div>
  )
}
