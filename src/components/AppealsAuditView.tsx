import { useState } from 'react';
import { CheckCircle2, Clock, Scale, XCircle } from 'lucide-react';
import type { NetworkSnapshot } from '../types/api.ts';

interface AppealsAuditViewProps {
  snapshot: NetworkSnapshot;
  onResolveAppeal: (appealId: string, decision: 'overturned' | 'upheld', note: string) => Promise<void>;
}

export function AppealsAuditView({ snapshot, onResolveAppeal }: AppealsAuditViewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));

  const handleResolve = async (id: string, decision: 'overturned' | 'upheld') => {
    setBusyId(id);
    try {
      await onResolveAppeal(
        id,
        decision,
        decision === 'overturned'
          ? 'Peer review confirmed retaliatory or erroneous denouncement; overturned.'
          : 'Denouncement upheld with corroborated abuse evidence.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Appeals Queue */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Scale className="w-4 h-4 text-slate-500" />
            Denouncement Appeals & Peer Review
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Contributors flagged by a project can dispute denouncements with public PR evidence. Pending appeals damp automatic penalties by 50%; overturned appeals clear the record.
          </p>
        </div>

        {snapshot.appeals.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">No appeals submitted yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {snapshot.appeals.map((appeal) => {
              const sourceProj = projectById.get(appeal.denouncedByProjectId);
              return (
                <div key={appeal.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">
                          @{appeal.contributorHandle}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-600">
                          Disputing {sourceProj?.name ?? appeal.denouncedByProjectId}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Original reason: {appeal.denouncementReason}
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                        appeal.status === 'overturned'
                          ? 'bg-emerald-50 text-emerald-700'
                          : appeal.status === 'upheld'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {appeal.status === 'overturned' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : appeal.status === 'upheld' ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {appeal.status === 'overturned'
                        ? 'Overturned'
                        : appeal.status === 'upheld'
                          ? 'Upheld'
                          : 'Pending Review'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded border border-slate-200/70">
                    “{appeal.appealStatement}”
                  </p>

                  {appeal.resolverNote && (
                    <p className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">Resolution: </span>
                      {appeal.resolverNote}
                    </p>
                  )}

                  {appeal.status === 'pending' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        disabled={busyId === appeal.id}
                        onClick={() => handleResolve(appeal.id, 'overturned')}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                      >
                        Overturn & Restore
                      </button>
                      <button
                        disabled={busyId === appeal.id}
                        onClick={() => handleResolve(appeal.id, 'upheld')}
                        className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md disabled:opacity-50"
                      >
                        Uphold Flag
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">Trust Decision Audit Log</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Append-only history of vouches, denouncements, edge adjustments, and appeal resolutions.
          </p>
        </div>

        <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
          {snapshot.auditLog.map((entry) => (
            <div key={entry.id} className="py-3 first:pt-0 space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-slate-900">
                  {entry.action} · {entry.target}
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </span>
              </div>
              <p className="text-slate-600">{entry.details}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
