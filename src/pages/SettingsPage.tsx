import { useState, useEffect, useRef } from 'react'
import {
  User, Bell, Shield, GraduationCap, Camera, Trash2,
  Check, AlertCircle, Loader2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/utils/format'
import { cn } from '@/utils/cn'

type TabKey = 'profile' | 'notifications' | 'security' | 'role'

interface NotifPrefs {
  lesson:   boolean
  homework: boolean
  checked:  boolean
  overdue:  boolean
  badge:    boolean
  payment:  boolean
  email:    boolean
  telegram: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  lesson: true, homework: true, checked: true, overdue: true,
  badge: true, payment: true, email: false, telegram: false,
}

const NOTIF_ITEMS: { key: keyof NotifPrefs; label: string; sub: string; section: 'inapp' | 'channel' }[] = [
  { key: 'lesson',   label: 'Напоминание о занятии',  sub: 'За 30 минут до начала',          section: 'inapp' },
  { key: 'homework', label: 'Новое домашнее задание', sub: 'При выдаче ДЗ преподавателем',   section: 'inapp' },
  { key: 'checked',  label: 'Проверка ДЗ',            sub: 'После проверки домашнего задания', section: 'inapp' },
  { key: 'overdue',  label: 'Просроченное ДЗ',        sub: 'Если ДЗ не сдано в срок',        section: 'inapp' },
  { key: 'badge',    label: 'Новые достижения',       sub: 'При получении нового значка',    section: 'inapp' },
  { key: 'payment',  label: 'Платежи и подписка',     sub: 'Списания, продление, ошибки',    section: 'inapp' },
  { key: 'email',    label: 'Email-рассылки',         sub: 'Дублировать уведомления на почту', section: 'channel' },
  { key: 'telegram', label: 'Telegram-бот',           sub: 'Получать в @almiron_school_bot', section: 'channel' },
]

export function SettingsPage() {
  const profile    = useAuthStore(s => s.profile)
  const setProfile = useAuthStore(s => s.setProfile)
  const [tab, setTab] = useState<TabKey>('profile')

  if (!profile) return null

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Настройки</h1>
        <p className="text-gray-500 mt-1 text-sm">Управление аккаунтом, уведомлениями и безопасностью</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-gray-100">
        {([
          { key: 'profile',       label: 'Профиль',        icon: <User size={15} /> },
          { key: 'notifications', label: 'Уведомления',    icon: <Bell size={15} /> },
          { key: 'security',      label: 'Безопасность',   icon: <Shield size={15} /> },
          ...(profile.role === 'student' ? [{ key: 'role' as TabKey, label: 'Учебные цели', icon: <GraduationCap size={15} /> }] : []),
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as TabKey)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap',
              tab === t.key
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'profile'       && <ProfileTab       profile={profile} setProfile={setProfile} />}
      {tab === 'notifications' && <NotificationsTab profileId={profile.id} />}
      {tab === 'security'      && <SecurityTab />}
      {tab === 'role'          && profile.role === 'student' && <StudentRoleTab profileId={profile.id} />}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAB: Profile (avatar + name + phone)
// ═════════════════════════════════════════════════════════════════════════════

function ProfileTab({ profile, setProfile }: { profile: any; setProfile: (p: any) => void }) {
  const [fullName, setFullName] = useState(profile.full_name || '')
  const [phone,    setPhone]    = useState(profile.phone || '')
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function showMsg(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text })
    setTimeout(() => setMsg(null), 3500)
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    setSaving(false)
    if (error) return showMsg('err', error.message)
    setProfile({ ...profile, full_name: fullName.trim(), phone: phone.trim() || null })
    showMsg('ok', 'Профиль обновлён')
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return showMsg('err', 'Файл больше 2 МБ')
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
      return showMsg('err', 'Только JPG / PNG / WebP / GIF')
    }

    setUploading(true)
    const ext  = file.name.split('.').pop()
    const path = `${profile.id}/avatar-${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' })
    if (upErr) { setUploading(false); return showMsg('err', upErr.message) }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    const { error: profErr } = await supabase
      .from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id)
    setUploading(false)
    if (profErr) return showMsg('err', profErr.message)

    setProfile({ ...profile, avatar_url: publicUrl })
    showMsg('ok', 'Аватар обновлён')
  }

  async function handleAvatarDelete() {
    setUploading(true)
    const { error } = await supabase
      .from('profiles').update({ avatar_url: null }).eq('id', profile.id)
    setUploading(false)
    if (error) return showMsg('err', error.message)
    setProfile({ ...profile, avatar_url: null })
    showMsg('ok', 'Аватар удалён')
  }

  const initials = profile.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><User size={18} />Профиль</CardTitle>
      </CardHeader>

      <div className="space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-5 pb-5 border-b border-gray-100">
          <div className="relative w-20 h-20 shrink-0 rounded-2xl bg-primary-600 flex items-center justify-center text-white text-2xl font-bold overflow-hidden select-none">
            {profile.avatar_url
              ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
              : initials
            }
            {uploading && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <Loader2 size={20} className="text-white animate-spin" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 truncate">{profile.full_name}</div>
            <div className="text-sm text-gray-500">{ROLE_LABELS[profile.role]}</div>
            <div className="text-xs text-gray-400 truncate">{profile.email}</div>

            <div className="flex gap-2 mt-2.5">
              <Button
                size="sm" variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera size={13} className="mr-1" />Загрузить
              </Button>
              {profile.avatar_url && (
                <Button
                  size="sm" variant="ghost"
                  onClick={handleAvatarDelete}
                  disabled={uploading}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={13} className="mr-1" />Удалить
                </Button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
        </div>

        <Input label="ФИО"   value={fullName} onChange={e => setFullName(e.target.value)} />
        <Input label="Email" type="email" value={profile.email || ''} disabled className="opacity-60" />
        <Input label="Телефон" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 (999) 000-00-00" />

        <SaveBar onSave={handleSave} loading={saving} msg={msg} />
      </div>
    </Card>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAB: Notifications (DB-backed prefs)
// ═════════════════════════════════════════════════════════════════════════════

function NotificationsTab({ profileId }: { profileId: string }) {
  const [prefs,   setPrefs]   = useState<NotifPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('notification_prefs').select('*').eq('user_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setPrefs({
            lesson: data.lesson, homework: data.homework, checked: data.checked,
            overdue: data.overdue, badge: data.badge, payment: data.payment,
            email: data.email, telegram: data.telegram,
          })
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profileId])

  function showMsg(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text }); setTimeout(() => setMsg(null), 3500)
  }

  async function toggle(key: keyof NotifPrefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setSaving(true)
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: profileId, ...next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setSaving(false)
    if (error) {
      setPrefs(prefs)  // rollback
      showMsg('err', error.message)
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Загрузка…
        </div>
      </Card>
    )
  }

  const inapp    = NOTIF_ITEMS.filter(i => i.section === 'inapp')
  const channels = NOTIF_ITEMS.filter(i => i.section === 'channel')

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell size={18} />Уведомления в приложении</CardTitle>
          {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </CardHeader>
        <div className="divide-y divide-gray-50">
          {inapp.map(item => (
            <ToggleRow key={item.key} label={item.label} sub={item.sub} on={prefs[item.key]} onToggle={() => toggle(item.key)} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Каналы доставки</CardTitle>
        </CardHeader>
        <div className="divide-y divide-gray-50">
          {channels.map(item => (
            <ToggleRow key={item.key} label={item.label} sub={item.sub} on={prefs[item.key]} onToggle={() => toggle(item.key)} />
          ))}
        </div>
      </Card>

      {msg && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium',
          msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        )}>
          {msg.kind === 'ok' ? <Check size={15} /> : <AlertCircle size={15} />}{msg.text}
        </div>
      )}
    </div>
  )
}

function ToggleRow({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
      <button
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0',
          on ? 'bg-primary-600' : 'bg-gray-200'
        )}
        aria-pressed={on}
      >
        <span className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          on ? 'translate-x-6' : 'translate-x-1'
        )} />
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAB: Security (password change + active sessions)
// ═════════════════════════════════════════════════════════════════════════════

function SecurityTab() {
  const [newPass,    setNewPass]    = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [msg,        setMsg]        = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showPass,   setShowPass]   = useState(false)

  function showMsg(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text }); setTimeout(() => setMsg(null), 4500)
  }

  async function handleChangePassword() {
    if (newPass.length < 8)         return showMsg('err', 'Минимум 8 символов')
    if (!/[A-Za-z]/.test(newPass) || !/\d/.test(newPass))
                                     return showMsg('err', 'Нужны буквы и цифры')
    if (newPass !== confirm)        return showMsg('err', 'Пароли не совпадают')

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setLoading(false)
    if (error) return showMsg('err', error.message)
    setNewPass(''); setConfirm('')
    showMsg('ok', 'Пароль изменён ✓')
  }

  async function handleSignOutEverywhere() {
    setLoading(true)
    await supabase.auth.signOut({ scope: 'others' })
    setLoading(false)
    showMsg('ok', 'Завершены все другие сессии')
  }

  // Password strength
  const strength = (() => {
    let s = 0
    if (newPass.length >= 8)          s++
    if (/[A-Z]/.test(newPass))        s++
    if (/\d/.test(newPass))           s++
    if (/[^A-Za-z0-9]/.test(newPass)) s++
    return s
  })()
  const strengthLabel = ['Слабый','Слабый','Средний','Хороший','Отличный'][strength]
  const strengthColor = ['bg-red-400','bg-red-400','bg-orange-400','bg-blue-500','bg-green-500'][strength]

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield size={18} />Смена пароля</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <Input
            label="Новый пароль"
            type={showPass ? 'text' : 'password'}
            placeholder="Минимум 8 символов с цифрой и буквой"
            value={newPass}
            onChange={e => setNewPass(e.target.value)}
          />

          {/* Strength bar */}
          {newPass.length > 0 && (
            <div>
              <div className="flex gap-1 mb-1">
                {[0,1,2,3].map(i => (
                  <div key={i} className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    i < strength ? strengthColor : 'bg-gray-100'
                  )} />
                ))}
              </div>
              <div className="text-xs text-gray-500">Сложность: {strengthLabel}</div>
            </div>
          )}

          <Input
            label="Повторите пароль"
            type={showPass ? 'text' : 'password'}
            placeholder="Повторите новый пароль"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox" checked={showPass}
              onChange={e => setShowPass(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Показать пароль
          </label>

          <SaveBar
            onSave={handleChangePassword}
            loading={loading}
            msg={msg}
            label="Изменить пароль"
            disabled={!newPass || !confirm}
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Сессии</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Если вы заходили в кабинет с чужого устройства — завершите все другие сессии.
          </p>
          <Button variant="secondary" onClick={handleSignOutEverywhere} loading={loading}>
            Выйти со всех других устройств
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAB: Student Role (learning goals)
// ═════════════════════════════════════════════════════════════════════════════

function StudentRoleTab({ profileId }: { profileId: string }) {
  const [data, setData] = useState<any>(null)
  const [grade, setGrade] = useState<number>(11)
  const [examType, setExamType] = useState<string>('ege')
  const [subject,  setSubject]  = useState<string>('physics')
  const [target,   setTarget]   = useState<number | ''>('')
  const [saving,   setSaving]   = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [msg,      setMsg]      = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('students').select('*').eq('profile_id', profileId).maybeSingle()
      .then(({ data: s }) => {
        if (cancelled) return
        if (s) {
          setData(s)
          setGrade(s.grade || 11)
          setExamType(s.target_exam || 'ege')
          setSubject(s.target_subject || 'physics')
          setTarget(s.target_score ?? '')
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profileId])

  function showMsg(k: 'ok' | 'err', t: string) {
    setMsg({ kind: k, text: t }); setTimeout(() => setMsg(null), 3500)
  }

  async function handleSave() {
    if (!data) return
    setSaving(true)
    const { error } = await supabase.from('students').update({
      grade,
      target_exam:    examType,
      target_subject: subject,
      target_score:   target === '' ? null : Number(target),
    } as any).eq('id', data.id)
    setSaving(false)
    if (error) return showMsg('err', error.message)
    showMsg('ok', 'Цели обновлены')
  }

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Загрузка…
        </div>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <p className="text-sm text-gray-500 py-4 text-center">Профиль ученика не найден</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GraduationCap size={18} />Учебные цели</CardTitle>
      </CardHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Класс"
            value={String(grade)}
            onChange={e => setGrade(Number(e.target.value))}
            options={[8,9,10,11].map(g => ({ value: String(g), label: `${g} класс` }))}
          />
          <Select
            label="Экзамен"
            value={examType}
            onChange={e => setExamType(e.target.value)}
            options={[
              { value: 'ege', label: 'ЕГЭ' },
              { value: 'oge', label: 'ОГЭ' },
            ]}
          />
          <Select
            label="Предмет"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            options={[
              { value: 'physics', label: 'Физика' },
              { value: 'math',    label: 'Математика' },
            ]}
          />
          <Input
            label="Целевой балл"
            type="number"
            min={0} max={100}
            value={target}
            onChange={e => setTarget(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="например, 85"
          />
        </div>

        <div className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg">
          Эти настройки влияют на подбор материалов, пробников и виджет прогресса в личном кабинете.
        </div>

        <SaveBar onSave={handleSave} loading={saving} msg={msg} />
      </div>
    </Card>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  Shared: SaveBar
// ═════════════════════════════════════════════════════════════════════════════

function SaveBar({
  onSave, loading, msg, label = 'Сохранить', disabled,
}: {
  onSave: () => void; loading: boolean
  msg: { kind: 'ok' | 'err'; text: string } | null
  label?: string; disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Button onClick={onSave} loading={loading} disabled={disabled}>{label}</Button>
      {msg && (
        <span className={cn(
          'flex items-center gap-1.5 text-sm font-medium',
          msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'
        )}>
          {msg.kind === 'ok' ? <Check size={15} /> : <AlertCircle size={15} />}{msg.text}
        </span>
      )}
    </div>
  )
}
