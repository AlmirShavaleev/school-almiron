import { Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { BuildFixtureLesson } from './lesson-one'
import { BUILD_ID } from '@/lib/buildVersion'
import { LoadErrorBoundary } from '@/components/shared/LoadErrorBoundary'
import { lazyPage } from '@/lib/lazyPage'
import { startRum, type PerfEvent } from '@/lib/perf/rum'
import { useConfirmedStudentId, useSessionExpiry } from '@/lib/draftIdentity'
import { useAuthStore } from '@/store/authStore'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '@/types'

const LessonTwo = lazyPage('LessonTwo', () => import('./lesson-two'))

function AccountFixture() {
  const owner = useConfirmedStudentId()
  const epoch = useAuthStore(state => state.identityEpoch)
  useSessionExpiry()

  function login(id: string, verified: boolean, expiresIn = 3600) {
    const store = useAuthStore.getState()
    const user = { id } as User
    store.setUser(user)
    store.setSession({ user, expires_at: Date.now() / 1000 + expiresIn } as Session)
    if (verified) {
      store.setProfile({ id, role: 'student' } as Profile)
      store.setLoading(false)
    }
  }

  return <>
    <button onClick={() => login('fixture-a', true)}>Sign in A</button>
    <button onClick={() => login('fixture-b', false)}>Pending B</button>
    <button onClick={() => login('fixture-b', true)}>Confirm B</button>
    <button onClick={() => login('fixture-a', true, 1)}>Expire A</button>
    <button onClick={() => useAuthStore.getState().reset()}>Sign out</button>
    {owner ? <BuildFixtureLesson key={epoch} owner={owner} /> : <p>Identity unverified</p>}
  </>
}

function App() {
  const location = useLocation()
  const [diagnostics, setDiagnostics] = useState<PerfEvent[]>([])
  useEffect(() => startRum({
    signedIn: () => true,
    send: async () => {},
    sendOnExit: async events => {
      setDiagnostics(previous => [...previous, ...events.filter(event => event.error_type)])
      return true
    },
  }, { sampleRate: 0 }), [])
  return (
    <>
      <h1>Сборка {BUILD_ID}</h1>
      <nav><Link to="/lesson/1">Первый урок</Link> <Link to="/lesson/2">Другой урок</Link></nav>
      <output data-testid="diagnostics" hidden>{JSON.stringify(diagnostics)}</output>
      <LoadErrorBoundary embedded resetKey={location.pathname}>
        <Suspense fallback={<p>Загрузка урока</p>}>
          <Routes>
            <Route path="/lesson/1" element={<BuildFixtureLesson />} />
            <Route path="/lesson/2" element={<LessonTwo />} />
            <Route path="/accounts" element={<AccountFixture />} />
          </Routes>
        </Suspense>
      </LoadErrorBoundary>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>)
