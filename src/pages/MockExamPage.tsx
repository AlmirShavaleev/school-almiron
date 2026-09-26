import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { MockExamForm } from '@/components/mockExams/MockExamForm'
import { ExamStepper, LiveHead, WorksTable } from '@/components/mockExams/MockExamWorks'
import { MockExamGridPage } from '@/pages/MockExamGridPage'
import { useMockExamWorks } from '@/hooks/useMockExamWorks'
import { useMockExamLive } from '@/hooks/useMockExamLive'
import { mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { livePhase, liveRows } from '@/lib/mockExamLive'
import {
  defaultTab, examStage, nextToReview, notifyCheckedIds, shortName, workRows, worksSummary, type ExamTab,
} from '@/lib/mockExamV3'
import { cn } from '@/utils/cn'

/**
 * §228. Страница одного пробника (экран 2 макета `МАКЕТ-ПРОБНИК-V3.html`):
 * крошки, заголовок «Название · дата, время», статус-степпер, вывод одной
 * строкой и одна главная кнопка («Проверить следующую · Имя»); ниже вкладки
 * «Работы» (по умолчанию после начала), «Таблица баллов» (таблица §218/§227
 * без изменений логики) и «Настройка» (форма «Новый пробник» для этого
 * пробника). Вкладка — в адресе (`?tab=`), чтобы ссылка вела прямо в неё.
 *
 * Время — по часам базы (`server_now` монитора §224), как у ученика.
 */
export function MockExamPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const works = useMockExamWorks(id)
  const { exam, students, loading, error, reload } = works
  const win = exam?.window ?? null
  // Монитор §224: пока окно не закрылось + догрузка фото — опрос раз в 20 с;
  // вместе с ним перечитываем работы (новые бланки, сдачи, фото).
  const { live, offset } = useMockExamLive(exam?.id, win, reload)
  const now = useClock(offset)
  const [confirmAll, setConfirmAll] = useState(false)

  const rows = useMemo(() => (exam?.template ? workRows(students.map(s => ({
    ...s, live: live?.students.find(l => l.student_id === s.id) ?? null,
  })), exam.template, win, now) : []), [exam, students, live, win, now])
  const stage = examStage(win, rows, now)
  const next = nextToReview(rows, null)
  const pendingNotify = notifyCheckedIds(rows).length
  const tabParam = params.get('tab')
  const tab: ExamTab = tabParam === 'works' || tabParam === 'table' || tabParam === 'setup' ? tabParam : defaultTab(stage, !!win)
  const pickTab = (t: ExamTab) => { const nx = new URLSearchParams(params); nx.set('tab', t); setParams(nx, { replace: true }); setConfirmAll(false) }

  const created = (location.state as { created?: { id: string; groupName: string }[]; problems?: string[]; warning?: string | null; draft?: boolean } | null) ?? null

  if (loading) return <div className="flex h-64 items-center justify-center gap-2 text-graphite-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
  if (error || !exam) {
    return (
      <div className="space-y-3">
        <Link to="/mock-exams" className="inline-flex items-center gap-1 text-[13px] text-graphite-500 hover:text-primary-700"><ArrowLeft size={14} aria-hidden />Пробники</Link>
        <p className="flex items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error || 'Пробник не найден'}</p>
      </div>
    )
  }

  const phase = win ? livePhase(win, now) : null
  const liveLabels = phase === 'running' && live
    ? Object.fromEntries(liveRows(live.students, phase).map(r => [r.student_id, { label: r.label, tone: r.tone }]))
    : undefined
  const summary = worksSummary(stage, rows, win, exam.groupName)
  // Главная кнопка — у проверки; пока пробник идёт, главное — монитор, а не «следующая».
  const primary = next && (stage === 'checking' || stage === 'sent')
    ? { label: `Проверить следующую · ${shortName(next.name)}`, onClick: () => navigate(`/mock-exams/${exam.id}/review/${next.id}`), testid: 'mock-page-next' }
    : pendingNotify > 0 && stage === 'checking'
      ? { label: `Уведомить всех проверенных · ${pendingNotify}`, onClick: () => { pickTab('works'); setConfirmAll(true) }, testid: 'mock-page-notify-all' }
      : null

  return (
    <div className="space-y-4" data-testid="mock-exam-page" data-stage={stage}>
      <div className="text-[13px] text-graphite-500">
        <Link to="/mock-exams" className="inline-flex items-center gap-1 hover:text-primary-700 hover:underline"><ArrowLeft size={13} aria-hidden />Пробники</Link>
        {exam.groupName && <> · {exam.groupName}</>}{exam.template && <> · {exam.template.title}</>}
      </div>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 lg:flex-nowrap">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold leading-tight text-graphite-900 [text-wrap:balance] sm:text-[26px]" data-testid="mock-page-title">
            {exam.title} · {win ? `${mskDayLong(win.starts_at)}, ${mskTime(win.starts_at)}–${mskTime(win.ends_at)}` : mskDayLong(exam.date)}
          </h1>
          <ExamStepper stage={stage} />
        </div>
        {primary && <Button onClick={primary.onClick} className="shrink-0" data-testid={primary.testid}>{primary.label}</Button>}
      </header>
      <p className="max-w-[860px] text-base text-graphite-900 sm:text-[17px]" data-testid="mock-page-summary">{summary}</p>

      {created?.created && created.created.length > 0 && (
        <div className="rounded-lg bg-verdict-ok-tint px-3 py-2 text-sm text-verdict-ok-ink" role="status" data-testid="mock-page-created">
          {created.draft ? 'Сохранено черновиком — ученики пробник не видят.' : created.created.length > 1 ? `Назначено для ${created.created.length} групп:` : 'Пробник назначен.'}
          {created.created.length > 1 && (
            <> {created.created.map((c, i) => (
              <span key={c.id}>{i > 0 && ', '}{c.id === exam.id ? <b>{c.groupName} (эта страница)</b> : <Link to={`/mock-exams/${c.id}`} className="font-semibold underline">{c.groupName}</Link>}</span>
            ))}.</>
          )}
          {created.warning && <span className="mt-1 block text-verdict-part-ink">{created.warning}</span>}
          {created.problems?.map(p => <span key={p} className="mt-1 block text-verdict-bad-ink">{p}</span>)}
        </div>
      )}

      <div className="rounded-card bg-white px-3 pb-2 shadow-card sm:px-5">
        <div className="flex gap-1 overflow-x-auto border-b border-graphite-200" role="tablist" aria-label="Разделы пробника">
          <TabButton on={tab === 'works'} onClick={() => pickTab('works')} testid="mock-tab-works">Работы · {rows.length}</TabButton>
          <TabButton on={tab === 'table'} onClick={() => pickTab('table')} testid="mock-tab-table">Таблица баллов</TabButton>
          <TabButton on={tab === 'setup'} onClick={() => pickTab('setup')} testid="mock-tab-setup">Настройка</TabButton>
        </div>
        <div role="tabpanel" className="min-w-0">
          {tab === 'works' && (
            !exam.group_id || !exam.template ? (
              <p className="py-4 text-sm text-graphite-600" data-testid="mock-works-empty">
                {!exam.group_id ? 'У пробника нет группы — работ нет. Группу выбирают во вкладке «Настройка».' : 'У пробника нет шаблона — это пробник старого вида, работ по номерам у него нет.'}
              </p>
            ) : (
              <>
                {win && (phase === 'running' || phase === 'photos') && (
                  <LiveHead win={win} live={live} now={now} fallback={students.map(s => ({
                    student_id: s.id, name: s.name, has_sheet: !!s.sheet, opened_at: null, last_seen_at: null, online: false,
                    answered: null, submitted_at: s.sheet?.submitted_at ?? null, photos: s.photos,
                  }))} />
                )}
                <WorksTable examId={exam.id} rows={rows} liveById={liveLabels} onNotify={async ids => { const r = await works.notify(ids); if (!r.error) reload(); return r }}
                  confirmOpen={confirmAll} setConfirmOpen={setConfirmAll} />
              </>
            )
          )}
          {tab === 'table' && <div className="pt-4"><MockExamGridPage embedded onChanged={reload} /></div>}
          {tab === 'setup' && <div className="py-4"><MockExamForm mode={{ kind: 'edit', examId: exam.id, onSaved: reload }} /></div>}
        </div>
      </div>
    </div>
  )
}

function TabButton({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: React.ReactNode; testid: string }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} data-testid={testid}
      className={cn('-mb-px min-h-11 whitespace-nowrap border-b-[2.5px] px-3.5 py-2.5 text-sm font-semibold', on ? 'border-primary-600 text-graphite-900' : 'border-transparent text-graphite-500 hover:text-graphite-900')}>
      {children}
    </button>
  )
}

/** «Сейчас» по часам базы, шаг 15 с — статусу и таймлайну хватает. */
function useClock(offset: number): number {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  return tick + offset
}
