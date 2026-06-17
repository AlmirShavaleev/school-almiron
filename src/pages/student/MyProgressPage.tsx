import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, CheckCircle, Clock, X as XIcon,
  Target, Loader2, Users, BookOpen, ChevronRight,
  UserCheck, ClipboardList,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { Card } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, Cell,
} from 'recharts'

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

function AttIcon({ status }: { status: string }) {
  if (status === 'present') return <CheckCircle size={14} className="text-green-500 shrink-0" />
  if (status === 'absent')  return <XIcon size={14} className="text-red-500 shrink-0" />
  if (status === 'late')    return <Clock size={14} className="text-orange-400 shrink-0" />
  if (status === 'excused') return <CheckCircle size={14} className="text-blue-400 shrink-0" />
  return null
}

function pctColor(v: number, thresholds = [80, 50]) {
  return v >= thresholds[0] ? '#22c55e' : v >= thresholds[1] ? '#eab308' : '#ef4444'
}

export function MyProgressPage() {
  const profile = useAuthStore(s => s.profile)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    supabase.from('students').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => { setStudentId(data?.id || null); setResolving(false) })
  }, [profile?.id])

  const { data: s, loading } = useStudentProfile(studentId)

  if (resolving || loading) {
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

  const pendingHW = s.homeworks.filter(h => h.status === 'not_submitted' || h.status === 'revision')
  const overdueHW = pendingHW.filter(h => new Date(h.due_date) < new Date())

  const hwScoreData = s.homeworks
    .filter(h => h.status === 'checked' && h.score != null)
    .slice(0, 10).reverse()
    .map((h, i) => ({
      name:  `ДЗ ${i + 1}`,
      score: Math.round(h.score! / h.max_score * 100),
      title: h.title,
    }))

  const mockChartData = s.mock_results.slice().reverse().map(m => ({
    name:  new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    score: Math.round(m.score / m.max_score * 100),
  }))

  const rings = [
    {
      label:    'Посещаемость',
      value:    s.attendance_percent,
      color:    pctColor(s.attendance_percent),
      sub:      <span className="text-xs flex gap-2">
                  <span className="text-green-600 font-medium">{s.attendance_present}✓</span>
                  <span className="text-orange-500">{s.attendance_late}⏱</span>
                  <span className="text-red-500">{s.attendance_absent}✗</span>
                </span>,
    },
    {
      label:    'Сдача ДЗ',
      value:    s.hw_completion_pct,
      color:    pctColor(s.hw_completion_pct),
      sub:      <span className="text-xs text-gray-400">{s.hw_checked} из {s.hw_total}</span>,
    },
    {
      label:    'Средний балл',
      value:    s.hw_avg_score ?? 0,
      color:    '#6366f1',
      valueLabel: s.hw_avg_score != null ? `${s.hw_avg_score}%` : '—',
      sub:      <span className="text-xs text-gray-400">за ДЗ</span>,
    },
    {
      label:    'Прогресс курса',
      value:    s.course_progress_pct,
      color:    pctColor(s.course_progress_pct, [70, 40]),
      sub:      <span className="text-xs text-gray-400">тем пройдено</span>,
    },
  ]

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Мой прогресс</h1>
        {s.target_score && (
          <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
            <Target size={13} />Цель ЕГЭ: <strong className="text-gray-800">{s.target_score} баллов</strong>
          </div>
        )}
      </div>

      {/* 4 metric rings */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {rings.map(ring => (
          <Card key={ring.label} className="flex flex-col items-center py-5 gap-2">
            <div className="relative">
              <Ring value={ring.value} color={ring.color} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn('text-lg font-extrabold')} style={{ color: ring.color }}>
                  {ring.valueLabel ?? `${ring.value}%`}
                </span>
              </div>
            </div>
            <div className="text-xs font-semibold text-gray-700 text-center">{ring.label}</div>
            {ring.sub}
          </Card>
        ))}
      </div>

      {/* Overdue HW alert */}
      {overdueHW.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
          <ClipboardList size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-red-700">Просроченные задания ({overdueHW.length})</div>
            <div className="text-xs text-red-500 mt-1">
              {overdueHW.slice(0, 3).map(h => h.title).join(' · ')}
              {overdueHW.length > 3 && ` +${overdueHW.length - 3}`}
            </div>
          </div>
          <Link to="/homeworks" className="ml-auto text-xs text-red-600 font-medium flex items-center gap-0.5 shrink-0">
            Открыть<ChevronRight size={12} />
          </Link>
        </div>
      )}

      {/* HW score chart */}
      {hwScoreData.length >= 3 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardList size={16} className="text-primary-500" />
              Баллы за ДЗ
            </div>
            {s.hw_avg_score != null && (
              <span className="text-sm text-gray-400">
                Среднее: <span className="font-semibold text-gray-700">{s.hw_avg_score}%</span>
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hwScoreData} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={26} />
              <Tooltip formatter={(v: any, _: any, p: any) => [`${v}%`, p.payload.title || 'Балл']} />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {hwScoreData.map((entry, i) => (
                  <Cell key={i} fill={pctColor(entry.score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Mock exams chart */}
      {mockChartData.length >= 2 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp size={16} className="text-purple-500" />
              Динамика пробников
            </div>
            {s.mock_avg != null && (
              <span className="text-sm text-gray-400">
                Среднее: <span className="font-semibold text-gray-700">{s.mock_avg}%</span>
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={mockChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={26} />
              <Tooltip formatter={(v: any) => [`${v}%`, 'Балл']} />
              <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2.5}
                dot={{ fill: '#8b5cf6', r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Recent attendance */}
      {s.recent_attendance.length > 0 && (
        <Card>
          <div className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <UserCheck size={16} className="text-green-500" />
            Последние занятия
          </div>
          <div className="space-y-1">
            {s.recent_attendance.slice(0, 8).map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-gray-50 transition-colors">
                <AttIcon status={a.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{a.lesson_title}</div>
                  {a.note && <div className="text-xs text-gray-400 italic truncate">{a.note}</div>}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(a.scheduled_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Groups summary */}
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
    </div>
  )
}
