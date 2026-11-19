import { detectCrossProjectCampaigns, formatSimHashHex } from './campaignDetector.ts';
import { analyzePullRequestDiff } from './diffAnalyzer.ts';
import { computeAsymmetricReputations } from './reputationEngine.ts';
import { computeObserverTrustMap, evaluateContributorTrustPaths } from './trustGraph.ts';
import type { ComputedProjectTrust } from './trustGraph.ts';
import type {
  AppealRecord,
  BenchmarkMetrics,
  CampaignCluster,
  DiffFinding,
  EvaluationResult,
  PositiveCodeSignal,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  TrustVerdict,
  VouchEntry,
  VoucherReputation,
} from './types.ts';

export function evaluatePullRequestStream(
  observerProjectId: string,
  prs: PullRequestEvent[],
  projects: ProjectNode[],
  vouchEntries: VouchEntry[],
  appeals: AppealRecord[],
  globalPolicy: ProjectPolicy,
  referenceNowIso: string
): {
  evaluations: EvaluationResult[];
  clusters: CampaignCluster[];
  metrics: BenchmarkMetrics;
  projectReputations: VoucherReputation[];
  contributorReputations: VoucherReputation[];
  trustMap: Map<string, ComputedProjectTrust>;
} {
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const observerProject = projectsById.get(observerProjectId);
  // Support per-project policy overrides while falling back to default globalPolicy
  const policy: ProjectPolicy = {
    ...globalPolicy,
    ...(observerProject?.policy ?? {}),
  };
  const referenceNowMs = Date.parse(referenceNowIso);

  // 1. Pre-scan all PR/Issue diffs & run privacy-preserving SimHash campaign clustering
  const diffFindingsByPrId = new Map<string, DiffFinding[]>();
  const positiveSignalsByPrId = new Map<string, PositiveCodeSignal[]>();
  for (const pr of prs) {
    const { findings, positiveSignals } = analyzePullRequestDiff(pr);
    diffFindingsByPrId.set(pr.id, findings);
    positiveSignalsByPrId.set(pr.id, positiveSignals);
  }

  const { prSimhashes, clusters, prToCluster } = detectCrossProjectCampaigns(
    prs,
    projectsById,
    vouchEntries,
    policy
  );

  // 2. Compute asymmetric Voucher Credibility (slow gain, fast slash),
  //    24h Vouch Budget Dilution, Burst Quarantine, and account-level Sybil rings
  const reputationCtx = computeAsymmetricReputations(
    projects,
    vouchEntries,
    prs,
    diffFindingsByPrId,
    prToCluster,
    policy,
    referenceNowMs
  );

  // 2b. Compute observer trust map once — reused for all PR evaluations (not per-PR)
  const trustMap = computeObserverTrustMap(
    observerProjectId,
    projects,
    vouchEntries,
    policy,
    reputationCtx
  );

  // 3. Evaluate each incoming PR / Issue
  const evaluations: EvaluationResult[] = prs.map((pr) => {
    const trust = evaluateContributorTrustPaths(
      pr,
      observerProjectId,
      projects,
      vouchEntries,
      appeals,
      policy,
      referenceNowMs,
      reputationCtx,
      trustMap
    );

    const findings = diffFindingsByPrId.get(pr.id) ?? [];
    const positiveSignals = positiveSignalsByPrId.get(pr.id) ?? [];
    const cluster = prToCluster.get(pr.id) ?? null;
    const isActiveCampaign = Boolean(cluster?.isActiveCampaign);

    const hasHighDiffRisk = findings.some((f) => f.severity === 'high');
    const hasMediumDiffRisk = findings.some((f) => f.severity === 'medium');

    const hasCorroboratedDenouncement =
      trust.directDenounceOverride ||
      (trust.corroboratingDenounceProjects >= policy.minDenounceCorroboration &&
        trust.denounceWeightSum >= policy.denounceBlockThreshold);

    const evidenceReasons: string[] = [];
    let verdict: TrustVerdict = 'NEWCOMER_REVIEW';

    if (hasHighDiffRisk) {
      verdict = 'FLAGGED';
      evidenceReasons.push(
        `High-severity static finding: ${findings
          .filter((f) => f.severity === 'high')
          .map((f) => f.ruleId)
          .join(', ')}.`
      );
    }

    if (isActiveCampaign && cluster) {
      verdict = 'FLAGGED';
      if (cluster.clusterType === 'same_repo_duplicate') {
        evidenceReasons.push(
          `Duplicate submission cluster ${cluster.clusterId} inside ${cluster.projectNames[0]} (${cluster.prIds.length} near-identical items within ${cluster.windowMinutes}m, ${cluster.similarityPercent}% SimHash match).`
        );
      } else {
        evidenceReasons.push(
          `Matches cross-project spam wave ${cluster.clusterId} (${cluster.projectIds.length} projects within ${cluster.windowMinutes}m · ${cluster.youngAccountCount} fresh accounts · ${cluster.similarityPercent}% SimHash match).`
        );
      }
    }

    if (hasCorroboratedDenouncement) {
      verdict = 'FLAGGED';
      evidenceReasons.push(
        `Denounced by ${trust.corroboratingDenounceProjects} trusted project(s) with effective weight ${trust.denounceWeightSum} (threshold ${policy.denounceBlockThreshold}).`
      );
    }

    if (verdict !== 'FLAGGED') {
      if (
        trust.netTrustScore >= policy.vouchThreshold &&
        !hasMediumDiffRisk &&
        trust.denounceWeightSum < 0.25
      ) {
        verdict = 'VOUCHED';
        const topPath = trust.paths.find((p) => p.status === 'vouched' && p.decayedWeight > 0);
        if (topPath) {
          evidenceReasons.push(
            `Vouched via ${topPath.path.join(' -> ')} (credibility ${topPath.voucherCredibility.toFixed(
              2
            )}, dilution ${topPath.dilutionFactor}x, net weight ${topPath.decayedWeight}).`
          );
        }
      } else {
        verdict = 'NEWCOMER_REVIEW';
        if (trust.burstVouchBlocked) {
          evidenceReasons.push(
            'Peer vouch blocked by Burst Circuit Breaker (sudden high-volume vouching of fresh accounts); routed to Newcomer Review instead of Vouched.'
          );
        }
        if (trust.freshAccountCapped) {
          evidenceReasons.push(
            `Fresh-account cap applied (<${policy.freshAccountAgeDays}d old, 0 prior PRs): requires 2+ independent sources or 1 merged PR before Vouched fast-track.`
          );
        }
        if (trust.hostileDenouncementIgnored) {
          evidenceReasons.push(
            'Unilateral denouncement from anomalous/untrusted project was damped — contributor kept in fair Newcomer Review.'
          );
        }
        if (trust.sybilVouchIgnored) {
          evidenceReasons.push(
            'Inbound vouch from isolated Sybil ring ignored (zero seed trust path); routed to neutral Newcomer Review.'
          );
        }
        if (positiveSignals.length > 0) {
          evidenceReasons.push(
            `No flags or campaign match; positive code signals detected (${positiveSignals
              .map((s) => s.signalId)
              .join(', ')}).`
          );
        } else if (evidenceReasons.length === 0) {
          evidenceReasons.push(
            'No prior vouches or denouncements in trusted network; given fair newcomer review without auto-blocking.'
          );
        }
        if (hasMediumDiffRisk) {
          evidenceReasons.push(
            `Elevated review note: ${findings.map((f) => f.ruleId).join(', ')}.`
          );
        }
      }
    }

    return {
      prId: pr.id,
      verdict,
      netTrustScore: trust.netTrustScore,
      sybilRiskFlag: trust.sybilVouchIgnored,
      hostileDenouncementIgnored: trust.hostileDenouncementIgnored,
      burstVouchBlocked: trust.burstVouchBlocked,
      freshAccountCapped: trust.freshAccountCapped,
      trustPaths: trust.paths,
      corroboratingDenounceProjects: trust.corroboratingDenounceProjects,
      diffFindings: findings,
      positiveSignals,
      campaignCluster: cluster,
      simhashHex: prSimhashes.get(pr.id) ?? formatSimHashHex(0n),
      evidenceReasons,
      evaluatedAt: referenceNowIso,
    };
  });

  const evalMap = new Map(evaluations.map((e) => [e.prId, e]));
  const campaignPrs = prs.filter((p) => p.groundTruth === 'campaign_spam');
  const campaignPrsCaught = campaignPrs.filter(
    (p) => evalMap.get(p.id)?.verdict === 'FLAGGED'
  ).length;

  const maliciousPrs = prs.filter((p) => p.groundTruth === 'malicious_code');
  const maliciousCaught = maliciousPrs.filter(
    (p) => evalMap.get(p.id)?.verdict === 'FLAGGED'
  ).length;

  const rogueFakePrs = prs.filter((p) => p.groundTruth === 'rogue_fake_account');
  const rogueFakeAccountsBlockedFromVouch = rogueFakePrs.filter(
    (p) => evalMap.get(p.id)?.verdict !== 'VOUCHED'
  ).length;

  const newcomers = prs.filter((p) => p.groundTruth === 'genuine_newcomer');
  const newcomersAllowed = newcomers.filter(
    (p) => evalMap.get(p.id)?.verdict !== 'FLAGGED'
  ).length;

  const falselyDenounced = prs.filter((p) => p.groundTruth === 'falsely_denounced');
  const falselyDenouncedProtected = falselyDenounced.filter(
    (p) => evalMap.get(p.id)?.verdict !== 'FLAGGED'
  ).length;

  const trustedRegulars = prs.filter((p) => p.groundTruth === 'trusted_regular');
  const trustedFastTracked = trustedRegulars.filter(
    (p) => evalMap.get(p.id)?.verdict === 'VOUCHED'
  ).length;

  const sybilNodesNeutralized =
    projects.filter((p) => p.isSybilCluster).length +
    reputationCtx.accountSybilRingMembers.size;

  const falsePositiveCount = [...newcomers, ...trustedRegulars, ...falselyDenounced].filter(
    (p) => evalMap.get(p.id)?.verdict === 'FLAGGED'
  ).length;

  const metrics: BenchmarkMetrics = {
    totalEvaluated: prs.length,
    campaignPrsTotal: campaignPrs.length,
    campaignPrsCaught,
    campaignRecallPercent: campaignPrs.length
      ? Math.round((campaignPrsCaught / campaignPrs.length) * 100)
      : 100,
    maliciousCodeTotal: maliciousPrs.length,
    maliciousCodeCaught: maliciousCaught,
    rogueFakeAccountsTotal: rogueFakePrs.length,
    rogueFakeAccountsBlockedFromVouch,
    genuineNewcomersTotal: newcomers.length,
    genuineNewcomersAllowed: newcomersAllowed,
    newcomerInclusionPercent: newcomers.length
      ? Math.round((newcomersAllowed / newcomers.length) * 100)
      : 100,
    falselyDenouncedTotal: falselyDenounced.length,
    falselyDenouncedProtected,
    trustedRegularsTotal: trustedRegulars.length,
    trustedRegularsFastTracked: trustedFastTracked,
    sybilNodesNeutralized,
    falsePositiveCount,
  };

  const projectReputations = Array.from(reputationCtx.projectReputations.values()).sort(
    (a, b) => b.credibilityScore - a.credibilityScore
  );
  const contributorReputations = Array.from(reputationCtx.contributorReputations.values())
    .filter(
      (r) =>
        r.correctVouches > 0 ||
        r.badVouches > 0 ||
        r.baseTrust > 0 ||
        reputationCtx.accountSybilRingMembers.has(r.entityId)
    )
    .sort((a, b) => b.credibilityScore - a.credibilityScore);

  return { evaluations, clusters, metrics, projectReputations, contributorReputations, trustMap };
}
