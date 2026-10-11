import './landing/landing.css'
import { MotionConfig } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Header } from './landing/Header'
import { Hero } from './landing/Hero'
import { Arg1Compare } from './landing/Arg1Compare'
import { Arg2System } from './landing/Arg2System'
import { Arg3Unlock } from './landing/Arg3Unlock'
import { Arg4Ai } from './landing/Arg4Ai'
import { Arg5Forecast } from './landing/Arg5Forecast'
import { Screens } from './landing/Screens'
import { Prices } from './landing/Prices'
import { FinalCta, Footer } from './landing/Final'
import { Faq } from './landing/Faq'

type Theme = 'light' | 'dark'
const THEME_KEY = 'almiron-landing-theme'

function readTheme(): Theme | undefined {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : undefined
  } catch {
    return undefined
  }
}

function systemDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Лендинг «Школа Almiron». Эталон с правки 3 — лендинг_прототип_v2.html
 * («диалог + 5 аргументов», ЛЕНДИНГ_ПРАВКИ_3_диалог.md).
 * Живёт на `/about` и на `/` для гостя (см. RootRedirect в App.tsx). Это
 * ленивый чанк: framer-motion и стили лендинга в кабинет не попадают.
 *
 * Тема: без выбора — системная; переключатель запоминает выбор в браузере.
 */
export function LandingPage() {
  const [theme, setTheme] = useState<Theme | undefined>(readTheme)

  const toggle = useCallback(() => {
    setTheme(prev => {
      const dark = prev ? prev === 'dark' : systemDark()
      const next: Theme = dark ? 'light' : 'dark'
      try { localStorage.setItem(THEME_KEY, next) } catch { /* приватный режим — тема просто не запомнится */ }
      return next
    })
  }, [])

  // Плавная прокрутка к якорям — только пока открыт лендинг, кабинет не трогаем.
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.scrollBehavior
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) html.style.scrollBehavior = 'smooth'
    return () => { html.style.scrollBehavior = prev }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="lnd" data-theme={theme}>
        <Header onToggleTheme={toggle} />
        <main>
          <Hero />
          <Arg1Compare />
          <Arg2System />
          <Arg3Unlock />
          <Arg4Ai />
          <Arg5Forecast />
          <Screens />
          <Prices />
          <FinalCta />
          <Faq />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
