import { useState } from 'react';
import type { VaultEntry } from '@kairox/sdk';

interface Props {
  entry: VaultEntry;
  onEdit: () => void;
  onDelete: () => void;
}

function entryMeta(entry: VaultEntry): { icon: string; title: string; subtitle: string } {
  const kind = entry.kind;
  if ('Login' in kind) return {
    icon: '🔑',
    title: kind.Login.name || 'Untitled login',
    subtitle: kind.Login.username,
  };
  if ('SecureNote' in kind) return {
    icon: '📝',
    title: kind.SecureNote.title || 'Untitled note',
    subtitle: 'Secure note',
  };
  if ('CreditCard' in kind) return {
    icon: '💳',
    title: kind.CreditCard.name || 'Card',
    subtitle: `•••• ${kind.CreditCard.number.slice(-4)}`,
  };
  return { icon: '?', title: 'Unknown', subtitle: '' };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className="btn-ghost text-xs py-1 px-2"
      title={`Copy ${label}`}
    >
      {copied ? '✓ Copied' : `Copy ${label}`}
    </button>
  );
}

export default function EntryCard({ entry, onEdit, onDelete }: Props) {
  const { icon, title, subtitle } = entryMeta(entry);
  const [expanded, setExpanded] = useState(false);

  const kind = entry.kind;
  const isLogin = 'Login' in kind;
  const isCard  = 'CreditCard' in kind;

  return (
    <div className="card hover:border-slate-700 transition-colors">
      {/* Main row */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-lg flex-shrink-0">
          {icon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-100 truncate">{title}</p>
          <p className="text-sm text-slate-500 truncate">{subtitle}</p>
        </div>

        {/* Quick-copy */}
        {isLogin && (
          <CopyButton value={(kind as { Login: { password: string } }).Login.password} label="password" />
        )}

        {/* Expand chevron */}
        <span className="text-slate-600 text-sm ml-1 flex-shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3 space-y-2">
          {isLogin && (() => {
            const l = (kind as { Login: { username: string; password: string; url?: string; notes?: string } }).Login;
            return (
              <>
                <Row label="Username" value={l.username} copy />
                <Row label="Password" value={l.password} copy masked />
                {l.url && <Row label="URL" value={l.url} link />}
                {l.notes && <Row label="Notes" value={l.notes} />}
              </>
            );
          })()}

          {'SecureNote' in kind && (
            <div className="text-sm text-slate-300 whitespace-pre-wrap">
              {kind.SecureNote.content}
            </div>
          )}

          {isCard && (() => {
            const c = (kind as { CreditCard: { number: string; expiry_month: number; expiry_year: number; cvv: string; cardholder: string } }).CreditCard;
            return (
              <>
                <Row label="Number" value={c.number} copy masked />
                <Row label="Expiry" value={`${String(c.expiry_month).padStart(2,'0')}/${c.expiry_year}`} />
                <Row label="CVV" value={c.cvv} copy masked />
                <Row label="Cardholder" value={c.cardholder} />
              </>
            );
          })()}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-slate-800">
            <button onClick={onEdit} className="btn-ghost text-sm">✏️ Edit</button>
            <button onClick={onDelete} className="btn-danger text-sm ml-auto">🗑 Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label, value, copy = false, masked = false, link = false,
}: { label: string; value: string; copy?: boolean; masked?: boolean; link?: boolean }) {
  const [show, setShow] = useState(!masked);
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500 w-20 flex-shrink-0">{label}</span>
      <span className="flex-1 text-slate-300 font-mono truncate">
        {show ? value : '••••••••'}
        {link && (
          <a
            href={value.startsWith('http') ? value : `https://${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-indigo-400 hover:text-indigo-300"
          >
            ↗
          </a>
        )}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {masked && (
          <button onClick={() => setShow(v => !v)} className="text-slate-600 hover:text-slate-300 p-1">
            {show ? '🙈' : '👁'}
          </button>
        )}
        {copy && (
          <button onClick={handleCopy} className="text-slate-600 hover:text-slate-300 p-1">
            {copied ? '✓' : '⎘'}
          </button>
        )}
      </div>
    </div>
  );
}
