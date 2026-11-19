import type { ReputationContext } from './reputationEngine.ts';
import type {
  AppealRecord,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  TrustPathExplanation,
  VouchEntry,
} from './types.ts';

export interface ComputedProjectTrust {
  projectId: string;
  effectiveTrust: number;
  bestPath: string[];
  hops: number;
  isSybilIsolated: boolean;
  isFlaggedHostile: boolean;
  isBurstQuarantined: boolean;
}

/**
 * Computes directed, hop-decayed, Sybil-resistant trust scores from the perspective
 * of `observerProjectId`, factoring in asymmetric Voucher Credibility, 24h Vouch Budget
 * dilution, and Burst Circuit Breakers.
 */
export function computeObserverTrustMap(
  observerProjectId: string,
  projects: ProjectNode[],
  vouchEntries: VouchEntry[],
  policy: ProjectPolicy,
  reputationCtx?: ReputationContext
): Map<string, ComputedProjectTrust> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const result = new Map<string, ComputedProjectTrust>();

  const entriesByProject = new Map<string, VouchEntry[]>();
  for (const entry of vouchEntries) {
    const arr = entriesByProject.get(entry.projectId) ?? [];
    arr.push(entry);
    entriesByProject.set(entry.projectId, arr);
  }

  const isHostileProject = (p: ProjectNode): boolean => {
    if (p.isHostile) return true;
    const list = entriesByProject.get(p.id) ?? [];
    const denounces = list.filter((e) => e.status === 'denounced').length;
    const total = Math.max(1, p.vouchedCountBase + p.denouncedCountBase + list.length);
    return denounces >= 3 && denounces / total > 0.45;
  };

  const inboundFromSeedCount = new Map<string, number>();
  for (const p of projects) {
    if (!p.isSeedTrusted && p.id !== observerProjectId) continue;
    for (const edge of p.trustEdges) {
      if (edge.weight >= policy.sybilMinSeedReach) {
        inboundFromSeedCount.set(
          edge.targetProjectId,
          (inboundFromSeedCount.get(edge.targetProjectId) ?? 0) + 1
        );
      }
    }
  }

  interface QueueItem {
    projectId: string;
    trust: number;
    path: string[];
    hops: number;
  }

  const bestTrust = new Map<string, { trust: number; path: string[]; hops: number }>();
  bestTrust.set(observerProjectId, {
    trust: 1.0,
    path: [observerProjectId],
    hops: 0,
  });

  const queue: QueueItem[] = [
    { projectId: observerProjectId, trust: 1.0, path: [observerProjectId], hops: 0 },
  ];

  while (queue.length > 0) {
    queue.sort((a, b) => b.trust - a.trust);
    const current = queue.shift()!;

    if (current.hops >= policy.maxHops) continue;
    const node = byId.get(current.projectId);
    if (!node) continue;

    for (const edge of node.trustEdges) {
      if (current.path.includes(edge.targetProjectId)) continue;
      const target = byId.get(edge.targetProjectId);
      if (!target) continue;

      const hostileDamp = isHostileProject(target) ? 0.15 : 1.0;
      const hopMultiplier = current.hops === 0 ? 1.0 : policy.hopDecay;
      const nextTrust = Number((current.trust * edge.weight * hopMultiplier * hostileDamp).toFixed(4));

      if (nextTrust < 0.02) continue;

      const existing = bestTrust.get(edge.targetProjectId);
      if (!existing || nextTrust > existing.trust) {
        const nextPath = [...current.path, edge.targetProjectId];
        bestTrust.set(edge.targetProjectId, {
          trust: nextTrust,
          path: nextPath,
          hops: current.hops + 1,
        });
        queue.push({
          projectId: edge.targetProjectId,
          trust: nextTrust,
          path: nextPath,
          hops: current.hops + 1,
        });
      }
    }
  }

  for (const p of projects) {
    const found = bestTrust.get(p.id);
    const hasSeedInbound =
      p.isSeedTrusted ||
      p.id === observerProjectId ||
      (inboundFromSeedCount.get(p.id) ?? 0) > 0;
    const sybilIsolated = Boolean(p.isSybilCluster) || (!found && !hasSeedInbound);
    const rep = reputationCtx?.projectReputations.get(p.id);

    result.set(p.id, {
      projectId: p.id,
      effectiveTrust: sybilIsolated ? 0 : found?.trust ?? 0,
      bestPath: found?.path ?? [],
      hops: found?.hops ?? -1,
      isSybilIsolated: sybilIsolated,
      isFlaggedHostile: isHostileProject(p),
      isBurstQuarantined: Boolean(rep?.burstQuarantined),
    });
  }

  return result;
}

