import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { plural } from '@/lib/plural'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { TaskAnswerCheck } from '@/components/catalog/TaskAnswerCheck'
import type { CheckOutcome } from '@/hooks/useCatalogPractice'
import { ZONE_LABEL, type DailyTask } from '@/lib/catalogRewards'

/**
 * §256. «Задача дня» — над прогнозом, золотая рамка. Одна задача каталога по
 * самому слабому номеру части 1 (выбирает и фиксирует на день база —
 * `student_daily_task`), ответ вводится прямо здесь (`catalog_check_answer`).
 * +N — если решена верно в тот же день без открытого ответа.
 *
 * «серия 5 → 6 дней» — только пока сегодня ещё ничего не решено: серия теперь
 * растёт от решения (§256), и задача дня — самый короткий путь продлить её.
 */
export function DailyTaskCard({ daily, streak, solvedToday, onCheck, className }: {
  daily: DailyTask
  streak: number | null
  solvedToday: boolean
  onCheck: (answer: string) => Promise<CheckOutcome>
  className?: string
}) {
  const task = daily.task!
  const isMath = task.subject === 'Математика' && (task.examType === 'ЕГЭ' || task.examType === 'ОГЭ')
  const html = resolveTaskHtml(task.statementHtml, task.assets)
  const subjectSlug = daily.subject === 'physics' ? 'physics' : 'math'
  const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`

  return (
    <section
      aria-labelledby="home-daily-h"
      data-testid="daily-task-card"
      data-done={daily.done || undefined}
      className={cn('platform-surface flex flex-col gap-3 rounded-card border-2 border-gold-400 p-4 sm:p-5', className)}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 id="home-daily-h" className="text-[15px] font-extrabold text-graphite-950">Задача дня</h2>
        <span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-extrabold text-gold-800">+{daily.bonus} баллов школы</span>
        {streak != null && !solvedToday && !daily.done && (
          <span data-testid="daily-streak-chip" className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-extrabold text-primary-700">
            {streak > 0 ? `серия ${streak} → ${days(streak + 1)}` : 'начните серию'}
          </span>
        )}
      </div>
      <p className="text-sm text-graphite-500">
        Подобрана по вашему слабому номеру — №{daily.n}{daily.title ? ` «${daily.title}»` : ''} · {ZONE_LABEL[daily.zone]}
      </p>
      <div className="min-w-0 text-[15px] text-graphite-900">
        <TaskContentRenderer html={html} className={isMath ? 'scale-figures-math-exam' : ''} />
      </div>
      <TaskAnswerCheck
        taskId={task.id}
        compact
        inputLabel="Ответ"
        showHint={false}
        state={{
          taskId: task.id, checkable: true, attempts: daily.attempts, lastVerdict: null,
          solved: daily.solved, counted: daily.done, revealed: daily.revealed,
        }}
        solvedText={daily.done ? `Задача дня решена! +${daily.bonus} баллов школы` : 'Решено — но не сегодня или с открытым ответом, бонус дня не начислен'}
        onCheck={onCheck}
      />
      {daily.sectionId && (
        <Link
          to={`/catalog/${daily.sectionId}?subject=${subjectSlug}&exam=ege`}
          className="self-start text-sm font-bold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          Ещё задачи №{daily.n} в каталоге →
        </Link>
      )}
    </section>
  )
}
