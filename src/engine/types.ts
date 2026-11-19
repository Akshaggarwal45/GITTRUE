export type VouchStatus = 'vouched' | 'denounced';

export type SubmissionKind = 'pr' | 'issue';

export type TrustVerdict = 'VOUCHED' | 'NEWCOMER_REVIEW' | 'FLAGGED';

export type GroundTruthCategory =
  | 'trusted_regular'
  | 'genuine_newcomer'
  | 'campaign_spam'
  | 'malicious_code'
  | 'falsely_denounced'
  | 'rogue_fake_account';

export interface TrustEdge {
  targetProjectId: string;
  weight: number; // 0.0 to 1.0
}

export interface ProjectPolicy {
  hopDecay: number; // e.g., 0.65 per hop
  maxHops: number; // e.g., 3
  vouchThreshold: number; // e.g., 0.35
  denounceBlockThreshold: number; // e.g., 0.70
  minDenounceCorroboration: number; // e.g., 2 independent projects unless direct trust >= directOverrideThreshold
  directOverrideThreshold: number; // e.g., 0.90
  denounceHalfLifeDays: number; // e.g., 90 days
  campaignHammingThreshold: number; // e.g., 14 out of 64 bits
  campaignMinProjects: number; // e.g., 3 distinct projects
  campaignWindowHours: number; // e.g., 6 hours
  sybilMinSeedReach: number; // e.g., 0.05
  // Asymmetric reputation & 100-fake-account defenses
  reputationGainRate: number; // slow earn rate, e.g., +0.04 per confirmed good vouch
  reputationSlashRate: number; // fast penalty rate, e.g., -0.22 per bad vouch (5.5x faster than gain)
  vouchBudgetPer24h: number; // normal vouch capacity before dilution kicks in, e.g., 6
  vouchBurstFreezeThreshold: number; // burst circuit breaker threshold, e.g., 10 vouches in 24h
  freshAccountAgeDays: number; // threshold for fresh accounts requiring extra verification, e.g., 14
}

export interface ProjectNode {
  id: string;
  name: string;
  repo: string;
  ecosystem: 'Zig' | 'Rust' | 'TypeScript' | 'Python' | 'Go' | 'C';
  maintainer: string;
  isSeedTrusted: boolean;
  isSybilCluster?: boolean;
  isHostile?: boolean;
  trustEdges: TrustEdge[];
  vouchedCountBase: number;
  denouncedCountBase: number;
  policy?: Partial<ProjectPolicy>;
}

export interface VouchEntry {
  id: string;
  projectId: string;
  voucherHandle?: string; // If present, represents user-to-user vouch (Person B -> Person A)
  contributorHandle: string;
  status: VouchStatus;
  reason?: string;
  evidenceUrl?: string;
  createdAt: string; // ISO timestamp
  expiresAt?: string;
}

export interface PullRequestEvent {
  id: string;
  kind: SubmissionKind;
  prNumber: number;
  projectId: string;
  authorHandle: string;
  accountAgeDays: number;
  publicMergedPrs: number;
  createdAt: string;
  title: string;
  body: string;
  filesChanged: string[];
  diffText: string;
  groundTruth?: GroundTruthCategory;
}

export interface DiffFinding {
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  file: string;
  snippet: string;
  explanation: string;
}

export interface PositiveCodeSignal {
  signalId: string;
  description: string;
}

export interface TrustPathExplanation {
  sourceProjectId: string;
  sourceProjectName: string;
  voucherHandle?: string;
  path: string[];
  effectiveWeight: number;
  rawWeight: number;
  voucherCredibility: number;
  dilutionFactor: number;
  burstBlocked: boolean;
  status: VouchStatus;
  reason?: string;
  createdAt: string;
  decayedWeight: number;
  isDisputed: boolean;
}

export interface CampaignCluster {
  clusterId: string;
  clusterType: 'cross_project' | 'same_repo_duplicate';
  simhashHex: string;
  prIds: string[];
  projectIds: string[];
  projectNames: string[];
  sampleTitle: string;
  maxHammingDistance: number;
  similarityPercent: number;
  windowMinutes: number;
  youngAccountCount: number;
  mutualVouchCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isActiveCampaign: boolean;
}

