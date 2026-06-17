import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/store/authStore'
import { useAchievements } from '@/hooks/useAchievements'
import { cn } from '@/utils/cn'

export function AchievementsPage() {
  const profile = useAuthStore(s => s.profile)
  const isStudent = profile?.role === 'student'
  const { achievements, loading } = useAchievements()

  const earned    = achievements.filter(a => a.earned)
  const notEarned = achievements.filter(a => !a.earned)
  const totalXp   = earned.reduce((s, a) => s + a.xp_reward, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Загрузка…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Достижения</h1>
        <p className="text-gray-500 mt-1">Зарабатывай достижения и получай XP баллы</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-2xl font-bold text-primary-600">{earned.length}</div>
          <div className="text-sm text-gray-500">Получено</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-2xl font-bold text-gray-900">{achievements.length}</div>
          <div className="text-sm text-gray-500">Всего</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-2xl font-bold text-yellow-500">{totalXp.toLocaleString()}</div>
          <div className="text-sm text-gray-500">XP за достижения</div>
        </div>
      </div>

      {/* Progress bar */}
      {achievements.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Прогресс</span>
            <span>{earned.length} / {achievements.length}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className="h-3 bg-gradient-to-r from-primary-500 to-yellow-400 rounded-full transition-all"
              style={{ width: `${Math.round((earned.length / achievements.length) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Earned */}
      {earned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Полученные</CardTitle>
            <Badge variant="success">{earned.length}</Badge>
          </CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {earned.map(ach => (
              <div
                key={ach.id}
                className="flex items-center gap-4 p-4 rounded-xl border border-yellow-200 bg-yellow-50"
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl bg-yellow-100 shrink-0">
                  {ach.icon}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900 flex items-center gap-2">
                    {ach.title}
                    <span className="text-yellow-600 text-xs">✓ Получено</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">{ach.description}</div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-xs text-primary-600 font-semibold">+{ach.xp_reward} XP</div>
                    {ach.earned_at && (
                      <div className="text-xs text-gray-400">
                        {new Date(ach.earned_at).toLocaleDateString('ru-RU')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Not earned */}
      <Card>
        <CardHeader>
          <CardTitle>{isStudent ? 'Осталось получить' : 'Все достижения'}</CardTitle>
          <Badge variant="default">{isStudent ? notEarned.length : achievements.length}</Badge>
        </CardHeader>
        {achievements.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Нет достижений в системе</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(isStudent ? notEarned : achievements).map(ach => (
              <div
                key={ach.id}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-xl border transition-all',
                  ach.earned
                    ? 'border-yellow-200 bg-yellow-50'
                    : 'border-gray-100 bg-gray-50 opacity-60'
                )}
              >
                <div className={cn(
                  'w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0',
                  ach.earned ? 'bg-yellow-100' : 'bg-gray-200'
                )}>
                  {ach.icon}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{ach.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{ach.description}</div>
                  <div className="text-xs text-primary-600 font-semibold mt-1">+{ach.xp_reward} XP</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
