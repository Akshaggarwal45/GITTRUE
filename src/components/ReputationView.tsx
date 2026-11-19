import { useState } from 'react';
import { ShieldAlert, TrendingDown, TrendingUp, UserPlus, Zap } from 'lucide-react';
import type { NetworkSnapshot } from '../types/api.ts';

interface ReputationViewProps {
  snapshot: NetworkSnapshot;
  onSimulateRogueAttack: (compromisedProjectId: string) => Promise<void>;
  onUserVouch: (voucherHandle: string, contributorHandle: string, reason: string) => Promise<void>;
}

export function ReputationView({
  snapshot,
  onSimulateRogueAttack,
  onUserVouch,
}: ReputationViewProps) {
  const [attackBusy, setAttackBusy] = useState(false);
  const [compromisedId, setCompromisedId] = useState('zig-stdx');
  const [voucherHandle, setVoucherHandle] = useState('rockorager');
  const [targetHandle, setTargetHandle] = useState('arjun_hackathon26');
  const [vouchReason, setVouchReason] = useState('Clean unit-tested fix in #1484');
  const [vouchBusy, setVouchBusy] = useState(false);

  const handleSimulateAttack = async () => {
    setAttackBusy(true);
    try {
      await onSimulateRogueAttack(compromisedId);
    } finally {
      setAttackBusy(false);
    }
  };

  const handleCreateUserVouch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voucherHandle.trim() || !targetHandle.trim()) return;
    setVouchBusy(true);
    try {
      await onUserVouch(voucherHandle.trim(), targetHandle.trim(), vouchReason.trim());
    } finally {
      setVouchBusy(false);
    }
  };

  const ratio = (
    snapshot.policy.reputationSlashRate / Math.max(0.001, snapshot.policy.reputationGainRate)
  ).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Asymmetric Rating & 100-Fake-Account Defense Explainer + Attack Simulator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">
              Asymmetric Voucher Rating & Mass-Vouch Defense
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              When Person B vouches for Person A, A’s score rises proportionally to{' '}
              <span className="font-medium text-slate-900">B’s Trust × B’s Voucher Credibility × Budget Dilution</span>.
              Reputation climbs slowly (<span className="font-mono text-emerald-700">+{snapshot.policy.reputationGainRate.toFixed(2)}</span> per verified good vouch) and drops{' '}
              <span className="font-mono font-semibold text-red-700">{ratio}× faster</span>{' '}
              (<span className="font-mono text-red-700">-{snapshot.policy.reputationSlashRate.toFixed(2)}</span> per bad vouch).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-md space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                Slow Earn Rate
              </div>
              <div className="font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                +{snapshot.policy.reputationGainRate.toFixed(2)} / good vouch
              </div>
              <p className="text-slate-500">
                Only credited after vouched users land clean PRs in other seed repos.
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-md space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                Fast Slash Rate
              </div>
              <div className="font-mono text-sm font-semibold text-red-700 tabular-nums">
                -{snapshot.policy.reputationSlashRate.toFixed(2)} / bad vouch
              </div>
              <p className="text-slate-500">
                Slashes voucher credibility rapidly if endorsed users trigger flags.
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-md space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                100-Fake Circuit Breaker
              </div>
              <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {snapshot.policy.vouchBudgetPer24h} budget / {snapshot.policy.vouchBurstFreezeThreshold} freeze
              </div>
              <p className="text-slate-500">
                Dilutes per-vouch weight and quarantines sudden 24h bursts to fresh accounts.
              </p>
            </div>
          </div>
        </div>

        {/* 1-Click Rogue 100-Account Attack Simulator & Person B -> A Vouch */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="space-y-2 border-b border-slate-100 pb-4">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-600" />
              Test Compromised Peer (100 Fake Accounts)
            </h4>
            <p className="text-xs text-slate-600">
              Simulates a trusted peer getting hijacked and vouching 100 brand-new accounts within 25 minutes. Watch budget dilution + burst quarantine block all 100 from fast-track.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <select
                value={compromisedId}
                onChange={(e) => setCompromisedId(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
              >
                {snapshot.projects
                  .filter((p) => p.isSeedTrusted && p.id !== snapshot.observerProjectId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.repo})
                    </option>
                  ))}
              </select>
              <button
                disabled={attackBusy}
                onClick={handleSimulateAttack}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {attackBusy ? 'Injecting...' : 'Simulate 100-Fake Attack'}
              </button>
            </div>
          </div>

          <form onSubmit={handleCreateUserVouch} className="space-y-2.5 text-xs">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-blue-600" />
              Test Person-to-Person Vouch (Person B → Person A)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={voucherHandle}
                onChange={(e) => setVoucherHandle(e.target.value)}
                placeholder="Voucher (Person B)"
                className="px-2.5 py-1.5 font-mono bg-slate-50 border border-slate-200 rounded"
              />
              <input
                value={targetHandle}
                onChange={(e) => setTargetHandle(e.target.value)}
                placeholder="Recipient (Person A)"
                className="px-2.5 py-1.5 font-mono bg-slate-50 border border-slate-200 rounded"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={vouchReason}
                onChange={(e) => setVouchReason(e.target.value)}
                placeholder="Reason..."
                className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded"
              />
              <button
                disabled={vouchBusy}
                type="submit"
                className="px-3 py-1.5 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                Add User Vouch
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Tables: Project Vouchers & Individual Contributor Vouchers */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Project Voucher Credibility & 24h Vouch Budget
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Project</th>
                  <th className="py-2.5 px-3 text-right font-medium">Credibility</th>
                  <th className="py-2.5 px-3 text-right font-medium">Good / Bad</th>
                  <th className="py-2.5 px-3 text-right font-medium">24h Vouches</th>
                  <th className="py-2.5 px-3 text-right font-medium">Dilution</th>
                  <th className="py-2.5 px-4 font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.projectReputations
                  .filter((r) => !r.displayName.startsWith('Sybil') || r.credibilityScore === 0)
                  .slice(0, 14)
                  .map((rep) => (
                    <tr key={rep.entityId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-medium text-slate-900">{rep.displayName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        <span
                          className={
                            rep.credibilityScore >= 0.6
                              ? 'text-emerald-700'
                              : rep.credibilityScore >= 0.3
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }
                        >
                          {rep.credibilityScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        +{rep.correctVouches} / -{rep.badVouches}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {rep.recent24hVouches}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {rep.dilutionFactor}x
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-[220px] truncate">
                        {rep.burstQuarantined ? (
                          <span className="text-red-700 font-medium">Burst Quarantined</span>
                        ) : (
                          rep.statusNote
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Contributor Voucher Credibility
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Contributor</th>
                  <th className="py-2.5 px-3 text-right font-medium">Trust</th>
                  <th className="py-2.5 px-3 text-right font-medium">Voucher Cred</th>
                  <th className="py-2.5 px-4 font-medium">Good / Bad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.contributorReputations.map((rep) => (
                  <tr key={rep.entityId} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-medium text-slate-900">{rep.displayName}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                        {rep.statusNote}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {rep.baseTrust.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                      <span
                        className={
                          rep.credibilityScore >= 0.45
                            ? 'text-emerald-700'
                            : rep.credibilityScore >= 0.2
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {rep.credibilityScore.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                      +{rep.correctVouches} / -{rep.badVouches}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
