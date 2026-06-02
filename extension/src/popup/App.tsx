import { useEffect, useState } from 'react';
import { bg, type StatusData } from './hooks/useBackground.js';
import { UnlockPage } from './pages/UnlockPage.js';
import { VaultPage }  from './pages/VaultPage.js';

type AppState = 'loading' | 'locked' | 'unlocked';

export function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [status,   setStatus]   = useState<StatusData>({
    locked:        true,
    authenticated: false,
    email:         null,
  });

  useEffect(() => {
    bg.getStatus()
      .then(s => {
        setStatus(s);
        setAppState(s.locked ? 'locked' : 'unlocked');
      })
      .catch(() => setAppState('locked'));
  }, []);

  if (appState === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (appState === 'locked') {
    return (
      <UnlockPage
        onUnlocked={s => { setStatus(s); setAppState('unlocked'); }}
      />
    );
  }

  return (
    <VaultPage
      status={status}
      onLocked={() => { setStatus({ locked: true, authenticated: false, email: null }); setAppState('locked'); }}
    />
  );
}
