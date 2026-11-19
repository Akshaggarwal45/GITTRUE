import type {
  CampaignCluster,
  DiffFinding,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  VouchEntry,
  VoucherReputation,
} from './types.ts';

export interface ReputationContext {
  projectReputations: Map<string, VoucherReputation>;
  contributorReputations: Map<string, VoucherReputation>;
  accountSybilRingMembers: Set<string>;
}

/**
 * Computes asymmetric reputation & voucher credibility scores across projects and contributors.
 *
 * Key invariant requested by design:
 *   reputationGainRate (e.g. +0.04) << reputationSlashRate (e.g. -0.22)
 *   Reputation takes sustained verified good vouches to climb, but collapses rapidly
 *   if a voucher endorses spam-campaign accounts, malicious diffs, or dumps a 100-account burst.
 */
export function computeAsymmetricReputations(
  projects: ProjectNode[],
  vouchEntries: VouchEntry[],
  prs: PullRequestEvent[],
  diffFindingsByPrId: Map<string, DiffFinding[]>,
  prToCluster: Map<string, CampaignCluster>,
  policy: ProjectPolicy,
  referenceNowMs: number
): ReputationContext {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const prsByAuthor = new Map<string, PullRequestEvent[]>();
  for (const pr of prs) {
    const handle = pr.authorHandle.toLowerCase();
    const list = prsByAuthor.get(handle) ?? [];
    list.push(pr);
    prsByAuthor.set(handle, list);
  }

  // 1. Detect contributor-to-contributor Sybil mutual-vouch rings
  //    (e.g., fresh accounts vouching for each other with zero seed-project grounding)
  const userVouchGraph = new Map<string, Set<string>>();
  for (const e of vouchEntries) {
    if (e.voucherHandle && e.status === 'vouched') {
      const from = e.voucherHandle.toLowerCase();
      const to = e.contributorHandle.toLowerCase();
      if (from === to) continue;
      const set = userVouchGraph.get(from) ?? new Set<string>();
      set.add(to);
      userVouchGraph.set(from, set);
    }
  }

  const seedGroundedUsers = new Set<string>();
  for (const e of vouchEntries) {
    if (!e.voucherHandle && e.status === 'vouched') {
      const proj = projectById.get(e.projectId);
      if (proj?.isSeedTrusted) {
        seedGroundedUsers.add(e.contributorHandle.toLowerCase());
      }
    }
  }
  for (const pr of prs) {
    if (pr.publicMergedPrs >= 5 && pr.accountAgeDays >= 60) {
      seedGroundedUsers.add(pr.authorHandle.toLowerCase());
    }
  }

  const accountSybilRingMembers = new Set<string>();
  for (const [u, targets] of userVouchGraph.entries()) {
    if (seedGroundedUsers.has(u)) continue;
    for (const v of targets) {
      if (!seedGroundedUsers.has(v) && userVouchGraph.get(v)?.has(u)) {
        accountSybilRingMembers.add(u);
        accountSybilRingMembers.add(v);
      }
    }
  }

  // Helper to judge whether a vouched contributor turned out "good" or "bad"
  const evaluateVouchedOutcome = (
    handle: string,
    vouchingProjectId?: string
  ): 'confirmed_good' | 'confirmed_bad' | 'pending' => {
    const clean = handle.toLowerCase();
    const authorPrs = prsByAuthor.get(clean) ?? [];

    // Bad if flagged by corroborated denouncements in seed projects, active campaign, or high diff risk
    const seedDenounces = vouchEntries.filter(
      (e) =>
        e.contributorHandle.toLowerCase() === clean &&
        e.status === 'denounced' &&
        projectById.get(e.projectId)?.isSeedTrusted
    ).length;

    const hasCampaignOrMalicious = authorPrs.some((p) => {
      const findings = diffFindingsByPrId.get(p.id) ?? [];
      const cluster = prToCluster.get(p.id);
      return (
        findings.some((f) => f.severity === 'high') ||
        Boolean(cluster?.isActiveCampaign)
      );
    });

    if (hasCampaignOrMalicious || seedDenounces >= 2) {
      return 'confirmed_bad';
    }

    // Confirmed good only if they have clean activity in an external seed project (prevents self-dealing)
    // or clean established public merged PR history
    const hasCleanExternalPr = authorPrs.some((p) => {
      const findings = diffFindingsByPrId.get(p.id) ?? [];
      const cluster = prToCluster.get(p.id);
      const proj = projectById.get(p.projectId);
      return (
        p.projectId !== vouchingProjectId &&
        Boolean(proj?.isSeedTrusted) &&
        findings.length === 0 &&
        !cluster?.isActiveCampaign
      );
    });

    if (hasCleanExternalPr || (authorPrs[0]?.publicMergedPrs ?? 0) >= 10) {
      return 'confirmed_good';
    }

    return 'pending';
  };

  const window24hMs = 24 * 60 * 60 * 1000;

  // 2. Compute Project Voucher Credibility, 24h Budget Dilution & Burst Circuit Breaker
  const projectReputations = new Map<string, VoucherReputation>();
  for (const proj of projects) {
    const projectVouches = vouchEntries.filter(
      (e) => e.projectId === proj.id && e.status === 'vouched' && !e.voucherHandle
    );

    let correctVouches = 0;
    let badVouches = 0;
    let recent24hVouches = 0;
    let freshAccountVouches24h = 0;

    for (const v of projectVouches) {
      const outcome = evaluateVouchedOutcome(v.contributorHandle, proj.id);
      if (outcome === 'confirmed_good') correctVouches++;
      else if (outcome === 'confirmed_bad') badVouches++;

      const ageMs = referenceNowMs - Date.parse(v.createdAt);
      if (ageMs >= 0 && ageMs <= window24hMs) {
        recent24hVouches++;
        const authorPr = (prsByAuthor.get(v.contributorHandle.toLowerCase()) ?? [])[0];
        const looksFresh =
          (authorPr && authorPr.accountAgeDays < policy.freshAccountAgeDays && authorPr.publicMergedPrs === 0) ||
          /fake_|sybil_|wave_|bot_/i.test(v.contributorHandle);
        if (looksFresh) {
          freshAccountVouches24h++;
        }
      }
    }

    // Base credibility starts at 0.65 for seed projects, 0.30 for unknown projects, 0.05 for sybil/hostile
    const baseCred = proj.isSybilCluster
      ? 0.0
      : proj.isHostile
        ? 0.15
        : proj.isSeedTrusted
          ? 0.65
          : 0.35;

    // Asymmetric score update: slow positive climb vs rapid slashing
    const rawCred =
      baseCred +
      correctVouches * policy.reputationGainRate -
      badVouches * policy.reputationSlashRate;

    // Vouch-budget dilution: if a project vouches for more than `vouchBudgetPer24h` in 24h,
    // its per-vouch weight dilutes proportionally (e.g., 100 vouches -> 6/100 = 0.06x).
    const dilutionFactor =
      recent24hVouches > policy.vouchBudgetPer24h
        ? Number((policy.vouchBudgetPer24h / recent24hVouches).toFixed(3))
        : 1.0;

    // Burst Circuit Breaker: >= vouchBurstFreezeThreshold in 24h (or >= 6 fresh accounts in 24h)
    const burstQuarantined =
      recent24hVouches >= policy.vouchBurstFreezeThreshold ||
      freshAccountVouches24h >= Math.max(5, Math.floor(policy.vouchBurstFreezeThreshold * 0.6));

    // Additional severe slash if caught in a mass-vouch burst
    const burstPenalty = burstQuarantined ? 0.45 : 0;
    const credibilityScore = proj.isSybilCluster
      ? 0
      : Number(Math.max(0.05, Math.min(1.0, rawCred - burstPenalty)).toFixed(3));

    let statusNote = 'Nominal vouching history';
    if (proj.isSybilCluster) statusNote = 'Isolated Sybil ring (0.00 trust)';
    else if (burstQuarantined) {
      statusNote = `Burst quarantine triggered (${recent24hVouches} vouches in 24h; dilution ${dilutionFactor}x)`;
    } else if (badVouches > 0) {
      statusNote = `Credibility slashed (-${(badVouches * policy.reputationSlashRate).toFixed(2)}) due to ${badVouches} bad vouch(es)`;
    } else if (correctVouches > 0) {
      statusNote = `Earned +${(correctVouches * policy.reputationGainRate).toFixed(2)} across ${correctVouches} verified good vouch(es)`;
    }

    projectReputations.set(proj.id, {
      entityId: proj.id,
      entityType: 'project',
      displayName: proj.name,
      baseTrust: proj.isSeedTrusted ? 0.85 : 0.3,
      credibilityScore,
      correctVouches,
      badVouches,
      recent24hVouches,
      freshAccountVouches24h,
      dilutionFactor,
      burstQuarantined,
      statusNote,
    });
  }

  // 3. Compute Individual Contributor Voucher Credibility (Person B -> Person A)
  const contributorHandles = new Set<string>();
  for (const e of vouchEntries) {
    contributorHandles.add(e.contributorHandle.toLowerCase());
    if (e.voucherHandle) contributorHandles.add(e.voucherHandle.toLowerCase());
  }
  for (const pr of prs) {
    contributorHandles.add(pr.authorHandle.toLowerCase());
  }

  const contributorReputations = new Map<string, VoucherReputation>();
  for (const handle of contributorHandles) {
    const givenVouches = vouchEntries.filter(
      (e) => e.voucherHandle?.toLowerCase() === handle && e.status === 'vouched'
    );
    const authorPrs = prsByAuthor.get(handle) ?? [];
    const maxMerged = authorPrs.reduce((acc, p) => Math.max(acc, p.publicMergedPrs), 0);
    const maxAge = authorPrs.reduce((acc, p) => Math.max(acc, p.accountAgeDays), 0);
    const isSeedVouched = seedGroundedUsers.has(handle);

    let correctVouches = 0;
    let badVouches = 0;
    let recent24hVouches = 0;

    for (const v of givenVouches) {
      const outcome = evaluateVouchedOutcome(v.contributorHandle);
      if (outcome === 'confirmed_good') correctVouches++;
      else if (outcome === 'confirmed_bad') badVouches++;

      const ageMs = referenceNowMs - Date.parse(v.createdAt);
      if (ageMs >= 0 && ageMs <= window24hMs) recent24hVouches++;
    }

    // Check if contributor themselves got flagged
    const selfBad = evaluateVouchedOutcome(handle) === 'confirmed_bad';
    const isSybilUser = accountSybilRingMembers.has(handle);

    // If the ONLY project-level vouches for this contributor come from Sybil-cluster projects,
    // treat the contributor as effectively Sybil-sourced (force baseTrust = 0)
    const projectVouchesForHandle = vouchEntries.filter(
      (e) => e.contributorHandle.toLowerCase() === handle && !e.voucherHandle && e.status === 'vouched'
    );
    const allVouchesFromSybilProjects =
      projectVouchesForHandle.length > 0 &&
      projectVouchesForHandle.every((e) => projectById.get(e.projectId)?.isSybilCluster);
    const effectivelySybilSourced = allVouchesFromSybilProjects && !seedGroundedUsers.has(handle);

    // Base contribution trust (before network paths): grows slowly with merged PRs, drops sharply if bad
    const historyTrust = isSeedVouched
      ? Math.min(0.9, 0.55 + Math.log10(1 + maxMerged) * 0.14)
      : Math.min(0.45, Math.log10(1 + maxMerged) * 0.15 + (maxAge > 90 ? 0.08 : 0));

    const baseTrust =
      isSybilUser || effectivelySybilSourced ? 0 : selfBad ? 0.05 : Number(historyTrust.toFixed(3));

    // Asymmetric credibility: starts modest (0.45 if seed-vouched, 0.20 if unestablished),
    // climbs slowly (+gainRate), slashes fast (-slashRate)
    const startCred = isSybilUser || effectivelySybilSourced ? 0 : isSeedVouched ? 0.5 : 0.2;
    const rawCred =
      startCred +
      correctVouches * policy.reputationGainRate -
      badVouches * policy.reputationSlashRate -
      (selfBad ? policy.reputationSlashRate : 0);

    const dilutionFactor =
      recent24hVouches > Math.max(3, Math.floor(policy.vouchBudgetPer24h / 2))
        ? Number((3 / recent24hVouches).toFixed(3))
        : 1.0;

    const burstQuarantined = recent24hVouches >= policy.vouchBurstFreezeThreshold;
    const credibilityScore =
      isSybilUser || effectivelySybilSourced
        ? 0
        : Number(Math.max(0.05, Math.min(1.0, rawCred)).toFixed(3));

    let statusNote = 'Neutral newcomer';
    if (isSybilUser) statusNote = 'Mutual-vouch Sybil ring member (0.00 trust)';
    else if (effectivelySybilSourced) statusNote = 'All vouches from isolated Sybil projects (0.00 trust)';
    else if (selfBad) statusNote = 'Flagged contributor — vouch credibility slashed';
    else if (badVouches > 0) statusNote = `Slashed for ${badVouches} bad vouch(es)`;
    else if (correctVouches > 0) statusNote = `${correctVouches} verified good vouch(es)`;
    else if (isSeedVouched) statusNote = 'Seed-trusted contributor';

    contributorReputations.set(handle, {
      entityId: handle,
      entityType: 'contributor',
      displayName: `@${handle}`,
      baseTrust,
      credibilityScore,
      correctVouches,
      badVouches,
      recent24hVouches,
      freshAccountVouches24h: 0,
      dilutionFactor,
      burstQuarantined,
      statusNote,
    });
  }

  return {
    projectReputations,
    contributorReputations,
    accountSybilRingMembers,
  };
}
