import { useEffect, useState } from 'react';
import { Check, FileCode2, RefreshCw } from 'lucide-react';
import { apiFetch, type NetworkSnapshot } from '../types/api.ts';

interface VouchedTdViewProps {
  snapshot: NetworkSnapshot;
  onImportComplete: (nextSnapshot: NetworkSnapshot) => void;
}

export function VouchedTdView({ snapshot, onImportComplete }: VouchedTdViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ghostty');
  const [rawText, setRawText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProjectTd = async (projectId: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ content: string }>(
        `/api/vouched-td/export?projectId=${encodeURIComponent(projectId)}`
      );
      setRawText(res.content);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load VOUCHED.td');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjectTd(selectedProjectId);
  }, [selectedProjectId]);

  const handleImport = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ snapshot: NetworkSnapshot; warnings: string[] }>(
        '/api/vouched-td/import',
        {
          method: 'POST',
          body: JSON.stringify({ projectId: selectedProjectId, rawText }),
        }
      );
      onImportComplete(res.snapshot);
      setStatusMsg(
        res.warnings.length > 0
          ? `Imported with warnings: ${res.warnings.join('; ')}`
          : 'Synced VOUCHED.td and recomputed transitive trust scores.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse VOUCHED.td');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-slate-500" />
              Ghostty VOUCHED.td Live Manifest Editor
            </h3>
            <p className="text-xs text-slate-600">
              Each repository stores its own signed or Git-tracked <code className="font-mono">VOUCHED.td</code> file. Prefix handles with <code className="font-mono">github:</code> to vouch or <code className="font-mono">-github:</code> to denounce with an inline <code className="font-mono"># reason</code>.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
            >
              {snapshot.projects
                .filter((p) => !p.isSybilCluster)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.repo})
                  </option>
                ))}
            </select>
            <button
              onClick={() => loadProjectTd(selectedProjectId)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload
            </button>
          </div>
        </div>

        <textarea
          rows={14}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          spellCheck={false}
          className="w-full p-4 font-mono text-xs bg-slate-900 text-slate-100 rounded-md border border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 leading-relaxed"
        />

        {errorMsg && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">
            {errorMsg}
          </div>
        )}
        {statusMsg && (
          <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-500">
            Edits take effect immediately across all transitive trust paths and PR evaluations.
          </span>
          <button
            onClick={handleImport}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Sync VOUCHED.td & Re-Evaluate
          </button>
        </div>
      </div>
    </div>
  );
}
