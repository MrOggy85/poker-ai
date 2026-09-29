import { useEffect, useState } from 'react';

interface Health {
  status: string;
  decision: string;
  monologue: string;
}

/**
 * Milestone 1 placeholder. The real spectator table replaces this once the event stream
 * exists; until then this page exists to prove the bundle, the server and the two model
 * services can all see each other.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 16 }}>
      <h1 style={{ margin: 0, color: 'var(--gold)', fontWeight: 600 }}>Poker AI</h1>
      <p style={{ margin: 0, color: 'var(--text-dim)' }}>
        {health ? `server ${health.status} · jeff ${health.decision} · monologue ${health.monologue}` : 'connecting…'}
      </p>
    </main>
  );
}