export function evaluateContributorTrustPaths(
  pr: PullRequestEvent,
  observerProjectId: string,
  projects: ProjectNode[],
  vouchEntries: VouchEntry[],
  appeals: AppealRecord[],
  policy: ProjectPolicy,
  referenceNowMs: number,
  reputationCtx: ReputationContext,
  precomputedTrustMap?: Map<string, ComputedProjectTrust>
): {
  netTrustScore: number;
  vouchWeightSum: number;
  denounceWeightSum: number;
  corroboratingDenounceProjects: number;
  independentVouchSources: number;
  directDenounceOverride: boolean;
  hostileDenouncementIgnored: boolean;
  sybilVouchIgnored: boolean;
  burstVouchBlocked: boolean;
  freshAccountCapped: boolean;
  paths: TrustPathExplanation[];
} {
  const normalizedHandle = pr.authorHandle.toLowerCase();
  const projectTrustMap = precomputedTrustMap ?? computeObserverTrustMap(
    observerProjectId,
    projects,
    vouchEntries,
    policy,
    reputationCtx
  );
  const byId = new Map(projects.map((p) => [p.id, p]));

  const matchingEntries = vouchEntries.filter(
    (e) => e.contributorHandle.toLowerCase() === normalizedHandle
  );

  const paths: TrustPathExplanation[] = [];
  let vouchWeightSum = 0;
  let denounceWeightSum = 0;
  const corroboratingDenounceSet = new Set<string>();
  const independentVouchSet = new Set<string>();
  let directDenounceOverride = false;
  let hostileDenouncementIgnored = false;
  let sybilVouchIgnored = false;
  let burstVouchBlocked = false;

  const window24hMs = 24 * 60 * 60 * 1000;

  for (const entry of matchingEntries) {
    const pTrust = projectTrustMap.get(entry.projectId);
    const sourceProj = byId.get(entry.projectId);
    if (!pTrust || !sourceProj) continue;

    const appeal = appeals.find(
      (a) =>
        a.contributorHandle.toLowerCase() === normalizedHandle &&
        a.denouncedByProjectId === entry.projectId
    );
    if (appeal?.status === 'overturned') {
      continue;
    }

    if (pTrust.isSybilIsolated && entry.status === 'vouched') {
      sybilVouchIgnored = true;
      continue;
    }

    // Handle user-to-user vouch (Person B -> Person A)
    if (entry.voucherHandle && entry.status === 'vouched') {
      const voucherLower = entry.voucherHandle.toLowerCase();
      if (reputationCtx.accountSybilRingMembers.has(voucherLower)) {
        sybilVouchIgnored = true;
        continue;
      }
      const voucherRep = reputationCtx.contributorReputations.get(voucherLower);
      if (!voucherRep || voucherRep.baseTrust <= 0 || pTrust.effectiveTrust <= 0) {
        continue;
      }

      const ageMs = referenceNowMs - Date.parse(entry.createdAt);
      const isRecent24h = ageMs >= 0 && ageMs <= window24hMs;
      const blockedByBurst = voucherRep.burstQuarantined && isRecent24h;
      if (blockedByBurst) burstVouchBlocked = true;

      const rawWeight = Number(
        (pTrust.effectiveTrust * voucherRep.baseTrust * voucherRep.credibilityScore).toFixed(3)
      );
      const effectiveDecayed = blockedByBurst
        ? 0
        : Number((rawWeight * voucherRep.dilutionFactor).toFixed(3));

      paths.push({
        sourceProjectId: entry.projectId,
        sourceProjectName: sourceProj.name,
        voucherHandle: voucherLower,
        path: [...pTrust.bestPath.map((id) => byId.get(id)?.name ?? id), `@${voucherLower}`],
        effectiveWeight: pTrust.effectiveTrust,
        rawWeight,
        voucherCredibility: voucherRep.credibilityScore,
        dilutionFactor: voucherRep.dilutionFactor,
        burstBlocked: blockedByBurst,
        status: 'vouched',
        reason: entry.reason,
        createdAt: entry.createdAt,
        decayedWeight: effectiveDecayed,
        isDisputed: false,
      });

      if (effectiveDecayed > 0) {
        vouchWeightSum += effectiveDecayed;
        independentVouchSet.add(`user:${voucherLower}`);
      }
      continue;
    }

    // Project-level vouch or denouncement
    if (pTrust.effectiveTrust <= 0) {
      if (entry.status === 'denounced' && pTrust.isFlaggedHostile) {
        hostileDenouncementIgnored = true;
      }
      continue;
    }

    const ageMs = referenceNowMs - Date.parse(entry.createdAt);
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

    if (entry.status === 'vouched') {
      const projRep = reputationCtx.projectReputations.get(entry.projectId);
      const cred = projRep?.credibilityScore ?? 0.65;
      const dilution = projRep?.dilutionFactor ?? 1.0;
      const isRecent24h = ageMs >= 0 && ageMs <= window24hMs;
      const isBurstBlocked = Boolean(projRep?.burstQuarantined) && isRecent24h;
      if (isBurstBlocked) {
        burstVouchBlocked = true;
      }

      const effectiveWeight = isBurstBlocked
        ? 0
        : Number((pTrust.effectiveTrust * cred * dilution).toFixed(3));

      paths.push({
        sourceProjectId: entry.projectId,
        sourceProjectName: sourceProj.name,
        path: pTrust.bestPath.map((id) => byId.get(id)?.name ?? id),
        effectiveWeight: pTrust.effectiveTrust,
        rawWeight: pTrust.effectiveTrust,
        voucherCredibility: cred,
        dilutionFactor: dilution,
        burstBlocked: isBurstBlocked,
        status: 'vouched',
        reason: entry.reason,
        createdAt: entry.createdAt,
        decayedWeight: effectiveWeight,
        isDisputed: false,
      });

      if (effectiveWeight > 0) {
        vouchWeightSum += effectiveWeight;
        independentVouchSet.add(`project:${entry.projectId}`);
      }
    } else {
      // Denouncement with time decay + hostile damping + pending appeal damping
      const timeFactor = Math.pow(0.5, ageDays / Math.max(1, policy.denounceHalfLifeDays));
      const hostileCap = pTrust.isFlaggedHostile ? 0.25 : 1.0;
      if (pTrust.isFlaggedHostile) {
        hostileDenouncementIgnored = true;
      }
      const disputeFactor = appeal?.status === 'pending' ? 0.5 : 1.0;
      const decayedWeight = Number(
        (pTrust.effectiveTrust * timeFactor * hostileCap * disputeFactor).toFixed(3)
      );

      paths.push({
        sourceProjectId: entry.projectId,
        sourceProjectName: sourceProj.name,
        path: pTrust.bestPath.map((id) => byId.get(id)?.name ?? id),
        effectiveWeight: pTrust.effectiveTrust,
        rawWeight: pTrust.effectiveTrust,
        voucherCredibility: 1.0,
        dilutionFactor: 1.0,
        burstBlocked: false,
        status: 'denounced',
        reason: entry.reason,
        createdAt: entry.createdAt,
        decayedWeight,
        isDisputed: appeal?.status === 'pending',
      });

      denounceWeightSum += decayedWeight;
      if (decayedWeight >= 0.2 && !pTrust.isFlaggedHostile) {
        corroboratingDenounceSet.add(entry.projectId);
      }
      if (
        (entry.projectId === observerProjectId ||
          pTrust.effectiveTrust >= policy.directOverrideThreshold) &&
        decayedWeight >= policy.directOverrideThreshold &&
        appeal?.status !== 'pending'
      ) {
        directDenounceOverride = true;
      }
    }
  }

  // Defense #4: Fresh-account cap (brand-new 0-PR accounts cannot immediately skip Newcomer Review
  // via a single peer vouch; they need >= 2 independent sources or 1 clean merged PR).
  let freshAccountCapped = false;
  const isFreshAccount =
    pr.accountAgeDays < policy.freshAccountAgeDays && pr.publicMergedPrs === 0;
  if (
    isFreshAccount &&
    independentVouchSet.size < 2 &&
    vouchWeightSum >= policy.vouchThreshold
  ) {
    vouchWeightSum = Number((policy.vouchThreshold - 0.05).toFixed(3));
    freshAccountCapped = true;
  }

  const netTrustScore = Number(
    Math.max(-1, Math.min(1, vouchWeightSum - denounceWeightSum)).toFixed(3)
  );

  return {
    netTrustScore,
    vouchWeightSum: Number(vouchWeightSum.toFixed(3)),
    denounceWeightSum: Number(denounceWeightSum.toFixed(3)),
    corroboratingDenounceProjects: corroboratingDenounceSet.size,
    independentVouchSources: independentVouchSet.size,
    directDenounceOverride,
    hostileDenouncementIgnored,
    sybilVouchIgnored,
    burstVouchBlocked,
    freshAccountCapped,
    paths,
  };
}
