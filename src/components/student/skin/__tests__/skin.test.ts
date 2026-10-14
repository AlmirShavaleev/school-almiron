import { beforeEach, describe, expect, it } from 'vitest'
import { studentSkinPage, stickerSrc } from '../skin'
import { useStudentTheme } from '@/store/studentThemeStore'

describe('кабинет ученика в стиле лендинга', () => {
  it('в новом виде пока только главная — остальное в тёмной теме светлым листом', () => {
    expect(studentSkinPage('/student')).toBe(true)
    expect(studentSkinPage('/student/')).toBe(true)
    expect(studentSkinPage('/student/variants/generate')).toBe(false)
    expect(studentSkinPage('/my-course/g1')).toBe(false)
  })

  it('стикеры — файлы лендинга по смыслу картинки', () => {
    expect(stickerSrc('lock')).toBe('/brand/icons/unlock.webp')
    expect(stickerSrc('book')).toBe('/brand/icons/bank.webp')
  })
})

describe('тема кабинета', () => {
  beforeEach(() => {
    localStorage.clear()
    useStudentTheme.setState({ theme: 'light' })
  })

  it('переключатель меняет тему и запоминает выбор', () => {
    useStudentTheme.getState().toggle()
    expect(useStudentTheme.getState().theme).toBe('dark')
    expect(localStorage.getItem('almiron:student-theme')).toBe('dark')
    useStudentTheme.getState().toggle()
    expect(useStudentTheme.getState().theme).toBe('light')
  })
})