export interface VoucherReputation {
  entityId: string;
  entityType: 'project' | 'contributor';
  displayName: string;
  baseTrust: number;
  credibilityScore: number; // 0.05 to 1.0 (slow gain, fast slash)
  correctVouches: number;
  badVouches: number;
  recent24hVouches: number;
  freshAccountVouches24h: number;
  dilutionFactor: number; // <= 1.0 (e.g. budget / recent24h)
  burstQuarantined: boolean;
  statusNote: string;
}

export interface EvaluationResult {
  prId: string;
  verdict: TrustVerdict;
  netTrustScore: number; // -1.0 to +1.0
  sybilRiskFlag: boolean;
  hostileDenouncementIgnored: boolean;
  burstVouchBlocked: boolean;
  freshAccountCapped: boolean;
  trustPaths: TrustPathExplanation[];
  corroboratingDenounceProjects: number;
  diffFindings: DiffFinding[];
  positiveSignals: PositiveCodeSignal[];
  campaignCluster: CampaignCluster | null;
  simhashHex: string;
  evidenceReasons: string[];
  evaluatedAt: string;
}

export interface AppealRecord {
  id: string;
  contributorHandle: string;
  denouncedByProjectId: string;
  denouncementReason: string;
  appealStatement: string;
  evidenceUrl: string;
  status: 'pending' | 'overturned' | 'upheld';
  createdAt: string;
  resolvedAt?: string;
  resolverNote?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action:
    | 'vouch'
    | 'denounce'
    | 'appeal_submitted'
    | 'appeal_resolved'
    | 'policy_updated'
    | 'trust_edge_updated'
    | 'vouched_td_imported'
    | 'rogue_attack_simulated';
  target: string;
  details: string;
}

export interface BenchmarkMetrics {
  totalEvaluated: number;
  campaignPrsTotal: number;
  campaignPrsCaught: number;
  campaignRecallPercent: number;
  maliciousCodeTotal: number;
  maliciousCodeCaught: number;
  rogueFakeAccountsTotal: number;
  rogueFakeAccountsBlockedFromVouch: number;
  genuineNewcomersTotal: number;
  genuineNewcomersAllowed: number;
  newcomerInclusionPercent: number;
  falselyDenouncedTotal: number;
  falselyDenouncedProtected: number;
  trustedRegularsTotal: number;
  trustedRegularsFastTracked: number;
  sybilNodesNeutralized: number;
  falsePositiveCount: number;
}

export type RepoScanVerdict = 'GENUINE' | 'NEWCOMER_REVIEW' | 'NOT_GENUINE';

export type ProjectImportance = 'HIGH' | 'MODERATE' | 'LOW';

export interface ScannedPrResult {
  prNumber: number;
  title: string;
  body: string;
  htmlUrl: string;
  state: 'open' | 'closed';
  merged: boolean;
  createdAt: string;
  authorHandle: string;
  authorUrl: string;
  authorType: 'User' | 'Bot';
  authorAssociation: string;
  accountAgeDays: number | null;
  publicRepos: number | null;
  recentPrReposCount: number | null;
  filesChanged: string[];
  diffPreview: string;
  simhashHex: string;
  duplicatePrNumbers: number[];
  similarityPercent: number | null;
  projectImportance: ProjectImportance;
  importanceReason: string;
  similarExistingFiles: string[];
  unwiredNewFiles: string[];
  verdict: RepoScanVerdict;
  genuineReasons: string[];
  notGenuineReasons: string[];
  reviewNotes: string[];
  diffFindings: DiffFinding[];
  positiveSignals: PositiveCodeSignal[];
  vouchedStatus: VouchStatus | null;
}

export interface RepoScanReport {
  repoFullName: string;
  repoUrl: string;
  description: string;
  stars: number;
  defaultBranch: string;
  repoFilesIndexed: number;
  requestedCount: number;
  scannedCount: number;
  stateFilter: 'all' | 'open';
  vouchedTdFound: boolean;
  vouchedTdCount: number;
  rateLimitRemaining: number | null;
  profileLookupSkippedDueToQuota: boolean;
  dataSource?: 'github_api' | 'github_web_git';
  summary: {
    genuine: number;
    newcomerReview: number;
    notGenuine: number;
  };
  scannedAt: string;
  results: ScannedPrResult[];
}
