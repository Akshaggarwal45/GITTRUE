import { useCallback, useEffect, useState } from 'react';
import {
  Award,
  FileCode2,
  GitPullRequest,
  Globe,
  Network,
  Plus,
  Radar,
  RotateCcw,
  Scale,
  SlidersHorizontal,
} from 'lucide-react';
import { AppealsAuditView } from './components/AppealsAuditView.tsx';
import { CampaignRadarView } from './components/CampaignRadarView.tsx';
import { PolicyLabView } from './components/PolicyLabView.tsx';
import { RepoScanView } from './components/RepoScanView.tsx';
import { ReputationView } from './components/ReputationView.tsx';
import { SubmitPrModal } from './components/SubmitPrModal.tsx';
import { TriageQueueView } from './components/TriageQueueView.tsx';
import { TrustGraphView } from './components/TrustGraphView.tsx';
import { VouchedTdView } from './components/VouchedTdView.tsx';
import type { ProjectPolicy, SubmissionKind } from './engine/types.ts';
import { apiFetch, type NetworkSnapshot } from './types/api.ts';

type NavTab =
  | 'triage'
  | 'scanner'
  | 'reputation'
  | 'graph'
  | 'campaigns'
  | 'vouched'
  | 'appeals'
  | 'policy';

const NAV_ITEMS: { key: NavTab; label: string; Icon: typeof GitPullRequest }[] = [
  { key: 'triage', label: 'PR & Issue Triage', Icon: GitPullRequest },
  { key: 'scanner', label: 'Live GitHub Scan', Icon: Globe },
  { key: 'reputation', label: 'Voucher Reputation', Icon: Award },
  { key: 'graph', label: 'Trust Graph', Icon: Network },
  { key: 'campaigns', label: 'Campaign Radar', Icon: Radar },
  { key: 'vouched', label: 'VOUCHED.td Feeds', Icon: FileCode2 },
  { key: 'appeals', label: 'Appeals & Audit', Icon: Scale },
  { key: 'policy', label: 'Policy & Benchmark', Icon: SlidersHorizontal },
];

