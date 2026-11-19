import type {
  CampaignCluster,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  VouchEntry,
} from './types.ts';

/**
 * Privacy-preserving 64-bit SimHash over normalized PR/issue title, body, and structural diff shingles.
 * Strips author handles, repo names, emails, and numeric constants so near-identical spam templates
 * cluster together without storing personal data.
 */
export function computePrSimHash(pr: PullRequestEvent): bigint {
  const normalizedText = [
    pr.kind,
    pr.title.toLowerCase(),
    pr.body.toLowerCase(),
    pr.diffText
      .split(/\r?\n/)
      .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
      .map((line) =>
        line
          .slice(1)
          .toLowerCase()
          .replace(/[0-9]+/g, '#')
          .replace(/0x[0-9a-f]+/g, '0x#')
          .trim()
      )
      .join(' '),
  ]
    .join(' ')
    .replace(/[^a-z0-9_#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalizedText.split(' ').filter((w) => w.length >= 2);
  const features: string[] = [];

  for (let i = 0; i < words.length; i++) {
    features.push(words[i]);
    if (i < words.length - 1) {
      features.push(`${words[i]}_${words[i + 1]}`);
    }
  }

  if (features.length === 0) {
    features.push(pr.filesChanged.map((f) => f.split('/').pop() ?? f).join(','));
  }

  const bitAccumulator = new Array<number>(64).fill(0);

  for (const token of features) {
    const hash = fnv1a64(token);
    for (let bit = 0; bit < 64; bit++) {
      const mask = 1n << BigInt(bit);
      bitAccumulator[bit] += (hash & mask) !== 0n ? 1 : -1;
    }
  }

  let simhash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (bitAccumulator[bit] > 0) {
      simhash |= 1n << BigInt(bit);
    }
  }
  return simhash;
}

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

export function formatSimHashHex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

export function detectCrossProjectCampaigns(
  prs: PullRequestEvent[],
  projectsById: Map<string, ProjectNode>,
  vouchEntries: VouchEntry[],
  policy: ProjectPolicy
): {
  prSimhashes: Map<string, string>;
  clusters: CampaignCluster[];
  prToCluster: Map<string, CampaignCluster>;
} {
  const hashes = new Map<string, bigint>();
  const prSimhashes = new Map<string, string>();

  for (const pr of prs) {
    const h = computePrSimHash(pr);
    hashes.set(pr.id, h);
    prSimhashes.set(pr.id, formatSimHashHex(h));
  }

  const visited = new Set<string>();
  const clusters: CampaignCluster[] = [];
  const prToCluster = new Map<string, CampaignCluster>();
  const maxWindowMs = policy.campaignWindowHours * 3600 * 1000;

  for (const seedPr of prs) {
    if (visited.has(seedPr.id)) continue;

    const component: PullRequestEvent[] = [seedPr];
    visited.add(seedPr.id);
    const queue: PullRequestEvent[] = [seedPr];
    let maxObservedDist = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const hCurrent = hashes.get(current.id)!;
      const tCurrent = Date.parse(current.createdAt);

      for (const candidate of prs) {
        if (visited.has(candidate.id)) continue;
        const tCandidate = Date.parse(candidate.createdAt);
        if (Math.abs(tCurrent - tCandidate) > maxWindowMs) continue;

        const dist = hammingDistance64(hCurrent, hashes.get(candidate.id)!);
        if (dist <= policy.campaignHammingThreshold) {
          maxObservedDist = Math.max(maxObservedDist, dist);
          visited.add(candidate.id);
          component.push(candidate);
          queue.push(candidate);
        }
      }
    }

    const distinctProjects = Array.from(new Set(component.map((p) => p.projectId)));
    const distinctAuthors = new Set(component.map((p) => p.authorHandle.toLowerCase()));
    const sortedTimes = component.map((p) => Date.parse(p.createdAt)).sort((a, b) => a - b);
    const windowMinutes = Math.max(
      1,
      Math.round((sortedTimes[sortedTimes.length - 1] - sortedTimes[0]) / 60000)
    );

    const isSameRepoDuplicate =
      distinctProjects.length === 1 &&
      component.length >= 2 &&
      distinctAuthors.size >= 2 &&
      maxObservedDist <= Math.min(8, policy.campaignHammingThreshold);

    const isCrossProjectCluster = distinctProjects.length >= 2 && component.length >= 2;

    if (isCrossProjectCluster || isSameRepoDuplicate) {
      const isActiveCampaign = isCrossProjectCluster
        ? distinctProjects.length >= policy.campaignMinProjects
        : isSameRepoDuplicate;
      const similarityPercent = Math.round(((64 - maxObservedDist) / 64) * 100);
      const clusterId = `${isSameRepoDuplicate ? 'DUP' : 'CMP'}-${formatSimHashHex(
        hashes.get(seedPr.id)!
      )
        .slice(0, 6)
        .toUpperCase()}`;

      const youngAccountCount = component.filter(
        (p) => p.accountAgeDays < policy.freshAccountAgeDays
      ).length;

      // Count mutual vouches among authors in this cluster
      const mutualVouchCount = vouchEntries.filter((e) => {
        if (!e.voucherHandle || e.status !== 'vouched') return false;
        return (
          distinctAuthors.has(e.voucherHandle.toLowerCase()) &&
          distinctAuthors.has(e.contributorHandle.toLowerCase())
        );
      }).length;

      const cluster: CampaignCluster = {
        clusterId,
        clusterType: isSameRepoDuplicate ? 'same_repo_duplicate' : 'cross_project',
        simhashHex: formatSimHashHex(hashes.get(seedPr.id)!),
        prIds: component.map((p) => p.id),
        projectIds: distinctProjects,
        projectNames: distinctProjects.map((id) => projectsById.get(id)?.name ?? id),
        sampleTitle: seedPr.title,
        maxHammingDistance: maxObservedDist,
        similarityPercent,
        windowMinutes,
        youngAccountCount,
        mutualVouchCount,
        firstSeenAt: new Date(sortedTimes[0]).toISOString(),
        lastSeenAt: new Date(sortedTimes[sortedTimes.length - 1]).toISOString(),
        isActiveCampaign,
      };

      clusters.push(cluster);
      for (const item of component) {
        prToCluster.set(item.id, cluster);
      }
    }
  }

  clusters.sort((a, b) => b.prIds.length - a.prIds.length);
  return { prSimhashes, clusters, prToCluster };
}
