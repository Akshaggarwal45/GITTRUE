import { Flag, Lock, ShieldAlert } from 'lucide-react';
import type { NetworkSnapshot } from '../types/api.ts';

interface CampaignRadarViewProps {
  snapshot: NetworkSnapshot;
  onInspectPr: (prId: string) => void;
}

export function CampaignRadarView({ snapshot, onInspectPr }: CampaignRadarViewProps) {
  const prById = new Map(snapshot.pullRequests.map((p) => [p.id, p]));
  const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900">
            Privacy-Preserving Campaign & Duplicate Radar
          </h3>
          <p className="text-sm text-slate-600 max-w-3xl">
            Incoming PRs and Issues are reduced to 64-bit SimHash fingerprints with all handles and PII stripped. Flags both cross-project waves ({snapshot.policy.campaignMinProjects}+ repos within {snapshot.policy.campaignWindowHours}h) and same-repo duplicate submissions.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 shrink-0">
          <Lock className="w-3.5 h-3.5 text-slate-500" />
          Zero PII stored in cluster index
        </div>
      </div>

      {snapshot.clusters.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-sm text-slate-500">
          No cross-project or duplicate SimHash clusters detected under current threshold settings.
        </div>
      ) : (
        <div className="space-y-4">
          {snapshot.clusters.map((cluster) => (
            <div
              key={cluster.clusterId}
              className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium ${
                        cluster.isActiveCampaign
                          ? 'bg-red-50 text-red-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {cluster.isActiveCampaign ? (
                        <ShieldAlert className="w-3.5 h-3.5" />
                      ) : (
                        <Flag className="w-3.5 h-3.5" />
                      )}
                      {cluster.clusterType === 'same_repo_duplicate'
                        ? 'Same-Repo Duplicate Wave'
                        : cluster.isActiveCampaign
                          ? 'Active Coordinated Campaign'
                          : 'Emerging Similarity'}
                    </span>
                    <span className="font-mono text-slate-500">{cluster.clusterId}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-500">SimHash {cluster.simhashHex}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-600 tabular-nums">
                      {cluster.youngAccountCount} fresh accounts
                    </span>
                    {cluster.mutualVouchCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-red-700 font-medium tabular-nums">
                          {cluster.mutualVouchCount} mutual vouches
                        </span>
                      </>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Template: “{cluster.sampleTitle}”
                  </h4>
                </div>

                <div className="flex items-center gap-6 text-right tabular-nums">
                  <div>
                    <div className="text-xs text-slate-500">Similarity</div>
                    <div className="text-base font-semibold font-mono text-slate-900">
                      {cluster.similarityPercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Projects Hit</div>
                    <div className="text-base font-semibold font-mono text-red-700">
                      {cluster.projectIds.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Burst Window</div>
                    <div className="text-base font-semibold font-mono text-slate-900">
                      {cluster.windowMinutes}m
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500">
                      <th className="py-2 pr-4 font-medium">Project</th>
                      <th className="py-2 pr-4 font-medium">Item</th>
                      <th className="py-2 pr-4 font-medium">Account</th>
                      <th className="py-2 pr-4 font-medium">Target</th>
                      <th className="py-2 text-right font-medium">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cluster.prIds.map((prId) => {
                      const pr = prById.get(prId);
                      if (!pr) return null;
                      const proj = projectById.get(pr.projectId);
                      return (
                        <tr key={pr.id} className="hover:bg-slate-50">
                          <td className="py-2 pr-4 font-medium text-slate-900">
                            {proj?.name ?? pr.projectId}
                          </td>
                          <td className="py-2 pr-4 font-mono tabular-nums text-slate-600">
                            {pr.kind === 'issue' ? 'Issue' : 'PR'} #{pr.prNumber}
                          </td>
                          <td className="py-2 pr-4 font-mono text-slate-700">
                            @{pr.authorHandle} · {pr.accountAgeDays}d
                          </td>
                          <td className="py-2 pr-4 font-mono text-slate-500 truncate max-w-xs">
                            {pr.filesChanged[0] ?? 'Issue body'}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={() => onInspectPr(pr.id)}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Open Evidence
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
