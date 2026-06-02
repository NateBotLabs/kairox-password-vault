import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useVault } from '@/context/VaultContext.tsx';
import PasswordInput from '@/components/PasswordInput.tsx';
import Spinner from '@/components/Spinner.tsx';

const MIN_PASSWORD_LENGTH = 12;

function strengthLabel(p: string): { label: string; color: string } {
  if (p.length === 0) return { label: '', color: '' };
  if (p.length < 8)   return { label: 'Too short', color: 'text-red-400' };
  if (p.length < 12)  return { label: 'Weak', color: 'text-orange-400' };
  if (p.length < 20)  return { label: 'Good', color: 'text-yellow-400' };
  return { label: 'Strong', color: 'text-emerald-400' };
}

export default function RegisterPage() {
  const { register, isLoading } = useVault();
  const navigate = useNavigate();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');

  const strength = strengthLabel(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Master password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setError('');
    try {
      await register(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl">🔐</span>
          <h1 className="mt-3 text-2xl font-bold text-slate-100">Kairox</h1>
          <p className="mt-1 text-slate-500 text-sm">Zero-knowledge password vault</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Create account</h2>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-400">Email</label>
            <input
              id="email" type="email" className="input"
              placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} required
              autoComplete="email" disabled={isLoading}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-400">
              Master password
            </label>
            <PasswordInput
              id="password" value={password} onChange={setPassword}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              disabled={isLoading} autoComplete="new-password"
            />
            {strength.label && (
              <p className={`text-xs mt-1 ${strength.color}`}>Strength: {strength.label}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="confirm" className="text-sm font-medium text-slate-400">
              Confirm password
            </label>
            <PasswordInput
              id="confirm" value={confirm} onChange={setConfirm}
              placeholder="Repeat master password"
              disabled={isLoading} autoComplete="new-password"
            />
            {mismatch && (
              <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
            )}
          </div>

          {/* Zero-knowledge notice */}
          <div className="bg-indigo-950/50 border border-indigo-900 rounded-lg px-4 py-3 text-xs text-indigo-300 space-y-1">
            <p className="font-semibold">⚠️ Remember your master password</p>
            <p>
              It is never sent to the server. If you lose it, your vault cannot
              be recovered — not even by us.
            </p>
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isLoading || !email || !password || mismatch}
          >
            {isLoading ? (
              <><Spinner size="sm" /> Setting up vault…</>
            ) : (
              'Create vault'
            )}
          </button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
