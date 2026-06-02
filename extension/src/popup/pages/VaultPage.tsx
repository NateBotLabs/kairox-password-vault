import { useEffect, useState, useCallback } from 'react';
import { bg, type AutofillCandidate, type CollectionDto, type VaultEntry } from '../hooks/useBackground.js';
import { StatusBar } from '../components/StatusBar.js';
import { SearchBar }  from '../components/SearchBar.js';
import { EntryList }  from '../components/EntryList.js';
import type { StatusData } from '../hooks/useBackground.js';

interface Props {
  status: StatusData;
  onLocked: () => void;
}

export function VaultPage({ status, onLocked }: Props) {
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [entries,     setEntries]     = useState<VaultEntry[]>([]);
  const [activeCol,   setActiveCol]   = useState<string | null>(null);
  const [query,       setQuery]       = useState('');
  const [copied,      setCopied]      = useState('');
  const [matches,     setMatches]     = useState<AutofillCandidate[]>([]);
  const [error,       setError]       = useState('');

  // Get active tab URL for "Suggested" section
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url ?? '';
      if (url.startsWith('https://')) {
        bg.listEntriesForUrl(url)
          .then(setMatches)
          .catch(() => undefined);
      }
    });
  }, []);

  useEffect(() => {
    bg.listCollections()
      .then(cols => {
        setCollections(cols);
        if (cols.length > 0 && !activeCol) {
          setActiveCol(cols[0].id);
        }
      })
      .catch(err => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!activeCol) return;
    setEntries([]);
    bg.listEntries(activeCol)
      .then(setEntries)
      .catch(err => setError(String(err)));
  }, [activeCol]);

  const handleLock = useCallback(async () => {
    await bg.lock();
    onLocked();
  }, [onLocked]);

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    });
  }, []);

  const handleAutofill = useCallback(async (entry: VaultEntry) => {
    if (!('Login' in entry.kind)) return;
    const login = entry.kind.Login;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (u: string, p: string) => {
        const inputs = document.querySelectorAll<HTMLInputElement>('input');
        let userField: HTMLInputElement | null = null;
        let pwField: HTMLInputElement | null = null;

        inputs.forEach(el => {
          if (el.type === 'password') pwField = el;
          else if (!userField && ['email','text','tel'].includes(el.type)) userField = el;
        });

        const fill = (el: HTMLInputElement, v: string) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter ? setter.call(el, v) : (el.value = v);
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (userField) fill(userField, u);
        if (pwField)   fill(pwField, p);
      },
      args: [login.username, login.password],
    });

    window.close();
  }, [activeCol]);

  const filtered = entries.filter(e => {
    if (!query) return true;
    const q = query.toLowerCase();
    if ('Login' in e.kind) {
      const l = e.kind.Login;
      return l.name.toLowerCase().includes(q) ||
             l.username.toLowerCase().includes(q) ||
             (l.url ?? '').toLowerCase().includes(q);
    }
    if ('SecureNote' in e.kind) return e.kind.SecureNote.title.toLowerCase().includes(q);
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
      <StatusBar status={status} onLock={handleLock} />

      {/* Collection tabs */}
      {collections.length > 1 && (
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--border)', padding: '6px 10px' }}>
          {collections.map(col => (
            <button
              key={col.id}
              onClick={() => setActiveCol(col.id)}
              style={{
                background:   activeCol === col.id ? 'var(--accent)' : 'var(--surface)',
                border:       '1px solid var(--border)',
                borderRadius: 4,
                color:        activeCol === col.id ? '#fff' : 'var(--muted)',
                cursor:       'pointer',
                fontSize:     11,
                padding:      '3px 8px',
                whiteSpace:   'nowrap',
              }}
            >
              Vault {col.id.slice(0, 4)}
            </button>
          ))}
        </div>
      )}

      <SearchBar value={query} onChange={setQuery} placeholder="Search vault…" />

      {/* Suggested for current page */}
      {matches.length > 0 && !query && (
        <div style={{ padding: '8px 14px 4px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Suggested for this page
          </div>
          {matches.map(m => (
            <div
              key={m.id}
              style={{
                display:       'flex',
                justifyContent: 'space-between',
                alignItems:    'center',
                padding:       '5px 0',
                fontSize:      12,
              }}
            >
              <span style={{ color: 'var(--text)' }}>{m.name} — <span style={{ color: 'var(--muted)' }}>{m.username}</span></span>
              <button
                onClick={async () => {
                  // Fetch from the correct collection and autofill
                  const colEntries = await bg.listEntries(m.collectionId);
                  const found = colEntries.find(e => e.id === m.id);
                  if (found) handleAutofill(found);
                }}
                style={{
                  background:   'var(--accent)',
                  border:       'none',
                  borderRadius: 4,
                  color:        '#fff',
                  cursor:       'pointer',
                  fontSize:     10,
                  padding:      '3px 8px',
                }}
              >
                Fill
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
      )}

      {copied && (
        <div style={{
          position:    'fixed',
          bottom:      16,
          left:        '50%',
          transform:   'translateX(-50%)',
          background:  'var(--accent)',
          borderRadius: 6,
          color:        '#fff',
          fontSize:     12,
          padding:      '6px 14px',
          pointerEvents: 'none',
        }}>
          {copied} copied
        </div>
      )}

      <EntryList
        entries={filtered}
        onAutofill={handleAutofill}
        onCopy={handleCopy}
      />

      {collections.length === 0 && !error && (
        <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <p>No collections yet.</p>
          <button
            onClick={() => bg.createCollection().then(() => bg.listCollections().then(setCollections))}
            style={{
              marginTop:    10,
              background:   'var(--accent)',
              border:       'none',
              borderRadius: 'var(--radius)',
              color:        '#fff',
              cursor:       'pointer',
              fontSize:     12,
              padding:      '6px 14px',
            }}
          >
            Create first vault
          </button>
        </div>
      )}
    </div>
  );
}
