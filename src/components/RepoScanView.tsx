import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCode2,
  GitMerge,
  GitPullRequest,
  Globe,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  UserCheck,
  UserX,
} from 'lucide-react';
import type {
  ProjectImportance,
  RepoScanReport,
  RepoScanVerdict,
  ScannedPrResult,
} from '../engine/types.ts';
import { apiFetch } from '../types/api.ts';

interface RepoScanViewProps {
  onVouchAction: (handle: string, status: 'vouched' | 'denounced', reason: string) => Promise<void>;
}

const EXAMPLE_REPOS = [
  { label: 'ghostty-org/ghostty', value: 'https://github.com/ghostty-org/ghostty' },
  { label: 'vitejs/vite', value: 'https://github.com/vitejs/vite' },
  { label: 'astral-sh/ruff', value: 'https://github.com/astral-sh/ruff' },
  { label: 'oven-sh/bun', value: 'https://github.com/oven-sh/bun' },
];

const VERDICT_META: Record<
  RepoScanVerdict,
  { label: string; textClass: string; bgClass: string; Icon: typeof ShieldCheck }
> = {
  GENUINE: {
    label: 'Genuine',
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
  NOT_GENUINE: {
    label: 'Not Genuine',
    textClass: 'text-red-700',
    bgClass: 'bg-red-50',
    Icon: ShieldAlert,
  },
};

const IMPORTANCE_LABEL: Record<ProjectImportance, { text: string; className: string }> = {
  HIGH: { text: 'High Impact', className: 'text-emerald-700 font-medium' },
  MODERATE: { text: 'Moderate Impact', className: 'text-slate-700 font-medium' },
  LOW: { text: 'Low Impact', className: 'text-amber-700 font-medium' },
};

export function RepoScanView({ onVouchAction }: RepoScanViewProps) {
  const [repoUrl, setRepoUrl] = useState('https://github.com/vitejs/vite');
  const [limit, setLimit] = useState(10);
  const [stateFilter, setStateFilter] = useState<'open' | 'all'>('all');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RepoScanReport | null>(null);

  const [verdictFilter, setVerdictFilter] = useState<'ALL' | RepoScanVerdict>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const runScan = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? repoUrl).trim();
    if (!targetUrl) {
      setError('Enter a GitHub repository URL or owner/repo slug.');
      return;
    }

    setScanning(true);
    setError(null);
    setActionNotice(null);

    try {
      const data = await apiFetch<RepoScanReport>('/api/scan-repo', {
        method: 'POST',
        body: JSON.stringify({
          repoUrl: targetUrl,
          limit,
          stateFilter,
        }),
      });
      setReport(data);
      setVerdictFilter('ALL');
      setSearchQuery('');
      setSelectedPrNumber(data.results[0]?.prNumber ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan GitHub repository.');
    } finally {
      setScanning(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runScan();
  };

  const filteredResults = useMemo(() => {
    if (!report) return [];
    const q = searchQuery.trim().toLowerCase();
    return report.results.filter((pr) => {
      if (verdictFilter !== 'ALL' && pr.verdict !== verdictFilter) return false;
      if (!q) return true;
      return (
        String(pr.prNumber).includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        pr.authorHandle.toLowerCase().includes(q) ||
        pr.filesChanged.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [report, verdictFilter, searchQuery]);

  const activePr: ScannedPrResult | undefined =
    filteredResults.find((p) => p.prNumber === selectedPrNumber) ?? filteredResults[0];

  const handleVouchContributor = async (status: 'vouched' | 'denounced') => {
    if (!activePr || !report) return;
    setActionBusy(true);
    setActionNotice(null);
    try {
      const reason =
        status === 'vouched'
          ? `Vouched from live scan of ${report.repoFullName} #${activePr.prNumber}`
          : `Denounced from live scan of ${report.repoFullName} #${activePr.prNumber}`;
      await onVouchAction(activePr.authorHandle, status, reason);
      setActionNotice(
        `Saved ${status === 'vouched' ? 'vouch' : 'denouncement'} for @${activePr.authorHandle}. Re-scan to apply it to this report.`
      );
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Repository Input & Scan Configuration */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Live Open-Source GitHub Pull Request Scanner
          </h2>
          <p className="text-xs text-slate-600 max-w-3xl">
            Enter any public GitHub repository URL or <span className="font-mono">owner/repo</span> slug to inspect its latest pull requests in real time. Each PR is classified into{' '}
            <span className="font-medium text-emerald-700">Genuine</span>,{' '}
            <span className="font-medium text-amber-700">Newcomer Review</span>, or{' '}
            <span className="font-medium text-red-700">Not Genuine</span> using diff safety checks, repository file overlap, SimHash duplicate clustering, and contributor history.
          </p>
        </div>

        <form onSubmit={handleFormSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <label className="lg:col-span-6 space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700">GitHub Repository URL or Slug</span>
            <div className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo or owner/repo"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </label>

          <label className="lg:col-span-2 space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700">Latest PRs (1–20)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) {
                  setLimit(Math.min(20, Math.max(1, val)));
                }
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-500 font-mono tabular-nums"
            />
          </label>

          <label className="lg:col-span-2 space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700">PR State</span>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value === 'open' ? 'open' : 'all')}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Recent (Open & Closed)</option>
              <option value="open">Open PRs Only</option>
            </select>
          </label>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={scanning}
              className="w-full py-2 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {scanning ? 'Scanning PRs...' : 'Scan Pull Requests'}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-500">Quick public repositories:</span>
          {EXAMPLE_REPOS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={scanning}
              onClick={() => {
                setRepoUrl(ex.value);
                void runScan(ex.value);
              }}
              className="px-2.5 py-1 font-mono text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
      </section>

      {/* Loading Skeleton */}
      {scanning && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-white border border-slate-200 rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
        </div>
      )}

      {/* Empty Initial State */}
      {!scanning && !report && (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
            <GitPullRequest className="w-5 h-5" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-semibold text-slate-900">
              Ready to Inspect Live Pull Requests
            </h3>
            <p className="text-xs text-slate-500">
              Choose a repository above or paste any public GitHub repository URL to classify its latest pull requests in real time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runScan()}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Scan {repoUrl.replace(/^https?:\/\/github\.com\//i, '')}
          </button>
        </div>
      )}

      {/* Scan Report */}
      {!scanning && report && (
        <div className="space-y-6">
          {/* Repository Metadata Header */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <a
                  href={report.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-semibold text-slate-900 hover:text-blue-600 inline-flex items-center gap-1"
                >
                  {report.repoFullName}
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-600 tabular-nums">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  {report.stars.toLocaleString()} stars
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-xs text-slate-600 font-mono">
                  branch {report.defaultBranch}
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-xs text-slate-600 tabular-nums">
                  {report.repoFilesIndexed.toLocaleString()} repo files indexed
                </span>
              </div>
              {report.description && (
                <p className="text-xs text-slate-500 truncate max-w-3xl">{report.description}</p>
              )}
            </div>

            <div className="text-xs text-slate-500 shrink-0 space-y-0.5 md:text-right">
              <div>
                {report.vouchedTdFound
                  ? `VOUCHED.td detected (${report.vouchedTdCount} entries)`
                  : 'No VOUCHED.td in repo (using diff & profile analysis)'}
              </div>
              <div className="tabular-nums">
                Scanned {report.scannedCount} of {report.requestedCount} requested PRs
                {report.dataSource === 'github_web_git' ? ' · Web/Git fallback' : ''}
              </div>
            </div>
          </div>

          {/* 4-Column Category Breakdown Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Pull Requests Scanned</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                  {report.scannedCount}
                </span>
                <span className="text-xs text-slate-500">
                  {report.stateFilter === 'open' ? 'open PRs' : 'latest PRs'}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Genuine Contributions</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
                  {report.summary.genuine}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {report.scannedCount
                    ? `${Math.round((report.summary.genuine / report.scannedCount) * 100)}%`
                    : '0%'}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Needs Newcomer Review</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-amber-700 tabular-nums">
                  {report.summary.newcomerReview}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {report.scannedCount
                    ? `${Math.round((report.summary.newcomerReview / report.scannedCount) * 100)}%`
                    : '0%'}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Not Genuine / Flagged</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-red-700 tabular-nums">
                  {report.summary.notGenuine}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {report.scannedCount
                    ? `${Math.round((report.summary.notGenuine / report.scannedCount) * 100)}%`
                    : '0%'}
                </span>
              </div>
            </div>
          </div>

          {/* Filter & Search Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
              {(
                [
                  { key: 'ALL', label: `All (${report.scannedCount})` },
                  { key: 'GENUINE', label: `Genuine (${report.summary.genuine})` },
                  { key: 'NEWCOMER_REVIEW', label: `Newcomer Review (${report.summary.newcomerReview})` },
                  { key: 'NOT_GENUINE', label: `Not Genuine (${report.summary.notGenuine})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setVerdictFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    verdictFilter === tab.key
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
                placeholder="Filter PR #, handle, title, or file..."
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Split View: Results Table + Evidence Drawer */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Pull Request</th>
                      <th className="py-2.5 px-3">Author</th>
                      <th className="py-2.5 px-3">Impact</th>
                      <th className="py-2.5 px-4">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredResults.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 px-4 text-center text-slate-500">
                          {report.scannedCount === 0
                            ? 'No pull requests matched this state filter in the repository.'
                            : 'No scanned pull requests match the current filter.'}
                        </td>
                      </tr>
                    ) : (
                      filteredResults.map((pr) => {
                        const meta = VERDICT_META[pr.verdict];
                        const VerdictIcon = meta.Icon;
                        const imp = IMPORTANCE_LABEL[pr.projectImportance];
                        const isSelected = activePr?.prNumber === pr.prNumber;

                        return (
                          <tr
                            key={pr.prNumber}
                            onClick={() => setSelectedPrNumber(pr.prNumber)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-3 px-4 max-w-xs">
                              <div className="font-medium text-slate-900 truncate">{pr.title}</div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 truncate">
                                <span className="font-mono tabular-nums">#{pr.prNumber}</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {pr.merged ? 'Merged' : pr.state === 'open' ? 'Open' : 'Closed'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  {pr.filesChanged.length} file{pr.filesChanged.length === 1 ? '' : 's'}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="font-mono text-xs text-slate-900">@{pr.authorHandle}</div>
                              <div className="text-xs text-slate-500 tabular-nums">
                                {pr.authorType === 'Bot'
                                  ? 'Bot'
                                  : pr.accountAgeDays !== null
                                    ? `${pr.accountAgeDays}d · ${pr.authorAssociation}`
                                    : pr.authorAssociation}
                              </div>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap text-xs">
                              <span className={imp.className}>{imp.text}</span>
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

            {/* Category & Evidence Inspector */}
            <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
              {!activePr ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  Select a scanned pull request to inspect why it falls under Genuine, Newcomer Review, or Not Genuine.
                </div>
              ) : (
                <>
                  <div className="space-y-2 border-b border-slate-200 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {activePr.merged ? (
                          <GitMerge className="w-3.5 h-3.5 text-purple-600" />
                        ) : (
                          <GitPullRequest className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <a
                          href={activePr.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono tabular-nums text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          PR #{activePr.prNumber}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <span aria-hidden="true">·</span>
                        <span>
                          {activePr.merged
                            ? 'Merged'
                            : activePr.state === 'open'
                              ? 'Open'
                              : 'Closed'}
                        </span>
                      </div>

                      {(() => {
                        const meta = VERDICT_META[activePr.verdict];
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
                      <a
                        href={activePr.authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-slate-800 hover:text-blue-600"
                      >
                        @{activePr.authorHandle}
                      </a>
                      <span aria-hidden="true">·</span>
                      <span>{activePr.authorAssociation}</span>
                      {activePr.accountAgeDays !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{activePr.accountAgeDays}d active</span>
                        </>
                      )}
                      {activePr.publicRepos !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{activePr.publicRepos} public repos</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        SimHash {activePr.simhashHex.slice(0, 8)}
                      </span>
                    </div>
                  </div>

                  {/* Category Rationale */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-700">
                      Category Classification Evidence
                    </h4>

                    {activePr.notGenuineReasons.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-red-700">
                          Risk & Spam Signals
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {activePr.notGenuineReasons.map((reason, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activePr.reviewNotes.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-amber-700">
                          Maintainer Review Notes
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {activePr.reviewNotes.map((note, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activePr.genuineReasons.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-emerald-700">
                          Genuine & Positive Signals
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {activePr.genuineReasons.map((reason, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Project Importance & Overlap */}
                  <div className="border-t border-slate-100 pt-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Project Impact Assessment</span>
                      <span className={IMPORTANCE_LABEL[activePr.projectImportance].className}>
                        {IMPORTANCE_LABEL[activePr.projectImportance].text}
                      </span>
                    </div>
                    <p className="text-slate-600">{activePr.importanceReason}</p>
                    {activePr.duplicatePrNumbers.length > 0 && (
                      <p className="text-slate-700">
                        Similar to PR{' '}
                        <span className="font-mono">
                          {activePr.duplicatePrNumbers.map((n) => `#${n}`).join(', ')}
                        </span>{' '}
                        ({activePr.similarityPercent}% SimHash match).
                      </p>
                    )}
                  </div>

                  {/* Static Findings & Positive Signals */}
                  {(activePr.diffFindings.length > 0 || activePr.positiveSignals.length > 0) && (
                    <div className="space-y-2 border-t border-slate-100 pt-4">
                      <h4 className="text-xs font-semibold text-slate-700">
                        Static Code & Diff Checks
                      </h4>
                      {activePr.diffFindings.map((f, idx) => (
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
                      {activePr.positiveSignals.map((sig) => (
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

                  {/* Diff Preview */}
                  <div className="space-y-1.5 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                        Diff Preview
                      </span>
                      {activePr.filesChanged.length > 0 && (
                        <span className="font-mono truncate max-w-[240px]">
                          {activePr.filesChanged.join(', ')}
                        </span>
                      )}
                    </div>
                    <pre className="p-3 rounded-md bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed max-h-48 whitespace-pre-wrap">
                      {activePr.diffPreview || '(No unified diff text returned for this pull request)'}
                    </pre>
                  </div>

                  {/* Quick Trust Actions */}
                  <div className="border-t border-slate-200 pt-4 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleVouchContributor('vouched')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Vouch @{activePr.authorHandle}
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleVouchContributor('denounced')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        Denounce @{activePr.authorHandle}
                      </button>
                    </div>
                    {actionNotice && (
                      <div className="text-xs text-emerald-700">{actionNotice}</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
