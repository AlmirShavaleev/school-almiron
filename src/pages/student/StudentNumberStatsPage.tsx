import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, BookOpen, BrainCircuit, CheckCircle2, Filter, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { useStudentNumberStats } from '@/hooks/useStudentNumberStats'
import { StudentNumberStatsSection } from '@/components/student/StudentNumberStatsSection'

const SUBJECT_OPTIONS = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
] as const

const EXAM_OPTIONS = [
  { value: 'ege', label: 'ЕГЭ' },
  { value: 'oge', label: 'ОГЭ' },
] as const

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-transform transition-colors ${
        active
          ? 'bg-slate-950 text-white shadow-sm'
          : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

export function StudentNumberStatsPage() {
  const profile = useAuthStore(s => s.profile)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [subject, setSubject] = useState<'math' | 'physics'>('physics')
  const [examType, setExamType] = useState<'ege' | 'oge'>('ege')

  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('students')
      .select('id')
      .eq('profile_id', profile.id)
      .single()
      .then(({ data }) => {
        setStudentId(data?.id || null)
        setResolving(false)
      })
  }, [profile?.id])

  const { data: student, loading: studentLoading } = useStudentProfile(studentId)

  useEffect(() => {
    if (!student) return
    if (student.target_subject === 'math' || student.target_subject === 'physics') setSubject(student.target_subject)
    if (student.target_exam === 'ege' || student.target_exam === 'oge') setExamType(student.target_exam)
  }, [student])

  const stats = useStudentNumberStats(student?.student_id ?? null, subject, examType, 1)

  const analyticsText = useMemo(() => {
    if (!stats.rows.length) return null
    const sorted = [...stats.rows].sort((a, b) => (a.success_ratio ?? 0) - (b.success_ratio ?? 0))
    const weak = sorted[0]
    const strong = [...sorted].reverse()[0]
    return {
      weak: weak?.exam_number !== null ? `№${weak.exam_number}` : weak?.section_title ?? 'этот блок',
      strong: strong?.exam_number !== null ? `№${strong.exam_number}` : strong?.section_title ?? 'этот блок',
    }
  }, [stats.rows])

  if (resolving || studentLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/student/variants" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-slate-950">
          <ArrowLeft size={15} />
          Тренировочные варианты
        </Link>
      </div>

      <div className="relative overflow-hidden rounded-[34px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(99,102,241,0.12),_transparent_24%),linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-7 shadow-[0_38px_100px_-52px_rgba(15,23,42,0.55)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),280px]">
          <div>
            <div className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 ring-1 ring-sky-100 shadow-sm">
              <BrainCircuit size={14} />
              Аналитика решения задач 1 части
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-slate-950 text-balance">
              № и статистика по всем номерам ФИПИ
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 text-pretty">
              Отдельная страница для первой части: видно точность по каждому номеру, слабые места и номера, которые уже решаются стабильно.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <div className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-500 ring-1 ring-slate-200">
                <Filter size={15} />
                Предмет
              </div>
              {SUBJECT_OPTIONS.map(option => (
                <FilterPill key={option.value} active={subject === option.value} onClick={() => setSubject(option.value)}>
                  {option.label}
                </FilterPill>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-500 ring-1 ring-slate-200">
                <BookOpen size={15} />
                Экзамен
              </div>
              {EXAM_OPTIONS.map(option => (
                <FilterPill key={option.value} active={examType === option.value} onClick={() => setExamType(option.value)}>
                  {option.label}
                </FilterPill>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-[26px] bg-slate-950 p-5 text-white shadow-[0_24px_60px_-36px_rgba(15,23,42,0.75)]">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
                <BarChart3 size={14} />
                Что видно сейчас
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-200">
                <p>
                  {analyticsText
                    ? <>Слабее всего сейчас выглядит <span className="font-semibold text-white">{analyticsText.weak}</span>, а стабильнее остальных решается <span className="font-semibold text-white">{analyticsText.strong}</span>.</>
                    : <>Как только появится больше решённых заданий первой части, здесь появится короткий разбор по слабым и сильным номерам.</>}
                </p>
                <p>
                  Мы считаем только размеченные задания части 1, чтобы аналитика была чистой и не смешивала автопроверку с нерелевантными задачами.
                </p>
              </div>
            </div>

            <div className="rounded-[26px] bg-white/85 p-5 ring-1 ring-black/5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                <CheckCircle2 size={14} className="text-emerald-500" />
                Как использовать
              </div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <li>Сначала подтягиваем красные номера.</li>
                <li>Потом закрепляем жёлтые до стабильных 80%+.</li>
                <li>Сильные номера держим короткими повторениями.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <StudentNumberStatsSection
          rows={stats.rows}
          loading={stats.loading}
          error={stats.error}
          title={`Первая часть · ${SUBJECT_OPTIONS.find(option => option.value === subject)?.label} · ${EXAM_OPTIONS.find(option => option.value === examType)?.label}`}
        />
      </div>
    </div>
  )
}
