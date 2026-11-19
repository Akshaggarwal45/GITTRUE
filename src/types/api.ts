import type {
  AppealRecord,
  AuditLogEntry,
  BenchmarkMetrics,
  CampaignCluster,
  EvaluationResult,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  VouchEntry,
  VoucherReputation,
} from '../engine/types.ts';

export interface ComputedProjectTrust {
  projectId: string;
  effectiveTrust: number;
  bestPath: string[];
  hops: number;
  isSybilIsolated: boolean;
  isFlaggedHostile: boolean;
  isBurstQuarantined: boolean;
}

export interface NetworkSnapshot {
  observerProjectId: string;
  projects: ProjectNode[];
  projectTrust: ComputedProjectTrust[];
  vouchEntries: VouchEntry[];
  pullRequests: PullRequestEvent[];
  evaluations: EvaluationResult[];
  clusters: CampaignCluster[];
  appeals: AppealRecord[];
  auditLog: AuditLogEntry[];
  policy: ProjectPolicy;
  metrics: BenchmarkMetrics;
  projectReputations: VoucherReputation[];
  contributorReputations: VoucherReputation[];
  referenceNowIso: string;
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
