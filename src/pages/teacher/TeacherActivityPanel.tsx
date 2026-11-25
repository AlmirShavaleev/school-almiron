import { Activity, Radio, RefreshCw } from 'lucide-react'
import { LiveCard } from '@/components/admin/LiveCard'
import { Button } from '@/components/ui/Button'
import { useTeacherActivity } from '@/hooks/useTeacherActivity'
import { mskTime } from '@/lib/mockExamLesson'

function today(points: { value: number }[]): number {
  return points.at(-1)?.value ?? 0
}

export function TeacherActivityPanel({ courseIds }: { courseIds: string[] | null }) {
  const { data, loading, failed, reload } = useTeacherActivity(courseIds)
  const activeShare = data?.enrolled ? Math.round(100 * data.visitedWeek / data.enrolled) : null

  return (
    <section className="space-y-3" aria-labelledby="teacher-activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="teacher-activity-heading" className="flex items-center gap-2 text-lg font-bold text-graphite-950">
            <Activity size={20} className="text-primary-700" aria-hidden /> Активность учеников
          </h2>
          <p className="mt-1 text-sm text-graphite-600">Последние 7 дней и предыдущие 7 дней · по Москве</p>
        </div>
        {courseIds?.length !== 0 && (
          <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
            <RefreshCw size={14} aria-hidden /> Обновить
          </Button>
        )}
      </div>

      {loading && <p role="status" className="platform-surface rounded-card p-4 text-sm text-graphite-600">Загружаем активность…</p>}
      {failed && <p role="alert" className="platform-surface rounded-card p-4 text-sm text-verdict-bad-ink">Не удалось загрузить активность учеников.</p>}
      {courseIds?.length === 0 && <p className="platform-surface rounded-card p-4 text-sm text-graphite-600">Активных курсов пока нет.</p>}

      {data && (
        <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <LiveCard
              title="Заходы на платформу" points={data.visits} kind="flow" tone="more-is-good"
              statusText={`Сегодня ${today(data.visits)} · один заход на ученика в день`}
              color="#315af4" animate={false} testId="teacher-card-visits"
            />
            <LiveCard
              title="Сдачи домашних работ" points={data.submissions} kind="flow" tone="more-is-good"
              statusText={`Сегодня ${today(data.submissions)}`}
              color="#f28c28" animate={false} testId="teacher-card-submissions"
            />
            <LiveCard
              title="Пройденные темы" points={data.completed} kind="flow" tone="more-is-good"
              statusText={`Сегодня ${today(data.completed)} · выполнены условия темы`}
              color="#315af4" animate={false} testId="teacher-card-completed"
            />
          </div>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="platform-surface rounded-2xl p-4">
              <dt className="flex items-center gap-1.5 text-sm text-graphite-700"><Radio size={15} className="text-verdict-ok-ink" aria-hidden /> Сейчас на платформе</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-graphite-950">{data.online}</dd>
              <dd className="mt-1 text-xs text-graphite-600">Активны за 30 минут к {mskTime(data.asOf)} МСК</dd>
            </div>
            <div className="platform-surface rounded-2xl p-4">
              <dt className="text-sm text-graphite-700">Заходили за 7 дней</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-graphite-950">{data.visitedWeek} из {data.enrolled}</dd>
              {activeShare != null && <dd className="mt-1 text-xs text-graphite-600">{activeShare} % учеников</dd>}
            </div>
            <div className="platform-surface rounded-2xl p-4">
              <dt className="text-sm text-graphite-700">Дней с заходом за неделю</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-graphite-950">{data.visitDaysPerVisitor.toLocaleString('ru-RU')}</dd>
              <dd className="mt-1 text-xs text-graphite-600">В среднем на ученика, который заходил</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}
