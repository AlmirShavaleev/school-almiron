import { ArrowRight, ChevronRight, GraduationCap, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useTeacherHome } from '@/hooks/useTeacherHome'
import { useMyLiveTimedWorks } from '@/hooks/useMyLiveTimedWorks'
import { useServerNow } from '@/hooks/useServerNow'
import { bannerDate, type TeacherHomeData } from '@/lib/teacherHome'
import { liveBriefNote, type LiveWorkBrief } from '@/lib/liveWork'
import { liveWorkPath } from '@/lib/courseAssessments'
import { mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { TOPIC_KIND_LABEL } from '@/lib/timedWork'
import { TeacherActivityPanel } from '@/pages/teacher/TeacherActivityPanel'

const ROW_LINK = 'rounded-lg transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600'

export function TeacherDashboard() {
  const { home, today, loading, error, reload, courseIds } = useTeacherHome()
  const live = useMyLiveTimedWorks(courseIds?.length !== 0)
  const liveNow = useServerNow(live.serverNow, 30_000)
  const liveWorks = courseIds ? live.works.filter(work => work.courseId && courseIds.includes(work.courseId)) : live.works

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 pb-5 sm:space-y-6" data-testid="teacher-home">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {today && <p className="mb-1 text-sm text-graphite-600">{bannerDate(today)}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-graphite-950 sm:text-[30px]">Кабинет учителя</h1>
        </div>
        <Link
          to="/students"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary-200 bg-white px-4 text-sm font-semibold text-primary-700 hover:border-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 sm:min-h-10"
        >
          <Users size={16} aria-hidden /> Ученики <ArrowRight size={15} aria-hidden />
        </Link>
      </header>

      {loading && <Card><p role="status" className="text-sm text-graphite-600">Загружаем сводку…</p></Card>}
      {error && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-verdict-bad-ink">{error}</p>
          <Button size="sm" variant="secondary" onClick={reload}>Повторить</Button>
        </Card>
      )}

      {!loading && <TeacherActivityPanel courseIds={courseIds} />}
      {home && <StudentOverview home={home} />}
      {liveWorks.length > 0 && <LiveNowBlock works={liveWorks} now={liveNow} />}
      {home && home.upcoming.length > 0 && <UpcomingExamsBlock exams={home.upcoming} />}
    </div>
  )
}

function StudentOverview({ home }: { home: TeacherHomeData }) {
  return (
    <Card>
      <section aria-labelledby="teacher-overview-title">
        <div className="flex items-center gap-2">
          <GraduationCap size={21} className="text-primary-700" aria-hidden />
          <h2 id="teacher-overview-title" className="text-lg font-bold text-graphite-950">Сводка по ученикам</h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <Metric label="Ученики в активных группах" value={home.students} main />
          <Metric label="Активные группы" value={home.groups.length} />
          <Metric label="Зачислены в группы" value={home.enrolled} recent />
          <Metric label="Получили результат пробника" value={home.withResult} recent />
        </dl>
      </section>

      <section aria-labelledby="teacher-groups-title" className="mt-6">
        <h2 id="teacher-groups-title" className="text-base font-bold text-graphite-950">По группам</h2>
        {home.groups.length === 0 ? (
          <p className="mt-2 text-sm text-graphite-600">Активных учебных групп пока нет.</p>
        ) : (
          <ul className="mt-2 divide-y divide-graphite-100 border-y border-graphite-100">
            {home.groups.map(group => (
              <li key={group.id}>
                <Link to={`/groups/${group.id}`} className={`${ROW_LINK} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)_auto] sm:px-3`}>
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-bold text-graphite-950 sm:text-[15px]">{group.name}</h3>
                    {group.courseTitle && group.courseTitle !== group.name && (
                      <p className="mt-0.5 break-words text-[13px] text-graphite-600">{group.courseTitle}</p>
                    )}
                  </div>
                  <dl className="col-span-2 grid grid-cols-3 gap-x-2 sm:col-span-1">
                    <GroupMetric label="Ученики" value={group.students} />
                    <GroupMetric label="Зачислены" value={group.enrolled} recent />
                    <GroupMetric label="Итог пробника" value={group.withResult} recent />
                  </dl>
                  <ChevronRight size={17} className="col-start-2 row-start-1 text-graphite-400 sm:col-start-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  )
}

function Metric({ label, value, main, recent }: { label: string; value: number; main?: boolean; recent?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-xl px-3 py-3 sm:px-4 ${main ? 'bg-primary-50' : 'bg-graphite-50'}`}>
      <dt className="text-[13px] leading-snug text-graphite-700">{label}{recent && <span className="block text-graphite-600">за 30 дней</span>}</dt>
      <dd className={`order-first text-2xl font-bold leading-tight tabular-nums sm:text-3xl ${main ? 'text-primary-700' : 'text-graphite-950'}`}>{value}</dd>
    </div>
  )
}

function GroupMetric({ label, value, recent }: { label: string; value: number; recent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[12px] leading-snug text-graphite-600">
      <dt>{label}{recent && <span className="block text-graphite-500">за 30 дней</span>}</dt>
      <dd className="order-first text-sm font-bold tabular-nums text-graphite-900">{value}</dd>
    </div>
  )
}

/** Идущие сейчас проверочные и контрольные со ссылкой в монитор. */
function LiveNowBlock({ works, now }: { works: LiveWorkBrief[]; now: number }) {
  return (
    <section data-testid="home-live" className="flex flex-col rounded-2xl bg-white px-4 pb-1 pt-3 ring-1 ring-primary-200 sm:px-5">
      <h2 className="pb-2 text-[17px] font-semibold text-graphite-900">Идёт сейчас</h2>
      {works.map(work => (
        <div key={work.homeworkId} data-testid="home-live-row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-graphite-200 py-[11px]">
          <div className="min-w-0">
            <p className="break-words text-[15px] font-medium text-graphite-900">{work.title}</p>
            <p className="text-[13px] text-graphite-600">
              {TOPIC_KIND_LABEL[work.kind]}{work.groupName ? ` · ${work.groupName}` : ''} · {liveBriefNote(work, now)}
            </p>
          </div>
          <Link
            to={liveWorkPath(work.homeworkId)}
            data-testid="home-live-watch"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary-50 px-4 text-[13px] font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:min-h-9"
          >
            Следить
          </Link>
        </div>
      ))}
    </section>
  )
}

function UpcomingExamsBlock({ exams }: { exams: TeacherHomeData['upcoming'] }) {
  return (
    <Card>
      <section aria-labelledby="teacher-upcoming-title">
        <h2 id="teacher-upcoming-title" className="text-lg font-bold text-graphite-950">Ближайшие пробники</h2>
        <ul className="mt-2 divide-y divide-graphite-100 border-y border-graphite-100">
          {exams.map(exam => (
            <li key={exam.id}>
              <Link to={`/mock-exams/${exam.id}`} className={`${ROW_LINK} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-3 sm:px-3`}>
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-graphite-950">{exam.title}</h3>
                  <p className="mt-0.5 text-[13px] text-graphite-600">
                    <time dateTime={exam.startsAt}>{mskDayLong(exam.startsAt)}, {mskTime(exam.startsAt)} МСК</time> · {exam.groupName}
                  </p>
                </div>
                <ChevronRight size={17} className="text-graphite-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  )
}
