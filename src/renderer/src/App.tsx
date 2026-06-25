import { useState } from 'react'

export function App(): JSX.Element {
  const [pingResult, setPingResult] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)

  const handlePing = async (): Promise<void> => {
    setPinging(true)
    try {
      const response = await window.api.ping()
      setPingResult(response)
    } catch (err) {
      setPingResult(`error: ${(err as Error).message}`)
    } finally {
      setPinging(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Mesh</h1>
        <p className="app-subtitle">AI workspace OS</p>
      </header>
      <main className="app-main">
        <div className="card">
          <p className="card-label">IPC bridge</p>
          <button onClick={handlePing} disabled={pinging}>
            {pinging ? 'pinging…' : 'Ping main process'}
          </button>
          {pingResult && (
            <p className="card-result">
              response: <code>{pingResult}</code>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
