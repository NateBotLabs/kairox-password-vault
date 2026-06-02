import { useState, type FormEvent } from 'react';
import { bg } from '../hooks/useBackground.js';
import type { StatusData } from '../hooks/useBackground.js';

interface Props {
  onUnlocked: (status: StatusData) => void;
}

type Mode = 'login' | 'register';

export function UnlockPage({ onUnlocked }: Props) {
  const [mode,     setMode]     = useState<Mode>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const status = mode === 'login'
        ? await bg.unlock(email, password)
        : await bg.register(email, password);
      onUnlocked(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>🔐</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
          Kairox Vault
        </h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Zero-knowledge password manager
        </p>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {(['login', 'register'] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(''); }}
            style={{
              flex:       1,
              padding:    '8px 0',
              background: mode === m ? 'var(--accent)' : 'none',
              border:     'none',
              color:      mode === m ? '#fff' : 'var(--muted)',
              cursor:     'pointer',
              fontSize:   13,
              fontWeight: mode === m ? 600 : 400,
            }}
          >
            {m === 'login' ? 'Sign in' : 'Register'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          required
          autoFocus
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Master password"
          required
          style={inputStyle}
        />

        {error && (
          <p style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !email || !password}
          style={{
            background:   loading ? 'var(--surface)' : 'var(--accent)',
            border:       'none',
            borderRadius: 'var(--radius)',
            color:        '#fff',
            cursor:       loading ? 'not-allowed' : 'pointer',
            fontSize:     14,
            fontWeight:   600,
            padding:      '10px 0',
            transition:   'background 0.15s',
          }}
        >
          {loading ? 'Deriving keys…' : mode === 'login' ? 'Unlock vault' : 'Create account'}
        </button>
      </form>

      <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 16, lineHeight: 1.4 }}>
        Keys derived locally with Argon2id.
        <br />Your master password never leaves this device.
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color:        'var(--text)',
  fontSize:     14,
  outline:      'none',
  padding:      '9px 12px',
  width:        '100%',
};