export default function App() {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('triage');
  const [selectedPrId, setSelectedPrId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<NetworkSnapshot>('/api/state');
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trust network state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleObserverChange = async (projectId: string) => {
    const next = await apiFetch<NetworkSnapshot>('/api/observer', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    setSnapshot(next);
  };

  const handleVouchAction = async (
    contributorHandle: string,
    status: 'vouched' | 'denounced',
    reason: string
  ) => {
    const next = await apiFetch<NetworkSnapshot>('/api/vouch', {
      method: 'POST',
      body: JSON.stringify({ contributorHandle, status, reason }),
    });
    setSnapshot(next);
  };

  const handleUserVouch = async (
    voucherHandle: string,
    contributorHandle: string,
    reason: string
  ) => {
    const next = await apiFetch<NetworkSnapshot>('/api/vouch', {
      method: 'POST',
      body: JSON.stringify({
        voucherHandle,
        contributorHandle,
        status: 'vouched',
        reason,
      }),
    });
    setSnapshot(next);
  };

  const handleSimulateRogueAttack = async (compromisedProjectId: string) => {
    const next = await apiFetch<NetworkSnapshot>('/api/simulate/rogue-mass-vouch', {
      method: 'POST',
      body: JSON.stringify({ compromisedProjectId }),
    });
    setSnapshot(next);
  };

  const handleUpdateTrustEdge = async (
    sourceProjectId: string,
    targetProjectId: string,
    weight: number
  ) => {
    const next = await apiFetch<NetworkSnapshot>('/api/trust-edge', {
      method: 'POST',
      body: JSON.stringify({ sourceProjectId, targetProjectId, weight }),
    });
    setSnapshot(next);
  };

  const handleSubmitAppeal = async (
    contributorHandle: string,
    denouncedByProjectId: string,
    appealStatement: string
  ) => {
    const next = await apiFetch<NetworkSnapshot>('/api/appeals', {
      method: 'POST',
      body: JSON.stringify({ contributorHandle, denouncedByProjectId, appealStatement }),
    });
    setSnapshot(next);
  };

  const handleResolveAppeal = async (
    appealId: string,
    decision: 'overturned' | 'upheld',
    resolverNote: string
  ) => {
    const next = await apiFetch<NetworkSnapshot>(`/api/appeals/${appealId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision, resolverNote }),
    });
    setSnapshot(next);
  };

  const handleUpdatePolicy = async (updates: Partial<ProjectPolicy>) => {
    const next = await apiFetch<NetworkSnapshot>('/api/policy', {
      method: 'POST',
      body: JSON.stringify(updates),
    });
    setSnapshot(next);
  };

  const handleSubmitPr = async (payload: {
    kind: SubmissionKind;
    projectId: string;
    authorHandle: string;
    accountAgeDays: number;
    publicMergedPrs: number;
    title: string;
    body: string;
    filesChanged: string[];
    diffText: string;
  }) => {
    const res = await apiFetch<{ prId: string; snapshot: NetworkSnapshot }>('/api/prs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setSnapshot(res.snapshot);
    setSelectedPrId(res.prId);
    setActiveTab('triage');
  };

  const handleReset = async () => {
    const next = await apiFetch<NetworkSnapshot>('/api/reset', { method: 'POST' });
    setSnapshot(next);
    setSelectedPrId(null);
  };

  const activeNav = NAV_ITEMS.find((n) => n.key === activeTab)!;
  const observerProject = snapshot?.projects.find((p) => p.id === snapshot.observerProjectId);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            VouchMesh
          </span>
        </div>

        {snapshot && (
          <div className="p-4 border-b border-slate-200 space-y-1.5">
            <label className="block text-xs font-medium text-slate-500">
              Observing as Project
            </label>
            <select
              value={snapshot.observerProjectId}
              onChange={(e) => handleObserverChange(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
            >
              {snapshot.projects
                .filter((p) => !p.isSybilCluster && !p.isHostile)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ecosystem})
                  </option>
                ))}
            </select>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2">
          <button
            onClick={handleReset}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Simulation Data
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="font-medium text-slate-500 whitespace-nowrap">
              {observerProject?.name ?? 'VouchMesh'}
            </span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="font-semibold text-slate-900 truncate">{activeNav.label}</span>
          </div>

          <button
            onClick={() => setSubmitOpen(true)}
            disabled={!snapshot}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Simulate Incoming PR / Issue
          </button>
        </header>

        <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {NAV_ITEMS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeTab === key ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {loading && !snapshot ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-20 bg-white border border-slate-200 rounded-lg animate-pulse" />
                ))}
              </div>
              <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />
            </div>
          ) : error ? (
            <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-700 space-y-3">
              <div>{error}</div>
              <button
                onClick={loadState}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md"
              >
                Retry
              </button>
            </div>
          ) : snapshot ? (
            <>
              {activeTab === 'triage' && (
                <TriageQueueView
                  snapshot={snapshot}
                  selectedPrId={selectedPrId}
                  onSelectPr={setSelectedPrId}
                  onVouchAction={handleVouchAction}
                  onSubmitAppeal={handleSubmitAppeal}
                />
              )}
              {activeTab === 'scanner' && (
                <RepoScanView onVouchAction={handleVouchAction} />
              )}
              {activeTab === 'reputation' && (
                <ReputationView
                  snapshot={snapshot}
                  onSimulateRogueAttack={handleSimulateRogueAttack}
                  onUserVouch={handleUserVouch}
                />
              )}
              {activeTab === 'graph' && (
                <TrustGraphView
                  snapshot={snapshot}
                  onUpdateTrustEdge={handleUpdateTrustEdge}
                />
              )}
              {activeTab === 'campaigns' && (
                <CampaignRadarView
                  snapshot={snapshot}
                  onInspectPr={(prId) => {
                    setSelectedPrId(prId);
                    setActiveTab('triage');
                  }}
                />
              )}
              {activeTab === 'vouched' && (
                <VouchedTdView
                  snapshot={snapshot}
                  onImportComplete={(next) => setSnapshot(next)}
                />
              )}
              {activeTab === 'appeals' && (
                <AppealsAuditView
                  snapshot={snapshot}
                  onResolveAppeal={handleResolveAppeal}
                />
              )}
              {activeTab === 'policy' && (
                <PolicyLabView
                  snapshot={snapshot}
                  onUpdatePolicy={handleUpdatePolicy}
                />
              )}
            </>
          ) : null}
        </main>
      </div>

      {submitOpen && snapshot && (
        <SubmitPrModal
          projects={snapshot.projects}
          defaultProjectId={snapshot.observerProjectId}
          onClose={() => setSubmitOpen(false)}
          onSubmit={handleSubmitPr}
        />
      )}
    </div>
  );
}
