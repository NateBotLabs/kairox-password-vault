import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { VaultEntry } from '@kairox/sdk';
import { useVault } from '@/context/VaultContext.tsx';
import Layout from '@/components/Layout.tsx';
import EntryCard from '@/components/EntryCard.tsx';
import EntryModal from '@/components/EntryModal.tsx';
import Spinner from '@/components/Spinner.tsx';

export default function CollectionPage() {
  const { id: collectionId } = useParams<{ id: string }>();
  const { client } = useVault();
  const navigate   = useNavigate();

  const [entries, setEntries]       = useState<VaultEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editEntry, setEditEntry]   = useState<VaultEntry | null>(null);
  const [search, setSearch]         = useState('');

  if (!collectionId) { navigate('/'); return null; }
  const id = collectionId; // const narrows string | undefined → string for closures

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await client.listEntries(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  }, [client, id]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() { setEditEntry(null); setShowModal(true); }
  function openEdit(e: VaultEntry) { setEditEntry(e); setShowModal(true); }

  async function handleSave(kind: VaultEntry['kind'], existingEntry?: VaultEntry) {
    setShowModal(false);
    try {
      if (existingEntry) {
        const updated = await client.updateEntry(
          id, existingEntry.id, kind, existingEntry.version,
        );
        setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
      } else {
        const created = await client.createEntry(id, kind);
        setEntries(prev => [created, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function handleDelete(entryId: string) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    try {
      await client.deleteEntry(entryId);
      setEntries(prev => prev.filter(e => e.id !== entryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  // Search filter
  const filtered = entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    const kind = e.kind;
    if ('Login' in kind) {
      return kind.Login.name.toLowerCase().includes(q) ||
        kind.Login.username.toLowerCase().includes(q) ||
        (kind.Login.url ?? '').toLowerCase().includes(q);
    }
    if ('SecureNote' in kind) return kind.SecureNote.title.toLowerCase().includes(q);
    if ('CreditCard' in kind) return kind.CreditCard.name.toLowerCase().includes(q);
    return false;
  });

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Breadcrumb + actions */}
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => navigate('/')} className="btn-ghost">
            ← Vaults
          </button>
          <span className="text-slate-700">/</span>
          <span className="text-slate-300 font-medium">Vault</span>
          <div className="ml-auto">
            <button onClick={openCreate} className="btn-primary">
              + Add entry
            </button>
          </div>
        </div>

        {/* Search */}
        <input
          type="search"
          className="input mb-4"
          placeholder="Search entries…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            {search ? 'No entries match your search.' : (
              <div>
                <p className="text-lg font-medium text-slate-300 mb-2">No entries yet</p>
                <p className="text-sm">Add passwords, notes, or card details to this vault.</p>
                <button onClick={openCreate} className="btn-primary mt-4">Add first entry</button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onEdit={() => openEdit(entry)}
                onDelete={() => handleDelete(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <EntryModal
          initial={editEntry}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </Layout>
  );
}
