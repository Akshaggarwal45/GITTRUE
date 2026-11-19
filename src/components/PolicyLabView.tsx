import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ProjectPolicy } from '../engine/types.ts';
import type { NetworkSnapshot } from '../types/api.ts';

interface PolicyLabViewProps {
  snapshot: NetworkSnapshot;
  onUpdatePolicy: (updates: Partial<ProjectPolicy>) => Promise<void>;
}

export function PolicyLabView({ snapshot, onUpdatePolicy }: PolicyLabViewProps) {
  const [draft, setDraft] = useState<ProjectPolicy>(snapshot.policy);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(snapshot.policy);
  }, [snapshot.policy, snapshot.observerProjectId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Enforce invariant: reputation increasing rate stays lower than decreasing rate
      const safeGain = Math.min(draft.reputationGainRate, Number((draft.reputationSlashRate * 0.5).toFixed(2)));
      await onUpdatePolicy({ ...draft, reputationGainRate: safeGain });
    } finally {
      setSaving(false);
    }
  };

  const activeProject = snapshot.projects.find((p) => p.id === snapshot.observerProjectId);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            Per-Project Policy & Asymmetric Reputation Rules ({activeProject?.name})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Each repository controls its own trust propagation, vouch budget, burst freeze cap, and asymmetric gain/slash rates independently.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">Reputation Gain Rate (Slow)</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-700">
                +{draft.reputationGainRate.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.1}
              step={0.01}
              value={draft.reputationGainRate}
              onChange={(e) => {
                const val = Number(e.target.value);
                setDraft({
                  ...draft,
                  reputationGainRate: Math.min(val, Number((draft.reputationSlashRate * 0.5).toFixed(2))),
                });
              }}
              className="w-full accent-emerald-600"
            />
            <span className="text-slate-500 block">
              Reputation gained per verified good vouch (capped ≤ 50% of slash rate).
            </span>
          </label>

          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">Reputation Slash Rate (Fast)</span>
              <span className="font-mono tabular-nums font-semibold text-red-700">
                -{draft.reputationSlashRate.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.12}
              max={0.5}
              step={0.02}
              value={draft.reputationSlashRate}
              onChange={(e) => {
                const newSlash = Number(e.target.value);
                setDraft({
                  ...draft,
                  reputationSlashRate: newSlash,
                  reputationGainRate: Math.min(draft.reputationGainRate, Number((newSlash * 0.5).toFixed(2))),
                });
              }}
              className="w-full accent-red-600"
            />
            <span className="text-slate-500 block">
              Credibility lost per bad vouch ({(draft.reputationSlashRate / Math.max(0.01, draft.reputationGainRate)).toFixed(1)}× faster than gain).
            </span>
          </label>

          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">24h Vouch Budget (Before Dilution)</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {draft.vouchBudgetPer24h} vouches
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={15}
              step={1}
              value={draft.vouchBudgetPer24h}
              onChange={(e) => {
                const val = Number(e.target.value);
                setDraft({
                  ...draft,
                  vouchBudgetPer24h: val,
                  vouchBurstFreezeThreshold: Math.max(draft.vouchBurstFreezeThreshold, val + 1),
                });
              }}
              className="w-full accent-blue-600"
            />
            <span className="text-slate-500 block">
              Exceeding this in 24h dilutes per-vouch weight proportionally (budget / count).
            </span>
          </label>

          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">Burst Freeze Threshold (24h)</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {draft.vouchBurstFreezeThreshold} vouches
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={25}
              step={1}
              value={draft.vouchBurstFreezeThreshold}
              onChange={(e) => {
                const val = Number(e.target.value);
                setDraft({
                  ...draft,
                  vouchBurstFreezeThreshold: val,
                  vouchBudgetPer24h: Math.min(draft.vouchBudgetPer24h, val - 1),
                });
              }}
              className="w-full accent-blue-600"
            />
            <span className="text-slate-500 block">
              Quarantines sudden mass-vouch spikes (e.g., 100 fake accounts) to Newcomer Review.
            </span>
          </label>

          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">Hop Decay Multiplier</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {draft.hopDecay.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={draft.hopDecay}
              onChange={(e) => setDraft({ ...draft, hopDecay: Number(e.target.value) })}
              className="w-full accent-blue-600"
            />
            <span className="text-slate-500 block">
              Attenuation applied at each transitive hop beyond direct peers.
            </span>
          </label>

          <label className="space-y-2 block">
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">Min Denounce Corroboration</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {draft.minDenounceCorroboration} project(s)
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={draft.minDenounceCorroboration}
              onChange={(e) =>
                setDraft({ ...draft, minDenounceCorroboration: Number(e.target.value) })
              }
              className="w-full accent-blue-600"
            />
            <span className="text-slate-500 block">
              Independent trusted projects required before blocking (stops hostile singletons).
            </span>
          </label>
        </div>

        <div className="border-t border-slate-100 pt-4 flex justify-end">
          <button
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
          >
            Apply Policy to {activeProject?.name}
          </button>
        </div>
      </div>

      {/* Live Ground-Truth Evaluation Report */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">Simulated Stream Benchmark</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Live verification across {snapshot.metrics.totalEvaluated} PRs & issues in {snapshot.projects.length} projects.
          </p>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Spam Campaigns & Duplicates Caught</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {snapshot.metrics.campaignPrsCaught} / {snapshot.metrics.campaignPrsTotal} (
              {snapshot.metrics.campaignRecallPercent}%)
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Malicious Code Diffs Flagged</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {snapshot.metrics.maliciousCodeCaught} / {snapshot.metrics.maliciousCodeTotal}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Rogue Mass-Vouch Fakes Blocked</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {snapshot.metrics.rogueFakeAccountsTotal > 0
                ? `${snapshot.metrics.rogueFakeAccountsBlockedFromVouch} / ${snapshot.metrics.rogueFakeAccountsTotal}`
                : 'Run 100-Fake Test'}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Genuine Newcomers Admitted</span>
            <span className="font-mono tabular-nums font-semibold text-emerald-700">
              {snapshot.metrics.genuineNewcomersAllowed} / {snapshot.metrics.genuineNewcomersTotal} (
              {snapshot.metrics.newcomerInclusionPercent}%)
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Hostile False-Flags Protected</span>
            <span className="font-mono tabular-nums font-semibold text-emerald-700">
              {snapshot.metrics.falselyDenouncedProtected} / {snapshot.metrics.falselyDenouncedTotal}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">Trusted Regulars Fast-Tracked</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {snapshot.metrics.trustedRegularsFastTracked} / {snapshot.metrics.trustedRegularsTotal}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span className="text-slate-600">False Positives on Healthy Contributors</span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                snapshot.metrics.falsePositiveCount === 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {snapshot.metrics.falsePositiveCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
