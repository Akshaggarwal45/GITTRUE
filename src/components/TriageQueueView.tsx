import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Flag,
  GitPullRequest,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import type { EvaluationResult, ProjectNode, PullRequestEvent, TrustVerdict } from '../engine/types.ts';
import type { NetworkSnapshot } from '../types/api.ts';

interface TriageQueueViewProps {
  snapshot: NetworkSnapshot;
  selectedPrId: string | null;
  onSelectPr: (prId: string) => void;
  onVouchAction: (handle: string, status: 'vouched' | 'denounced', reason: string) => Promise<void>;
  onSubmitAppeal: (handle: string, projectId: string, statement: string) => Promise<void>;
}

const VERDICT_META: Record<
  TrustVerdict,
  { label: string; textClass: string; bgClass: string; Icon: typeof ShieldCheck }
> = {
  VOUCHED: {
    label: 'Vouched',
    textClass: 'text-emerald-700',
    bgClass: 'bg-emerald-50',
    Icon: ShieldCheck,
  },
  NEWCOMER_REVIEW: {
    label: 'Newcomer Review',
    textClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    Icon: Clock,
  },
  FLAGGED: {
    label: 'Flagged',
    textClass: 'text-red-700',
    bgClass: 'bg-red-50',
    Icon: ShieldAlert,
  },
};

