import type { StatusData } from '../hooks/useBackground.js';

interface Props {
  status: StatusData;
  onLock: () => void;
}

export function StatusBar({ status, onLock }: Props) {
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '10px 14px',
      borderBottom:   '1px solid var(--border)',
      background:     'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
          Kairox
        </span>
        {status.email && (
          <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {status.email}
          </span>
        )}
      </div>

      <button
        onClick={onLock}
        title="Lock vault"
        style={{
          background: 'none',
          border:     'none',
          color:      'var(--muted)',
          cursor:     'pointer',
          padding:    '4px 6px',
          borderRadius: 4,
          fontSize:   12,
          lineHeight: 1,
        }}
      >
        🔒
      </button>
    </div>
  );
}
