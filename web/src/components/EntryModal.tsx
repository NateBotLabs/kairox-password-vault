import { FormEvent, useEffect, useState } from 'react';
import type { CreditCard, EntryKind, LoginEntry, SecureNote, VaultEntry } from '@kairox/sdk';
import PasswordInput from './PasswordInput.tsx';
import Spinner from './Spinner.tsx';

type Tab = 'Login' | 'SecureNote' | 'CreditCard';

interface Props {
  initial: VaultEntry | null;
  onSave: (kind: EntryKind, existing?: VaultEntry) => Promise<void>;
  onClose: () => void;
}

function generatePassword(length = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function LoginForm({
  initial, saving,
  onChange,
}: {
  initial: Partial<LoginEntry>;
  saving: boolean;
  onChange: (v: LoginEntry) => void;
}) {
  const [name, setName]           = useState(initial.name ?? '');
  const [username, setUsername]   = useState(initial.username ?? '');
  const [password, setPassword]   = useState(initial.password ?? '');
  const [url, setUrl]             = useState(initial.url ?? '');
  const [notes, setNotes]         = useState(initial.notes ?? '');

  useEffect(() => {
    onChange({ name, username, password, url: url || undefined, notes: notes || undefined, custom_fields: [] });
  }, [name, username, password, url, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  function genPassword() { setPassword(generatePassword()); }

  return (
    <div className="space-y-3">
      <Field label="Name" required>
        <input className="input" placeholder="e.g. GitHub" value={name}
          onChange={e => setName(e.target.value)} disabled={saving} required />
      </Field>
      <Field label="Username / email">
        <input className="input" placeholder="username or email" value={username}
          onChange={e => setUsername(e.target.value)} disabled={saving} autoComplete="off" />
      </Field>
      <Field label="Password">
        <div className="flex gap-2">
          <div className="flex-1">
            <PasswordInput value={password} onChange={setPassword} showCopy disabled={saving} />
          </div>
          <button type="button" onClick={genPassword} className="btn-ghost text-xs flex-shrink-0" title="Generate password">
            ⚡ Generate
          </button>
        </div>
      </Field>
      <Field label="Website">
        <input className="input" placeholder="https://example.com" value={url}
          onChange={e => setUrl(e.target.value)} disabled={saving} type="url" />
      </Field>
      <Field label="Notes">
        <textarea className="input min-h-[72px] resize-none" placeholder="Optional notes"
          value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} />
      </Field>
    </div>
  );
}

function NoteForm({
  initial, saving, onChange,
}: { initial: Partial<SecureNote>; saving: boolean; onChange: (v: SecureNote) => void }) {
  const [title, setTitle]     = useState(initial.title ?? '');
  const [content, setContent] = useState(initial.content ?? '');

  useEffect(() => { onChange({ title, content }); }, [title, content]); // eslint-disable-line

  return (
    <div className="space-y-3">
      <Field label="Title" required>
        <input className="input" placeholder="Note title" value={title}
          onChange={e => setTitle(e.target.value)} disabled={saving} required />
      </Field>
      <Field label="Content">
        <textarea className="input min-h-[140px] resize-none font-mono text-sm"
          placeholder="Secret content…" value={content}
          onChange={e => setContent(e.target.value)} disabled={saving} />
      </Field>
    </div>
  );
}

function CardForm({
  initial, saving, onChange,
}: { initial: Partial<CreditCard>; saving: boolean; onChange: (v: CreditCard) => void }) {
  const [name, setName]               = useState(initial.name ?? '');
  const [cardholder, setCardholder]   = useState(initial.cardholder ?? '');
  const [number, setNumber]           = useState(initial.number ?? '');
  const [expiryM, setExpiryM]         = useState(String(initial.expiry_month ?? ''));
  const [expiryY, setExpiryY]         = useState(String(initial.expiry_year ?? ''));
  const [cvv, setCvv]                 = useState(initial.cvv ?? '');

  useEffect(() => {
    onChange({
      name, cardholder, number, cvv,
      expiry_month: parseInt(expiryM) || 1,
      expiry_year:  parseInt(expiryY) || new Date().getFullYear(),
    });
  }, [name, cardholder, number, expiryM, expiryY, cvv]); // eslint-disable-line

  return (
    <div className="space-y-3">
      <Field label="Name" required>
        <input className="input" placeholder="e.g. Visa Personal" value={name}
          onChange={e => setName(e.target.value)} disabled={saving} required />
      </Field>
      <Field label="Cardholder">
        <input className="input" placeholder="Name on card" value={cardholder}
          onChange={e => setCardholder(e.target.value)} disabled={saving} />
      </Field>
      <Field label="Card number">
        <input className="input font-mono" placeholder="•••• •••• •••• ••••" value={number}
          onChange={e => setNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
          disabled={saving} maxLength={16} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry month">
          <input className="input" placeholder="MM" value={expiryM} type="number"
            min="1" max="12" onChange={e => setExpiryM(e.target.value)} disabled={saving} />
        </Field>
        <Field label="Expiry year">
          <input className="input" placeholder="YYYY" value={expiryY} type="number"
            onChange={e => setExpiryY(e.target.value)} disabled={saving} />
        </Field>
      </div>
      <Field label="CVV">
        <input className="input font-mono w-24" placeholder="•••" value={cvv} type="password"
          onChange={e => setCvv(e.target.value.slice(0, 4))} disabled={saving} maxLength={4} />
      </Field>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-slate-400">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function EntryModal({ initial, onSave, onClose }: Props) {
  const isEdit = initial !== null;

  function detectTab(): Tab {
    if (!initial) return 'Login';
    if ('Login' in initial.kind) return 'Login';
    if ('SecureNote' in initial.kind) return 'SecureNote';
    return 'CreditCard';
  }

  const [tab, setTab]       = useState<Tab>(detectTab);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [loginKind, setLoginKind]   = useState<LoginEntry>({ name: '', username: '', password: '', custom_fields: [] });
  const [noteKind, setNoteKind]     = useState<SecureNote>({ title: '', content: '' });
  const [cardKind, setCardKind]     = useState<CreditCard>({
    name: '', cardholder: '', number: '', cvv: '',
    expiry_month: 1, expiry_year: new Date().getFullYear(),
  });

  const tabs: Tab[] = ['Login', 'SecureNote', 'CreditCard'];
  const tabLabels: Record<Tab, string> = { Login: '🔑 Login', SecureNote: '📝 Note', CreditCard: '💳 Card' };

  function buildKind(): EntryKind {
    if (tab === 'Login') return { Login: loginKind };
    if (tab === 'SecureNote') return { SecureNote: noteKind };
    return { CreditCard: cardKind };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(buildKind(), initial ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-100">
            {isEdit ? 'Edit entry' : 'New entry'}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-xl">
            ×
          </button>
        </div>

        {/* Entry type tabs (only when creating) */}
        {!isEdit && (
          <div className="flex gap-1 px-6 pt-4">
            {tabs.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {tabLabels[t]}
              </button>
            ))}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {error && (
              <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
                {error}
              </div>
            )}

            {tab === 'Login' && (
              <LoginForm
                initial={initial && 'Login' in initial.kind ? initial.kind.Login : {}}
                saving={saving}
                onChange={setLoginKind}
              />
            )}
            {tab === 'SecureNote' && (
              <NoteForm
                initial={initial && 'SecureNote' in initial.kind ? initial.kind.SecureNote : {}}
                saving={saving}
                onChange={setNoteKind}
              />
            )}
            {tab === 'CreditCard' && (
              <CardForm
                initial={initial && 'CreditCard' in initial.kind ? initial.kind.CreditCard : {}}
                saving={saving}
                onChange={setCardKind}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? <><Spinner size="sm" /> Encrypting…</> : (isEdit ? 'Save changes' : 'Add entry')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