export function TriageQueueView({
  snapshot,
  selectedPrId,
  onSelectPr,
  onVouchAction,
  onSubmitAppeal,
}: TriageQueueViewProps) {
  const [filterVerdict, setFilterVerdict] = useState<'ALL' | TrustVerdict>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [reasonText, setReasonText] = useState('');

  const projectsById = useMemo(
    () => new Map<string, ProjectNode>(snapshot.projects.map((p) => [p.id, p])),
    [snapshot.projects]
  );

  const evalById = useMemo(
    () => new Map<string, EvaluationResult>(snapshot.evaluations.map((e) => [e.prId, e])),
    [snapshot.evaluations]
  );

  const counts = useMemo(() => {
    let vouched = 0;
    let newcomer = 0;
    let flagged = 0;
    for (const ev of snapshot.evaluations) {
      if (ev.verdict === 'VOUCHED') vouched++;
      else if (ev.verdict === 'NEWCOMER_REVIEW') newcomer++;
      else flagged++;
    }
    return { all: snapshot.evaluations.length, vouched, newcomer, flagged };
  }, [snapshot.evaluations]);

  const filteredPrs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return snapshot.pullRequests.filter((pr) => {
      const ev = evalById.get(pr.id);
      if (filterVerdict !== 'ALL' && ev?.verdict !== filterVerdict) return false;
      if (!q) return true;
      const projName = projectsById.get(pr.projectId)?.name.toLowerCase() ?? '';
      return (
        pr.authorHandle.toLowerCase().includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        projName.includes(q) ||
        pr.kind.includes(q) ||
        pr.filesChanged.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [snapshot.pullRequests, evalById, filterVerdict, searchQuery, projectsById]);

  const activePr: PullRequestEvent | undefined =
    filteredPrs.find((p) => p.id === selectedPrId) ?? filteredPrs[0];
  const activeEval = activePr ? evalById.get(activePr.id) : undefined;

  const handleVouchOrDenounce = async (status: 'vouched' | 'denounced') => {
    if (!activePr) return;
    setActionBusy(true);
    try {
      const defaultReason =
        status === 'vouched'
          ? `Vouched after reviewing ${activePr.kind === 'issue' ? 'Issue' : 'PR'} #${activePr.prNumber}`
          : `Denounced after reviewing ${activePr.kind === 'issue' ? 'Issue' : 'PR'} #${activePr.prNumber}`;
      await onVouchAction(activePr.authorHandle, status, reasonText.trim() || defaultReason);
      setReasonText('');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAppealSubmit = async () => {
    if (!activePr || !activeEval || !appealText.trim()) return;
    const denouncedPath = activeEval.trustPaths.find((p) => p.status === 'denounced');
    const sourceProjId = denouncedPath?.sourceProjectId ?? activePr.projectId;
    setActionBusy(true);
    try {
      await onSubmitAppeal(activePr.authorHandle, sourceProjId, appealText.trim());
      setAppealText('');
      setAppealOpen(false);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Campaign Detection Recall</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {snapshot.metrics.campaignRecallPercent}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {snapshot.metrics.campaignPrsCaught} / {snapshot.metrics.campaignPrsTotal} caught
            </span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Honest Newcomer Inclusion</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
              {snapshot.metrics.newcomerInclusionPercent}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {snapshot.metrics.genuineNewcomersAllowed} / {snapshot.metrics.genuineNewcomersTotal} admitted
            </span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Hostile False-Flag Defense</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {snapshot.metrics.falselyDenouncedProtected} / {snapshot.metrics.falselyDenouncedTotal}
            </span>
            <span className="text-xs text-slate-500">protected from unilateral block</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Sybil & Burst Neutralized</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {snapshot.metrics.sybilNodesNeutralized}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {snapshot.metrics.rogueFakeAccountsTotal > 0
                ? `${snapshot.metrics.rogueFakeAccountsBlockedFromVouch}/${snapshot.metrics.rogueFakeAccountsTotal} burst fakes stopped`
                : '0 false positives'}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {(
            [
              { key: 'ALL', label: `All (${counts.all})` },
              { key: 'VOUCHED', label: `Vouched (${counts.vouched})` },
              { key: 'NEWCOMER_REVIEW', label: `Newcomer Review (${counts.newcomer})` },
              { key: 'FLAGGED', label: `Flagged (${counts.flagged})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterVerdict(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                filterVerdict === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter handle, repo, issue, or title..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Main Split: Queue Table + Evidence Drawer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Submission</th>
                  <th className="py-2.5 px-3">Contributor</th>
                  <th className="py-2.5 px-3 text-right">Trust</th>
                  <th className="py-2.5 px-4">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredPrs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 px-4 text-center text-slate-500">
                      No pull requests or issues match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredPrs.map((pr) => {
                    const ev = evalById.get(pr.id);
                    const verdict = ev?.verdict ?? 'NEWCOMER_REVIEW';
                    const meta = VERDICT_META[verdict];
                    const VerdictIcon = meta.Icon;
                    const proj = projectsById.get(pr.projectId);
                    const isSelected = activePr?.id === pr.id;

                    return (
                      <tr
                        key={pr.id}
                        onClick={() => onSelectPr(pr.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-medium text-slate-900 truncate">{pr.title}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 truncate">
                            <span>{proj?.name ?? pr.projectId}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {pr.kind === 'issue' ? 'Issue' : 'PR'} #{pr.prNumber}
                            </span>
                            {ev?.campaignCluster?.isActiveCampaign && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-red-600 font-medium font-mono">
                                  {ev.campaignCluster.clusterId}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-mono text-xs text-slate-900">@{pr.authorHandle}</div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {pr.accountAgeDays}d · {pr.publicMergedPrs} PRs
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          <span
                            className={
                              (ev?.netTrustScore ?? 0) > 0
                                ? 'text-emerald-700 font-medium'
                                : (ev?.netTrustScore ?? 0) < 0
                                  ? 'text-red-700 font-medium'
                                  : 'text-slate-500'
                            }
                          >
                            {(ev?.netTrustScore ?? 0) > 0 ? '+' : ''}
                            {(ev?.netTrustScore ?? 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${meta.bgClass} ${meta.textClass}`}
                          >
                            <VerdictIcon className="w-3.5 h-3.5 shrink-0" />
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Evidence Drawer */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          {!activePr || !activeEval ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select an item to inspect its trust path, credibility weighting, static checks, and campaign fingerprint.
            </div>
          ) : (
            <>
              <div className="space-y-2 border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {activePr.kind === 'issue' ? (
                      <FileWarning className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <GitPullRequest className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>{projectsById.get(activePr.projectId)?.repo ?? activePr.projectId}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {activePr.kind === 'issue' ? 'Issue' : 'PR'} #{activePr.prNumber}
                    </span>
                  </div>
                  {(() => {
                    const meta = VERDICT_META[activeEval.verdict];
                    const Icon = meta.Icon;
                    return (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium shrink-0 ${meta.bgClass} ${meta.textClass}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {meta.label}
                      </span>
                    );
                  })()}
                </div>
                <h3 className="text-base font-semibold text-slate-900 leading-snug">
                  {activePr.title}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono text-slate-800">@{activePr.authorHandle}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">Account age {activePr.accountAgeDays} days</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{activePr.publicMergedPrs} public merged PRs</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">SimHash {activeEval.simhashHex.slice(0, 8)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700">Decision Evidence Trace</h4>
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {activeEval.evidenceReasons.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {activeEval.trustPaths.length > 0 && (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-semibold text-slate-700">
                    Transitive Trust & Voucher Credibility Paths
                  </h4>
                  <div className="space-y-2">
                    {activeEval.trustPaths.map((tp, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-md bg-slate-50 border border-slate-200/80 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">
                            {tp.path.join(' → ')}
                          </span>
                          <span
                            className={`font-mono tabular-nums font-medium ${
                              tp.burstBlocked
                                ? 'text-amber-700'
                                : tp.status === 'vouched'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {tp.burstBlocked
                              ? '0.00 (Blocked)'
                              : `${tp.status === 'vouched' ? '+' : '-'}${tp.decayedWeight.toFixed(2)}`}
                          </span>
                        </div>
                        <div className="text-slate-600 flex flex-wrap items-center gap-2">
                          <span>
                            {tp.status === 'vouched' ? 'Vouched' : 'Denounced'}
                            {tp.isDisputed ? ' (Appeal Pending)' : ''}
                          </span>
                          {tp.status === 'vouched' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                Voucher Credibility {tp.voucherCredibility.toFixed(2)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                Budget Dilution {tp.dilutionFactor}x
                              </span>
                            </>
                          )}
                        </div>
                        {tp.reason && <div className="text-slate-500">{tp.reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeEval.campaignCluster && (
                <div className="space-y-1.5 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                      <Flag className="w-3.5 h-3.5" />
                      {activeEval.campaignCluster.clusterType === 'same_repo_duplicate'
                        ? `Same-Repo Duplicate Cluster (${activeEval.campaignCluster.clusterId})`
                        : `Cross-Project Campaign Cluster (${activeEval.campaignCluster.clusterId})`}
                    </h4>
                    <span className="text-xs font-mono tabular-nums text-red-700">
                      {activeEval.campaignCluster.similarityPercent}% match
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {activeEval.campaignCluster.prIds.length} near-identical submissions across{' '}
                    <span className="font-medium text-slate-900 tabular-nums">
                      {activeEval.campaignCluster.projectIds.length} project(s)
                    </span>{' '}
                    within{' '}
                    <span className="tabular-nums">{activeEval.campaignCluster.windowMinutes}m</span>
                    {' · '}
                    <span className="tabular-nums">
                      {activeEval.campaignCluster.youngAccountCount} fresh accounts
                    </span>
                    {activeEval.campaignCluster.mutualVouchCount > 0 && (
                      <>
                        {' · '}
                        <span className="tabular-nums">
                          {activeEval.campaignCluster.mutualVouchCount} mutual vouches
                        </span>
                      </>
                    )}
                  </p>
                </div>
              )}

              {(activeEval.diffFindings.length > 0 || activeEval.positiveSignals.length > 0) && (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-semibold text-slate-700">
                    Deterministic Code & Metadata Inspection
                  </h4>
                  {activeEval.diffFindings.map((f, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-md bg-red-50/70 border border-red-200/80 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-medium text-red-800">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {f.ruleId}
                        </span>
                        <span className="font-mono text-red-700">{f.severity}</span>
                      </div>
                      <p className="text-red-900/80">{f.explanation}</p>
                      <code className="block bg-white/80 px-2 py-1 rounded text-[11px] text-slate-800 font-mono truncate">
                        {f.snippet}
                      </code>
                    </div>
                  ))}
                  {activeEval.positiveSignals.map((sig) => (
                    <div
                      key={sig.signalId}
                      className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50/60 border border-emerald-200/70 rounded-md p-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      <span>{sig.description}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    {activePr.kind === 'issue' ? 'Issue Description' : 'Patch Diff'}
                  </span>
                  {activePr.filesChanged.length > 0 && (
                    <span className="font-mono truncate max-w-[220px]">
                      {activePr.filesChanged.join(', ')}
                    </span>
                  )}
                </div>
                <pre className="p-3 rounded-md bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed max-h-48 whitespace-pre-wrap">
                  {activePr.kind === 'issue' ? activePr.body : activePr.diffText}
                </pre>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <input
                  type="text"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="Optional reason for vouch or denouncement..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={actionBusy}
                    onClick={() => handleVouchOrDenounce('vouched')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Vouch Contributor
                  </button>
                  <button
                    disabled={actionBusy}
                    onClick={() => handleVouchOrDenounce('denounced')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    Denounce
                  </button>
                  {activeEval.trustPaths.some((p) => p.status === 'denounced') && (
                    <button
                      disabled={actionBusy}
                      onClick={() => setAppealOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <Scale className="w-3.5 h-3.5" />
                      File Appeal
                    </button>
                  )}
                </div>

                {appealOpen && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                    <textarea
                      rows={2}
                      value={appealText}
                      onChange={(e) => setAppealText(e.target.value)}
                      placeholder="Explain why this denouncement is invalid or resolved..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-blue-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setAppealOpen(false)}
                        className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={actionBusy || !appealText.trim()}
                        onClick={handleAppealSubmit}
                        className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                      >
                        Submit Appeal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
