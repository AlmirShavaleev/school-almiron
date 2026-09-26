import { useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { formatSentAt, type NotifySummary } from '@/lib/mockExamNotify'
import { sentLine } from '@/lib/mockExamV3'
import { mskTime, mskDay } from '@/lib/mockExamLesson'
import { liveCounts, liveCountsLine, liveHeadline, livePhase, liveRows, type LiveStudentRow, type MockExamLive } from '@/lib/mockExamLive'
import { notifyCheckedIds, statusLook, STAGES, type ExamStage, type ExamWindow, type WorkRow } from '@/lib/mockExamV3'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §228. Статус пробника: Черновик → Назначен → Идёт → Проверка → Результаты
 * отправлены. Пройденные шаги — галка в круге, текущий — синий круг с номером,
 * будущие — пустой круг: состояние видно формой, не только цветом.
 */
export function ExamStepper({ stage }: { stage: ExamStage }) {
  const at = STAGES.findIndex(s => s.key === stage)
  return (
    <ol className="flex flex-wrap items-center gap-y-1" aria-label="Статус пробника" data-testid="mock-stepper" data-stage={stage}>
      {STAGES.map((s, i) => {
        const done = i < at || (stage === 'sent' && i === at)
        const cur = i === at && stage !== 'sent'
        return (
          <li key={s.key} className="flex items-center" aria-current={i === at ? 'step' : undefined} data-done={done || undefined}>
            {i > 0 && <span className="mx-1.5 h-0.5 w-5 bg-graphite-200 sm:w-7" aria-hidden />}
            <span className={cn('flex items-center gap-2 py-1 text-sm font-semibold', cur ? 'text-graphite-900' : done ? 'text-graphite-500' : 'text-graphite-400')}>
              <span className={cn('grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-[11px]',
                done ? 'border-verdict-ok bg-verdict-ok text-white' : cur ? 'border-primary-600 bg-primary-600 text-white' : 'border-graphite-300 bg-white')} aria-hidden>
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Шапка монитора §224 на «Работах» во время окна: вывод, полоса, счётчики. Список — сами «Работы». */
export function LiveHead({ win, live, now, fallback }: { win: ExamWindow; live: MockExamLive | null; now: number; fallback: LiveStudentRow[] }) {
  const phase = livePhase(win, now)
  const rows = liveRows(live ? live.students : fallback, phase)
  const counts = liveCounts(rows)
  const s = new Date(win.starts_at ?? 0).getTime()
  const e = new Date(win.ends_at ?? 0).getTime()
  const elapsed = phase === 'running' ? Math.min(1, Math.max(0, (now - s) / Math.max(1, e - s))) : phase === 'upcoming' ? 0 : 1
  return (
    <div className="space-y-2 border-b border-graphite-200 pb-3 pt-4" data-testid="mock-works-live" data-phase={phase}>
      <p className={cn('flex items-start gap-2 text-lg font-semibold leading-snug sm:text-xl', phase === 'running' ? 'text-primary-700' : phase === 'photos' ? 'text-verdict-part-ink' : 'text-graphite-900')} data-testid="mock-live-headline">
        {phase === 'running' && <span className="relative mt-2.5 flex h-2.5 w-2.5 shrink-0" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary-600" /></span>}
        {liveHeadline(win, now)}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-graphite-100" aria-hidden>
        <div className={cn('h-full rounded-full', phase === 'running' ? 'bg-gradient-to-r from-action-from to-action-to' : phase === 'photos' ? 'bg-gold-300' : 'bg-graphite-300')} style={{ width: `${Math.round(elapsed * 100)}%` }} />
      </div>
      <p className="text-[15px] text-graphite-900" data-testid="mock-live-counts">
        {liveCountsLine(counts, phase)}
        {!live && <span className="text-graphite-500"> · кто сейчас на сайте — появится после обновления базы</span>}
      </p>
    </div>
  )
}

const PILL: Record<string, string> = {
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  bad: 'bg-verdict-bad-tint text-verdict-bad-ink',
  part: 'bg-verdict-part-tint text-verdict-part-ink',
  unk: 'bg-verdict-unk-tint text-verdict-unk-ink',
  none: 'bg-verdict-none-tint text-verdict-none-ink',
}

/** Тон метки монитора → форма `VerdictMark`: пишет — «верно», был и ушёл — «частично», не заходил — «неверно». */
const LIVE_MARK: Record<string, 'ok' | 'part' | 'bad' | 'none' | 'unk'> = { live: 'ok', warn: 'part', problem: 'bad', idle: 'none', ok: 'unk' }

/**
 * «Работы»: строка на ученика; ВСЯ строка открывает проверку (владелец:
 * «работа ученика не кликабельна»). Справа — «Проверить →» / «Дооценить →» или
 * «Уведомить» одному, когда все номера оценены. Внизу — «Уведомить всех
 * проверенных · N» с подтверждением внутри страницы, без `confirm()`.
 */
export function WorksTable({ examId, rows, liveById, onNotify, confirmOpen, setConfirmOpen }: {
  examId: string
  rows: WorkRow[]
  liveById?: Record<string, { label: string; tone: string }>
  onNotify: (ids: string[]) => Promise<{ error: string | null; summary: NotifySummary | null }>
  confirmOpen: boolean
  setConfirmOpen: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const [sending, setSending] = useState<string | 'all' | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const pending = notifyCheckedIds(rows)
  const alreadySent = rows.filter(r => r.status === 'checked' && r.notify.kind === 'sent').length
  const open = (id: string) => navigate(`/mock-exams/${examId}/review/${id}`)

  async function send(ids: string[], who: 'all' | string) {
    setSending(who)
    setStatus(null)
    const r = await onNotify(ids)
    setSending(null)
    setConfirmOpen(false)
    if (r.error) { setStatus({ kind: 'error', text: `Не отправлено: ${r.error}` }); return }
    const name = who === 'all' ? null : rows.find(x => x.id === who)?.name ?? null
    setStatus({ kind: 'ok', text: sentLine(r.summary, name) })
  }

  return (
    <div data-testid="mock-works">
      {confirmOpen && (
        <div className="my-3 rounded-card bg-primary-50 px-4 py-3" role="alertdialog" aria-labelledby="mock-works-confirm-title" data-testid="mock-works-confirm">
          <p id="mock-works-confirm-title" className="text-[15px] font-semibold text-graphite-900">
            Отправить {pending.length} {plural(pending.length, 'ученику', 'ученикам', 'ученикам')}?
          </p>
          <p className="mt-1 text-sm text-graphite-600">
            Каждый получит только свой результат — на сайт и в Telegram, если подключён.
            {alreadySent > 0 && ` Кому итог уже отправлен (${alreadySent}), повторно не уйдёт.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send(pending, 'all')} loading={sending === 'all'} data-testid="mock-works-notify-send"><Send size={14} aria-hidden />Отправить</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending != null}>Отмена</Button>
          </div>
        </div>
      )}
      {status && (
        <p role="status" data-testid="mock-works-status"
          className={cn('my-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm', status.kind === 'error' ? 'bg-verdict-bad-tint text-verdict-bad-ink' : 'bg-verdict-ok-tint text-verdict-ok-ink')}>
          {status.kind === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> : <Check size={16} className="mt-0.5 shrink-0" aria-hidden />}{status.text}
        </p>
      )}
      {/* relative — иначе sr-only-подпись столбца (position: absolute) выходит из прокрутки и раздвигает страницу на телефоне. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm" data-testid="mock-works-table">
          <thead>
            <tr className="whitespace-nowrap text-xs font-semibold uppercase tracking-[.04em] text-graphite-500">
              <th className="border-b border-graphite-200 px-2.5 py-3">Ученик</th>
              <th className="border-b border-graphite-200 px-2.5 py-3">Работа</th>
              <th className="border-b border-graphite-200 px-2.5 py-3 text-right">Часть 1</th>
              <th className="border-b border-graphite-200 px-2.5 py-3 text-right">Часть 2</th>
              <th className="border-b border-graphite-200 px-2.5 py-3 text-right">Тестовый</th>
              <th className="border-b border-graphite-200 px-2.5 py-3"><span className="sr-only">Действие</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const look = statusLook(r)
              const live = liveById?.[r.id]
              const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(r.id) }
              return (
                <tr key={r.id} onClick={() => open(r.id)} onKeyDown={onKey} tabIndex={-1}
                  className="cursor-pointer hover:bg-[#f6f9ff]" data-testid="mock-works-row" data-status={r.status} data-student={r.id}>
                  <td className="border-b border-graphite-200 px-2.5 py-3">
                    <Link to={`/mock-exams/${examId}/review/${r.id}`} onClick={e => e.stopPropagation()} className="font-bold text-graphite-900 hover:text-primary-700" data-testid="mock-works-open">{r.name}</Link>
                  </td>
                  <td className="border-b border-graphite-200 px-2.5 py-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {(() => {
                        // Во время окна у «пишет»/«не заходил» — метка монитора §224 («Пишет · онлайн», «Был в 12:41»).
                        const useLive = !!live && (r.status === 'writing' || r.status === 'not_opened')
                        const mark = useLive ? LIVE_MARK[live!.tone] ?? look.mark : look.mark
                        return (
                          <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-[3px] pl-1 pr-2.5 text-xs font-semibold', PILL[mark])} data-testid="mock-works-status-pill">
                            <VerdictMark state={mark} size={14} label={null} />{useLive ? live!.label : look.label}
                          </span>
                        )
                      })()}
                      <span className="text-[13px] text-graphite-500 sm:text-xs">{metaLine(r, look.note)}</span>
                    </span>
                  </td>
                  <td className={cn('border-b border-graphite-200 px-2.5 py-3 text-right font-semibold', !r.p1 && 'font-normal text-graphite-400')}>{r.p1 ? `${r.p1.got} / ${r.p1.of}` : '—'}</td>
                  <td className={cn('border-b border-graphite-200 px-2.5 py-3 text-right font-semibold', !r.p2 && 'font-normal text-graphite-400')}>{r.p2 ? `${r.p2.got} / ${r.p2.of}` : '—'}</td>
                  <td className="border-b border-graphite-200 px-2.5 py-3 text-right">{r.status === 'checked' || r.status === 'partial' ? <b className="text-graphite-900">{r.test ?? '—'}</b> : <span className="text-graphite-400">—</span>}</td>
                  <td className="border-b border-graphite-200 px-2.5 py-3 text-right" onClick={e => { if (r.canNotifyOne || r.notify.kind === 'sent') e.stopPropagation() }}>
                    <RowAction r={r} busy={sending === r.id || sending === 'all'} disabled={sending != null} onNotify={() => send([r.id], r.id)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <span className="text-[13px] text-graphite-500">Строка открывает проверку работы. «Уведомить» — когда все номера оценены.</span>
        <Button variant="secondary" onClick={() => { setConfirmOpen(true); setStatus(null) }} disabled={pending.length === 0 || sending != null}
          title={pending.length === 0 ? 'Некого: у проверенных результат уже отправлен или проверенных нет' : undefined} data-testid="mock-works-notify-all">
          Уведомить всех проверенных · {pending.length}
        </Button>
      </div>
    </div>
  )
}

function metaLine(r: WorkRow, note?: string): string {
  const parts: string[] = []
  if (note) parts.push(note)
  if (r.submittedAt) parts.push(`сдал${mskDay(r.submittedAt) !== mskDay(new Date().toISOString()) ? ` ${mskDay(r.submittedAt)}` : ''} ${mskTime(r.submittedAt)}`)
  else if (r.hasWork && (r.status === 'waiting' || r.status === 'partial' || r.status === 'checked')) parts.push('время вышло, не нажал «Сдать»')
  if (r.photos > 0) parts.push(`${r.photos} фото`)
  if (r.notify.kind === 'sent' || r.notify.kind === 'changed') parts.push(`отправлено ${formatSentAt(r.notify.at)}`)
  return parts.join(' · ')
}

function RowAction({ r, busy, disabled, onNotify }: { r: WorkRow; busy: boolean; disabled: boolean; onNotify: () => void }) {
  if (r.status === 'waiting') return <span className="whitespace-nowrap font-semibold text-primary-600" data-testid="mock-works-action">Проверить →</span>
  if (r.status === 'partial') return <span className="whitespace-nowrap font-semibold text-primary-600" data-testid="mock-works-action">Дооценить →</span>
  if (r.status !== 'checked') return null
  if (r.notify.kind === 'sent') {
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-graphite-500" data-testid="mock-works-sent"><Check size={12} className="text-verdict-ok" aria-hidden />отправлено</span>
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button size="sm" variant="secondary" onClick={onNotify} loading={busy} disabled={disabled || !r.canNotifyOne}
        title={!r.profileId ? 'У ученика нет учётной записи' : undefined} data-testid="mock-works-notify">Уведомить</Button>
      {r.notify.kind === 'changed' && <span className="text-[13px] leading-tight text-verdict-part-ink sm:text-[11px]" data-testid="mock-works-changed">итог изменён после отправки</span>}
    </span>
  )
}
