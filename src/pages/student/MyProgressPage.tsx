import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Target, Loader2, Users, BookOpen, ChevronRight, ClipboardList, BarChart3,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { useMyProgress } from '@/hooks/useMyProgress'
import { Card } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { JournalView } from '@/components/journal/JournalView'

function Ring({ value, color, size = 88 }: { value: number; color: string; size?: number }) {
  const r = size / 2 - 9
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="8" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  )
}

function pctColor(v: number, thresholds = [80, 50]) {
  return v >= thresholds[0] ? '#22c55e' : v >= thresholds[1] ? '#eab308' : '#ef4444'
}

/**
 * «Мой прогресс» ученика.
 *
 * До §122 страница стояла на ДВУХ мёртвых контурах сразу и потому врала: у
 * ученика с принятой работой и оценкой 5 экран показывал «Сдача ДЗ 0%», «0
 * проверено» и нули в «Статусах ДЗ». Первый источник — легаси
 * (`useStudentProfile` → `attendance`, `homework_submissions`,
 * `mock_exam_results`, все пусты), второй — Homework V2
 * (`get_student_homework_summary` → `_homework_v2_base`, `homework_assignments`
 * пуст). Оба снесены отсюда целиком: не чинить и не прятать, а удалить вместе
 * с запросами — как в §111.
 *
 * Теперь показатель один и живой: доля ЗАВЕРШЁННЫХ ТЕМ (все разделы отмечены и
 * ДЗ принято) плюс состояние работ из `get_student_topic_journal`.
 */
export function MyProgressPage() {
  const profile = useAuthStore(s => s.profile)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    supabase.from('students').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => { setStudentId(data?.id || null); setResolving(false) })
  }, [profile?.id])

  // Из профиля осталась ровно одна живая величина — цель по баллам; она лежит
  // в `students`, а не в мёртвых таблицах.
  const { data: s, loading } = useStudentProfile(studentId)
  const { progress, loading: loadingProgress, error } = useMyProgress()

  if (resolving || loading || loadingProgress) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-600" />
        <span className="text-gray-500 text-sm">Загружаем прогресс…</span>
      </div>
    )
  }

  if (!s) {
    return (
      <div className="text-center py-20 space-y-3">
        <Users size={40} className="mx-auto text-gray-300" />
        <p className="text-gray-500">Профиль ученика не найден.<br />Обратитесь к администратору.</p>
      </div>
    )
  }

  const { topics, homework, averagePercent } = progress

  return (
    <div className="space-y-6 max-w-3xl">

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Мой прогресс</h1>
        {s.target_score && (
          <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
            <Target size={13} />Цель ЕГЭ: <strong className="text-gray-800">{s.target_score} баллов</strong>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/*
        Плитки только там, где есть источник. Посещаемость, пробники и
        легаси-ДЗ убраны вместе с запросами: рисовать ноль там, где данных нет
        вовсе, — врать увереннее, чем молчать.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex flex-col items-center py-5 gap-2">
          <div className="relative">
            <Ring value={topics.percent} color={pctColor(topics.percent, [70, 40])} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-extrabold" style={{ color: pctColor(topics.percent, [70, 40]) }}>
                {topics.percent}%
              </span>
            </div>
          </div>
          <div className="text-xs font-semibold text-gray-700 text-center">Темы завершены</div>
          <span data-testid="progress-topics" className="text-xs text-gray-400">
            {topics.done} из {topics.total}
          </span>
        </Card>

        <Card className="flex flex-col justify-center py-5 gap-2">
          <div className="text-xs font-semibold text-gray-700 text-center">Домашние задания</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xl font-bold text-yellow-700">{homework.submitted}</div>
              <div className="text-[11px] text-gray-400">на проверке</div>
            </div>
            <div>
              <div className="text-xl font-bold text-red-600">{homework.returned}</div>
              <div className="text-[11px] text-gray-400">на доработке</div>
            </div>
            <div>
              <div className="text-xl font-bold text-emerald-700">{homework.accepted}</div>
              <div className="text-[11px] text-gray-400">принято</div>
            </div>
          </div>
          {homework.pending > 0 && (
            <div className="text-center text-[11px] text-gray-400">ещё не сдано: {homework.pending}</div>
          )}
        </Card>

        {/* Средний балл — только когда есть принятые работы с оценкой. */}
        {averagePercent != null && (
          <Card className="flex flex-col items-center py-5 gap-2">
            <div className="relative">
              <Ring value={averagePercent} color={pctColor(averagePercent)} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-extrabold" style={{ color: pctColor(averagePercent) }}>
                  {averagePercent}%
                </span>
              </div>
            </div>
            <div className="text-xs font-semibold text-gray-700 text-center">Средний балл</div>
            <span className="text-xs text-gray-400">по принятым работам</span>
          </Card>
        )}
      </div>

      <div className={cn('rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500')}>
        Тема считается завершённой, когда отмечены все её разделы и принято домашнее
        задание. Разделы отмечает сам ученик — на странице темы.
      </div>

      {s.groups.length > 0 && (
        <Card>
          <div className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BookOpen size={16} className="text-primary-500" />
            Мои курсы
          </div>
          <div className="space-y-2">
            {s.groups.map(g => (
              <div key={g.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-xl">
                <div>
                  <div className="text-sm font-medium text-gray-800">{g.course_title}</div>
                  <div className="text-xs text-gray-400">{g.name}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <div className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList size={16} className="text-primary-500" />
            Все домашние задания
          </div>
          <Link to="/my-homework" className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
            Открыть<ChevronRight size={12} />
          </Link>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="rounded-[24px] bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(99,102,241,0.08))] px-5 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-xl">
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 ring-1 ring-sky-100">
                <BarChart3 size={13} />
                Первая часть
              </div>
              <h2 className="mt-3 text-xl font-bold text-slate-950">Аналитика по номерам ФИПИ</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Отдельный экран с точностью по каждому номеру первой части и рекомендациями, что повторить следующим.
              </p>
            </div>
            <Link
              to="/student/variants/stats"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-transform transition-colors hover:scale-[0.98] hover:bg-slate-900"
            >
              Открыть аналитику
              <ChevronRight size={15} />
            </Link>
          </div>
        </div>
      </Card>

      {studentId && (
        <div className="pt-4 border-t border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Журнал занятий и заданий</h2>
          <JournalView
            studentId={studentId}
            viewerRole="student"
            lessonHref={lessonId => `/lessons/${lessonId}`}
          />
        </div>
      )}
    </div>
  )
}
