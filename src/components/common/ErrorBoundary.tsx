import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { userMessage } from '@/lib/errors'

interface State {
  error: unknown
}

/**
 * Last line of defence. A render crash must not leave a blank page — the app is
 * used on phones in airports, where reloading is not always cheap.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Something broke</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{userMessage(this.state.error)}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button onClick={() => window.location.assign('/')}>Go home</Button>
        </div>
      </main>
    )
  }
}
