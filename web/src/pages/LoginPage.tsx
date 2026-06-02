import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useVault } from '@/context/VaultContext.tsx';
import PasswordInput from '@/components/PasswordInput.tsx';
import Spinner from '@/components/Spinner.tsx';

export default function LoginPage() {
  const { login, isLoading } = useVault();
  const navigate = useNavigate();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-4xl">🔐</span>
          <h1 className="mt-3 text-2xl font-bold text-slate-100">Kairox</h1>
          <p className="mt-1 text-slate-500 text-sm">Zero-knowledge password vault</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Sign in</h2>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-400">
              Master password
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              placeholder="Your master password"
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isLoading || !email || !password}
          >
            {isLoading ? (
              <>
                <Spinner size="sm" />
                Deriving keys… (this takes a few seconds)
              </>
            ) : (
              'Unlock vault'
            )}
          </button>

          <p className="text-center text-sm text-slate-500">
            No account?{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              Create one
            </Link>
          </p>
        </form>

        <p className="text-center mt-4 text-xs text-slate-600">
          Your master password never leaves this device.
        </p>
      </div>
    </div>
  );
}
