import { Trophy } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/store/authStore'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { LEAGUE_LABELS, LEAGUE_COLORS } from '@/utils/format'
import { cn } from '@/utils/cn'

export function LeaderboardPage() {
  const profile = useAuthStore(s => s.profile)
  const { entries, loading } = useLeaderboard()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Загрузка…
      </div>
    )
  }

  const top3 = entries.slice(0, 3)
  // Podium order: 2nd, 1st, 3rd
  const podiumOrder = [
    { entry: entries[1], medal: '🥈', color: 'bg-slate-100',                   height: 'h-28' },
    { entry: entries[0], medal: '🥇', color: 'bg-yellow-50 border-2 border-yellow-300', height: 'h-36' },
    { entry: entries[2], medal: '🥉', color: 'bg-amber-50',                    height: 'h-20' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Рейтинг учеников</h1>
        <p className="text-gray-500 mt-1">Сезон «Физический чемпионат» 2024–2025</p>
      </div>

      {/* Season banner */}
      <div className="bg-gradient-to-r from-primary-600 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Trophy size={28} />
          <h2 className="text-xl font-bold">Физический чемпионат</h2>
        </div>
        <p className="text-primary-100 text-sm">
          Соревнуйся, зарабатывай XP и поднимайся по лигам! Лучшие ученики получат дипломы и призы.
        </p>
        <div className="flex gap-4 mt-4 flex-wrap">
          {[
            { label: 'Бронза',  range: '0–999 XP' },
            { label: 'Серебро', range: '1000–2499 XP' },
            { label: 'Золото',  range: '2500–4999 XP' },
            { label: 'Платина', range: '5000–7999 XP' },
            { label: 'Академик', range: '8000+ XP' },
          ].map(l => (
            <div key={l.label} className="text-center bg-white/10 rounded-xl px-3 py-2 min-w-[80px]">
              <div className="text-xs font-bold">{l.label}</div>
              <div className="text-xs text-primary-200 mt-0.5">{l.range}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Podium */}
      {top3.length >= 2 && (
        <div className="flex items-end justify-center gap-4">
          {podiumOrder.map(({ entry, medal, color, height }) => {
            if (!entry) return null
            return (
              <div
                key={entry.id}
                className={cn('flex flex-col items-center p-4 rounded-2xl', color, height, 'justify-end')}
              >
                <div className="text-2xl mb-1">{medal}</div>
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md text-lg font-bold text-gray-700">
                  {entry.full_name.charAt(0)}
                </div>
                <div className="text-sm font-semibold text-gray-900 mt-2 text-center">
                  {entry.full_name.split(' ')[1] || entry.full_name}
                </div>
                <div className="text-xs text-primary-600 font-bold">
                  {entry.xp_points.toLocaleString()} XP
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Full leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>Полный рейтинг</CardTitle>
          <Badge variant="info">{entries.length} участников</Badge>
        </CardHeader>
        {entries.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Нет данных</p>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => {
              const isMe = profile?.id === entry.profile_id
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-4 p-3 rounded-xl transition-colors',
                    isMe ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50'
                  )}
                >
                  <div className={cn('w-8 text-center font-bold text-sm', entry.rank <= 3 ? 'text-yellow-600' : 'text-gray-400')}>
                    {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                  </div>
                  <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">
                    {entry.full_name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 flex items-center gap-2">
                      {entry.full_name}
                      {isMe && <Badge variant="info" className="text-xs">Вы</Badge>}
                    </div>
                  </div>
                  <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', LEAGUE_COLORS[entry.league] || '')}>
                    {LEAGUE_LABELS[entry.league] || entry.league}
                  </span>
                  <div className="text-right min-w-[80px]">
                    <div className="font-bold text-primary-600">{entry.xp_points.toLocaleString()}</div>
                    <div className="text-xs text-gray-400">XP</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
