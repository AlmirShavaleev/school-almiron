import './landing/landing.css'
import { MotionConfig } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Header } from './landing/Header'
import { Hero } from './landing/Hero'
import { ArgCozy } from './landing/ArgCozy'
import { ArgCompare } from './landing/ArgCompare'
import { ArgSystem } from './landing/ArgSystem'
import { ArgUnlock } from './landing/ArgUnlock'
import { ArgAi } from './landing/ArgAi'
import { ArgForecast } from './landing/ArgForecast'
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
 * Лендинг «Школа Almiron». Эталон с правки 4 — лендинг_прототип_v3.html
 * («6 аргументов», письмо лендинг_v3_6_аргументов.md; до этого v2 —
 * «диалог + 5 аргументов»).
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
          <ArgCozy />
          <ArgCompare />
          <ArgSystem />
          <ArgUnlock />
          <ArgAi />
          <ArgForecast />
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
