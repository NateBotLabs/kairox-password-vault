interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search…' }: Props) {
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus
        style={{
          width:        '100%',
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color:        'var(--text)',
          padding:      '7px 10px',
          fontSize:     13,
          outline:      'none',
        }}
      />
    </div>
  );
}
