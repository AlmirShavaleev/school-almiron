import { create } from 'zustand'

/**
 * Тема кабинета ученика в стиле лендинга (письмо ЛК_ученика_в_стиле_лендинга.md,
 * 14.10.2026): светлая по умолчанию, тёмная — по переключателю в шапке.
 * Настройку системы («тёмная в ОС») намеренно не читаем: владелец решил
 * «светлая — по умолчанию». Выбор живёт в localStorage этого браузера; когда
 * хранилище недоступно (приватное окно), тема просто не запоминается.
 */
export type StudentTheme = 'light' | 'dark'

const KEY = 'almiron:student-theme'

function readTheme(): StudentTheme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

interface StudentThemeState {
  theme: StudentTheme
  toggle: () => void
}

export const useStudentTheme = create<StudentThemeState>((set, get) => ({
  theme: readTheme(),
  toggle: () => {
    const theme: StudentTheme = get().theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(KEY, theme) } catch { /* тема на один заход */ }
    set({ theme })
  },
}))
