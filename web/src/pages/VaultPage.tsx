import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CollectionDto } from '@kairox/sdk';
import { useVault } from '@/context/VaultContext.tsx';
import Layout from '@/components/Layout.tsx';
import Spinner from '@/components/Spinner.tsx';

function CollectionCard({ col, onClick }: { col: CollectionDto; onClick: () => void }) {
  const date = new Date(col.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <button
      onClick={onClick}
      className="card p-5 text-left hover:border-indigo-700 hover:bg-slate-800/50
                 transition-all group focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center text-xl flex-shrink-0">
          🗄️
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-100 group-hover:text-white transition-colors">
            Vault
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Created {date}</p>
          <p className="text-xs text-slate-600 font-mono mt-1 truncate">{col.id}</p>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <span className="text-6xl mb-4">🗄️</span>
      <h2 className="text-xl font-semibold text-slate-200">No vaults yet</h2>
      <p className="text-slate-500 mt-2 max-w-sm">
        Create your first vault to start storing passwords securely.
        Each vault has its own encryption key.
      </p>
      <button onClick={onCreate} className="btn-primary mt-6 px-6">
        Create vault
      </button>
    </div>
  );
}

export default function VaultPage() {
  const { client } = useVault();
  const navigate   = useNavigate();

  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [loading, setLoading]         = useState(true);
  const [creating, setCreating]       = useState(false);
  const [error, setError]             = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCollections(await client.listCollections());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vaults');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    setCreating(true);
    setError('');
    try {
      const col = await client.createCollection();
      setCollections(prev => [col, ...prev]);
      navigate(`/collections/${col.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vault');
      setCreating(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header row */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Your vaults</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {collections.length} vault{collections.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="btn-primary"
          >
            {creating ? <><Spinner size="sm" /> Creating…</> : '+ New vault'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : collections.length === 0 ? (
          <EmptyState onCreate={handleCreate} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map(col => (
              <CollectionCard
                key={col.id}
                col={col}
                onClick={() => navigate(`/collections/${col.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
