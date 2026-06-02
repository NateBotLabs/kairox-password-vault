import { useState } from 'react';
import type { VaultEntry, LoginEntry } from '../hooks/useBackground.js';

interface Props {
  entries: VaultEntry[];
  onAutofill: (entry: VaultEntry) => void;
  onCopy:     (text: string, label: string) => void;
}

export function EntryList({ entries, onAutofill, onCopy }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No entries
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {entries.map(entry => {
        const login   = 'Login' in entry.kind ? (entry.kind as { Login: LoginEntry }).Login : null;
        const name    = login?.name ?? ('SecureNote' in entry.kind ? entry.kind.SecureNote.title : 'Card');
        const sub     = login?.username ?? login?.url ?? '';
        const open    = expanded === entry.id;

        return (
          <div key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setExpanded(open ? null : entry.id)}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        10,
                width:      '100%',
                padding:    '10px 14px',
                background: open ? 'var(--surface)' : 'none',
                border:     'none',
                color:      'var(--text)',
                cursor:     'pointer',
                textAlign:  'left',
              }}
            >
              <span style={{
                width:        32,
                height:       32,
                borderRadius: 6,
                background:   'var(--surface)',
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                fontSize:     16,
                flexShrink:   0,
              }}>
                {login ? '🔑' : 'SecureNote' in entry.kind ? '📝' : '💳'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {name}
                </div>
                {sub && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                    {sub}
                  </div>
                )}
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
            </button>

            {open && login && (
              <div style={{ padding: '4px 14px 12px 56px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ActionRow label="Username" onCopy={() => onCopy(login.username, 'Username')} />
                <ActionRow label="Password" onCopy={() => onCopy(login.password, 'Password')} />
                {login.url && (
                  <button
                    onClick={() => onAutofill(entry)}
                    style={actionBtnStyle('#7c6df020', 'var(--accent2)')}
                  >
                    ⚡ Autofill this tab
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionRow({ label, onCopy }: { label: string; onCopy: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <button onClick={onCopy} style={actionBtnStyle('var(--surface)', 'var(--text)')}>
        Copy
      </button>
    </div>
  );
}

function actionBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    background:   bg,
    border:       '1px solid var(--border)',
    borderRadius: 4,
    color,
    cursor:       'pointer',
    fontSize:     11,
    padding:      '3px 8px',
  };
}
