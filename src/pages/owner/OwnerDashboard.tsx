import { TrendingUp, Users, CreditCard, Star, BarChart3 } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { useOwnerDashboard } from '@/hooks/useOwnerDashboard'
import { formatCurrency } from '@/utils/format'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444']

export function OwnerDashboard() {
  const { studentCount, groupCount, totalRevenue, overdueAmount, payments, groups, teachers, courses, loading } = useOwnerDashboard()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const avgCheck = studentCount > 0 ? Math.round(totalRevenue / studentCount) : 0

  // Revenue by group (from payments data)
  const revenueByGroup = groups.map((g: any) => ({
    name: g.name?.replace('ЕГЭ ', '').replace('ОГЭ ', ''),
    revenue: payments.filter((p: any) => {
      // Approximate: group's course price * paid students
      return p.status === 'paid'
    }).length > 0 ? (g.student_count || 0) * (g.courses?.price || 0) : 0,
  })).filter((g: any) => g.revenue > 0)

  const paymentStats = {
    total: payments.length,
    paid: payments.filter((p: any) => p.status === 'paid').length,
    pending: payments.filter((p: any) => p.status === 'pending').length,
    overdue: payments.filter((p: any) => p.status === 'overdue').length,
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Кабинет владельца</h1>
        <p className="text-gray-500 mt-1">Школа Almiron • Аналитика и управление</p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Учеников" value={studentCount} icon={<Users size={20} />} color="blue" />
        <StatCard title="Групп" value={groupCount} icon={<BarChart3 size={20} />} color="green" subtitle="Активных групп" />
        <StatCard title="Выручка" value={formatCurrency(totalRevenue)} icon={<CreditCard size={20} />} color="purple" subtitle="Оплачено" />
        <StatCard title="Задолженность" value={formatCurrency(overdueAmount)} icon={<CreditCard size={20} />} color="red" subtitle="Просроченные платежи" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Средний чек" value={formatCurrency(avgCheck)} icon={<TrendingUp size={20} />} color="indigo" />
        <StatCard title="Курсов" value={courses.length} icon={<Star size={20} />} color="orange" />
        <StatCard title="Платежей" value={paymentStats.paid} icon={<CreditCard size={20} />} color="green" subtitle="Оплачено" />
        <StatCard title="Просрочено" value={paymentStats.overdue} icon={<CreditCard size={20} />} color="red" subtitle="Платежей" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Groups revenue */}
        {revenueByGroup.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Доход по группам</CardTitle>
            </CardHeader>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={revenueByGroup}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v / 1000}к`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => [formatCurrency(Number(v)), 'Выручка']} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Payment status */}
        <Card>
          <CardHeader>
            <CardTitle>Статусы платежей</CardTitle>
          </CardHeader>
          <div className="flex items-center gap-6">
            <PieChart width={120} height={120}>
              <Pie
                data={[
                  { value: paymentStats.paid, name: 'Оплачено' },
                  { value: paymentStats.pending, name: 'Ожидает' },
                  { value: paymentStats.overdue, name: 'Просрочено' },
                ]}
                cx={55} cy={55} innerRadius={30} outerRadius={50} dataKey="value" strokeWidth={0}
              >
                {[0, 1, 2].map(i => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
            </PieChart>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-8"><span className="text-gray-500">Всего счетов:</span><span className="font-medium">{paymentStats.total}</span></div>
              <div className="flex justify-between gap-8"><span className="text-green-600">Оплачено:</span><span className="text-green-600 font-medium">{paymentStats.paid}</span></div>
              <div className="flex justify-between gap-8"><span className="text-yellow-600">Ожидает:</span><span className="text-yellow-600 font-medium">{paymentStats.pending}</span></div>
              <div className="flex justify-between gap-8"><span className="text-red-600">Просрочено:</span><span className="text-red-600 font-medium">{paymentStats.overdue}</span></div>
            </div>
          </div>
        </Card>
      </div>

      {/* Teachers */}
      <Card>
        <CardHeader>
          <CardTitle>Преподаватели</CardTitle>
          <Badge variant="info">{teachers.length}</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="text-left pb-3">Преподаватель</th>
                <th className="text-left pb-3">Предметы</th>
                <th className="text-left pb-3">Рейтинг</th>
                <th className="text-left pb-3">Биография</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t: any, i: number) => (
                <tr key={t.id} className="border-b border-gray-50">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 text-sm font-bold">
                        {t.profiles?.full_name?.charAt(0)}
                      </div>
                      <span className="font-medium">{t.profiles?.full_name}</span>
                    </div>
                  </td>
                  <td className="py-3 text-gray-500">{t.subjects?.map((s: string) => s === 'physics' ? 'Физика' : 'Математика').join(', ')}</td>
                  <td className="py-3">
                    <span className="flex items-center gap-1">
                      <Star size={14} className="text-yellow-500 fill-yellow-500" /> {t.rating}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400 text-xs max-w-xs truncate">{t.bio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle>Группы</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {groups.map((g: any) => (
            <div key={g.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="font-semibold text-gray-900">{g.name}</div>
              <div className="text-sm text-gray-500 mt-1">{g.student_count} / {g.max_students} учеников</div>
              <div className="text-xs text-gray-400 mt-0.5">{g.schedule_days?.join(', ')} {g.schedule_time}</div>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                <div className="h-1.5 bg-primary-500 rounded-full" style={{ width: `${Math.min(((g.student_count || 0) / g.max_students) * 100, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
