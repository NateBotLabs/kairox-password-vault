import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault } from '@/context/VaultContext.tsx';
import Spinner from './Spinner.tsx';

export default function Layout({ children }: { children: ReactNode }) {
  const { email, lock } = useVault();
  const navigate = useNavigate();
  const [locking, setLocking] = useState(false);

  async function handleLock() {
    setLocking(true);
    await lock();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-vault-bg flex flex-col">
      {/* Top nav */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-xl">🔐</span>
            <span className="font-bold text-slate-100 hidden sm:block">Kairox</span>
          </button>

          {/* User + lock */}
          <div className="flex items-center gap-3">
            {email && (
              <span className="text-sm text-slate-400 hidden sm:block max-w-[180px] truncate">
                {email}
              </span>
            )}
            <button
              onClick={handleLock}
              disabled={locking}
              className="btn-ghost text-slate-400 hover:text-red-300 hover:bg-red-900/20"
              title="Lock vault"
            >
              {locking ? <Spinner size="sm" /> : '🔒'}
              <span className="hidden sm:inline">Lock</span>
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
