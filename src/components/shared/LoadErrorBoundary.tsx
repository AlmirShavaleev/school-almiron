import { Component, type ReactNode } from 'react'
import { ReloadRecovery } from './ReloadRecovery'
import { isChunkLoadError } from '@/lib/lazyPage'
import { noteError } from '@/lib/perf/rum'

type Props = { children: ReactNode; embedded?: boolean; resetKey?: string }

export class LoadErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { noteError(error) }
  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunk = isChunkLoadError(this.state.error)
    const layout = this.props.embedded ? 'py-12' : 'min-h-screen bg-gray-50 p-8'
    return (
      <div className={`flex items-center justify-center ${layout}`}>
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 role="alert" className="text-lg font-bold text-gray-900">{chunk ? 'Не удалось загрузить страницу' : 'Ошибка приложения'}</h1>
          <ReloadRecovery reason={chunk ? 'chunk' : 'error'} />
        </div>
      </div>
    )
  }
}
