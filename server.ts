import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialAppeals,
  createInitialAuditLog,
  createInitialProjects,
  createInitialPullRequests,
  createInitialVouchEntries,
  DEFAULT_POLICY,
  DEFAULT_REFERENCE_NOW,
  generateRogueMassVouchAttack,
} from './src/engine/dataset.ts';
import {
  GitHubScanError,
  scanPublicGitHubRepository,
} from './src/engine/githubScanner.ts';
import { evaluatePullRequestStream } from './src/engine/policyEngine.ts';
import type {
  AppealRecord,
  AuditLogEntry,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  VouchEntry,
} from './src/engine/types.ts';
import { parseVouchedTd, serializeVouchedTd } from './src/engine/vouchParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface NetworkState {
  observerProjectId: string;
  projects: ProjectNode[];
  vouchEntries: VouchEntry[];
  pullRequests: PullRequestEvent[];
  appeals: AppealRecord[];
  auditLog: AuditLogEntry[];
  policy: ProjectPolicy;
  referenceNowIso: string;
}

function createFreshState(): NetworkState {
  return {
    observerProjectId: 'acme-runtime',
    projects: createInitialProjects(),
    vouchEntries: createInitialVouchEntries(),
    pullRequests: createInitialPullRequests(),
    appeals: createInitialAppeals(),
    auditLog: createInitialAuditLog(),
    policy: { ...DEFAULT_POLICY },
    referenceNowIso: DEFAULT_REFERENCE_NOW,
  };
}

let state: NetworkState = createFreshState();

function buildSnapshot() {
  const observerProj = state.projects.find((p) => p.id === state.observerProjectId);
  const effectivePolicy: ProjectPolicy = {
    ...state.policy,
    ...(observerProj?.policy ?? {}),
  };

  // Run the full pipeline once inside evaluatePullRequestStream — no duplicate calls
  const {
    evaluations,
    clusters,
    metrics,
    projectReputations,
    contributorReputations,
    trustMap,
  } = evaluatePullRequestStream(
    state.observerProjectId,
    state.pullRequests,
    state.projects,
    state.vouchEntries,
    state.appeals,
    state.policy,
    state.referenceNowIso
  );

  return {
    observerProjectId: state.observerProjectId,
    projects: state.projects,
    projectTrust: Array.from(trustMap.values()),
    vouchEntries: state.vouchEntries,
    pullRequests: state.pullRequests,
    evaluations,
    clusters,
    appeals: state.appeals,
    auditLog: state.auditLog,
    policy: effectivePolicy,
    metrics,
    projectReputations,
    contributorReputations,
    referenceNowIso: state.referenceNowIso,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/state', (_req, res) => {
    res.json(buildSnapshot());
  });

  app.post('/api/observer', (req, res) => {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId || !state.projects.some((p) => p.id === projectId)) {
      res.status(400).json({ error: 'Unknown projectId' });
      return;
    }
    state.observerProjectId = projectId;
    res.json(buildSnapshot());
  });

  app.post('/api/vouch', (req, res) => {
    const { contributorHandle, voucherHandle, status, reason, projectId } = req.body as {
      contributorHandle?: string;
      voucherHandle?: string;
      status?: 'vouched' | 'denounced';
      reason?: string;
      projectId?: string;
    };
    if (!contributorHandle || (status !== 'vouched' && status !== 'denounced')) {
      res.status(400).json({ error: 'contributorHandle and valid status required' });
      return;
    }
    const cleanHandle = contributorHandle.trim().toLowerCase();
    const cleanVoucher = voucherHandle?.trim().toLowerCase() || undefined;

    // Resolve target project: explicit projectId, or deduce from voucher's affiliation, or fallback to observer
    let targetProjectId =
      projectId && state.projects.some((p) => p.id === projectId)
        ? projectId
        : undefined;

    if (!targetProjectId && cleanVoucher) {
      const maintainerProj = state.projects.find(
        (p) => p.maintainer.toLowerCase() === cleanVoucher
      );
      if (maintainerProj) {
        targetProjectId = maintainerProj.id;
      } else {
        const vouchedEntry = state.vouchEntries.find(
          (e) => e.contributorHandle.toLowerCase() === cleanVoucher && e.status === 'vouched' && !e.voucherHandle
        );
        if (vouchedEntry) {
          targetProjectId = vouchedEntry.projectId;
        }
      }
    }
    if (!targetProjectId) {
      targetProjectId = state.observerProjectId;
    }

    state.vouchEntries = state.vouchEntries.filter(
      (e) => {
        if (e.projectId !== targetProjectId) return true;
        if (e.contributorHandle.toLowerCase() !== cleanHandle) return true;
        // Precisely match the vouch kind: project-level (no voucherHandle) vs user-to-user
        if (cleanVoucher === undefined) {
          // Only remove project-level entries (no voucherHandle)
          return Boolean(e.voucherHandle);
        } else {
          // Only remove user-to-user entries that match the same voucher
          return e.voucherHandle?.toLowerCase() !== cleanVoucher;
        }
      }
    );

    const now = state.referenceNowIso;
    state.vouchEntries.unshift({
      id: `${targetProjectId}-${status}-${cleanHandle}-${Date.now()}`,
      projectId: targetProjectId,
      voucherHandle: cleanVoucher,
      contributorHandle: cleanHandle,
      status,
      reason:
        reason?.trim() ||
        (status === 'vouched' ? 'Vouched by maintainer' : 'Denounced by maintainer'),
      createdAt: now,
    });

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now,
      actor: cleanVoucher ? `@${cleanVoucher}` : targetProjectId,
      action: status === 'vouched' ? 'vouch' : 'denounce',
      target: cleanHandle,
      details: reason?.trim() || `Marked ${status} by ${cleanVoucher ?? targetProjectId}`,
    });

    res.json(buildSnapshot());
  });

  app.post('/api/trust-edge', (req, res) => {
    const { sourceProjectId, targetProjectId, weight } = req.body as {
      sourceProjectId?: string;
      targetProjectId?: string;
      weight?: number;
    };
    const src = state.projects.find((p) => p.id === (sourceProjectId ?? state.observerProjectId));
    const dst = state.projects.find((p) => p.id === targetProjectId);
    if (!src || !dst || typeof weight !== 'number' || weight < 0 || weight > 1) {
      res.status(400).json({ error: 'Valid sourceProjectId, targetProjectId, and weight (0..1) required' });
      return;
    }

    src.trustEdges = src.trustEdges.filter((e) => e.targetProjectId !== dst.id);
    if (weight > 0) {
      src.trustEdges.push({ targetProjectId: dst.id, weight: Number(weight.toFixed(2)) });
    }

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: src.id,
      action: 'trust_edge_updated',
      target: dst.id,
      details:
        weight === 0
          ? `Removed trust edge to ${dst.name}`
          : `Set trust weight toward ${dst.name} to ${weight.toFixed(2)}`,
    });

    res.json(buildSnapshot());
  });

  app.get('/api/vouched-td/export', (req, res) => {
    const projectId = String(req.query.projectId ?? state.observerProjectId);
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const entries = state.vouchEntries.filter((e) => e.projectId === proj.id && !e.voucherHandle);
    res.json({
      projectId: proj.id,
      projectName: proj.name,
      content: serializeVouchedTd(entries, proj.name),
    });
  });

  app.post('/api/vouched-td/import', (req, res) => {
    const { projectId, rawText } = req.body as { projectId?: string; rawText?: string };
    const targetId = projectId ?? state.observerProjectId;
    const proj = state.projects.find((p) => p.id === targetId);
    if (!proj || typeof rawText !== 'string') {
      res.status(400).json({ error: 'Valid projectId and rawText required' });
      return;
    }

    const { entries, errors } = parseVouchedTd(rawText, proj.id, state.referenceNowIso);
    if (errors.length > 0 && entries.length === 0) {
      res.status(400).json({ error: errors.join('; ') });
      return;
    }

    state.vouchEntries = [
      ...state.vouchEntries.filter((e) => e.projectId !== proj.id || Boolean(e.voucherHandle)),
      ...entries,
    ];

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: proj.id,
      action: 'vouched_td_imported',
      target: `${proj.id}/VOUCHED.td`,
      details: `Imported ${entries.filter((e) => e.status === 'vouched').length} vouched and ${
        entries.filter((e) => e.status === 'denounced').length
      } denounced entries.`,
    });

    res.json({ snapshot: buildSnapshot(), warnings: errors });
  });

  app.post('/api/prs', (req, res) => {
    const body = req.body as Partial<PullRequestEvent>;
    if (!body.authorHandle || !body.title) {
      res.status(400).json({ error: 'authorHandle and title are required' });
      return;
    }

    const kind = body.kind === 'issue' ? 'issue' : 'pr';
    if (kind === 'pr' && !body.diffText) {
      res.status(400).json({ error: 'diffText is required for pull requests' });
      return;
    }

    const projectId =
      body.projectId && state.projects.some((p) => p.id === body.projectId)
        ? body.projectId
        : state.observerProjectId;

    const newPr: PullRequestEvent = {
      id: `pr-custom-${Date.now()}`,
      kind,
      prNumber: Math.floor(1500 + Math.random() * 500),
      projectId,
      authorHandle: body.authorHandle.trim().toLowerCase(),
      accountAgeDays: typeof body.accountAgeDays === 'number' ? body.accountAgeDays : 7,
      publicMergedPrs: typeof body.publicMergedPrs === 'number' ? body.publicMergedPrs : 0,
      createdAt: state.referenceNowIso,
      title: body.title.trim(),
      body: body.body?.trim() ?? '',
      filesChanged:
        kind === 'issue'
          ? []
          : Array.isArray(body.filesChanged) && body.filesChanged.length > 0
            ? body.filesChanged
            : ['src/index.ts'],
      diffText: body.diffText ?? '(GitHub Issue — no code diff)',
    };

    state.pullRequests.unshift(newPr);
    res.json({ prId: newPr.id, snapshot: buildSnapshot() });
  });

  app.post('/api/simulate/rogue-mass-vouch', (req, res) => {
    const { compromisedProjectId } = (req.body ?? {}) as { compromisedProjectId?: string };
    const rogueId =
      compromisedProjectId && state.projects.some((p) => p.id === compromisedProjectId)
        ? compromisedProjectId
        : 'zig-stdx';

    // Remove previous simulated rogue attack entries if re-clicked
    state.vouchEntries = state.vouchEntries.filter((e) => !e.id.startsWith('rogue-vouch-'));
    state.pullRequests = state.pullRequests.filter((p) => !p.id.startsWith('pr-rogue-fake-'));

    const { fakeVouches, fakePrs } = generateRogueMassVouchAttack(
      rogueId,
      state.observerProjectId,
      state.referenceNowIso
    );

    state.vouchEntries.unshift(...fakeVouches);
    state.pullRequests.unshift(...fakePrs);

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: rogueId,
      action: 'rogue_attack_simulated',
      target: `${rogueId} -> 100 fake accounts`,
      details: `Simulated compromised peer ${rogueId} vouching 100 fresh accounts within 25 minutes and opening 5 test PRs.`,
    });

    res.json(buildSnapshot());
  });

  app.post('/api/appeals', (req, res) => {
    const { contributorHandle, denouncedByProjectId, appealStatement, evidenceUrl } = req.body as {
      contributorHandle?: string;
      denouncedByProjectId?: string;
      appealStatement?: string;
      evidenceUrl?: string;
    };
    if (!contributorHandle || !denouncedByProjectId || !appealStatement) {
      res.status(400).json({ error: 'contributorHandle, denouncedByProjectId, and appealStatement required' });
      return;
    }

    const matchingDenounce = state.vouchEntries.find(
      (e) =>
        e.contributorHandle.toLowerCase() === contributorHandle.toLowerCase() &&
        e.projectId === denouncedByProjectId &&
        e.status === 'denounced'
    );

    const record: AppealRecord = {
      id: `apl-${Date.now()}`,
      contributorHandle: contributorHandle.trim().toLowerCase(),
      denouncedByProjectId,
      denouncementReason: matchingDenounce?.reason ?? 'Cross-project denouncement',
      appealStatement: appealStatement.trim(),
      evidenceUrl: evidenceUrl?.trim() || 'https://github.com/pulls',
      status: 'pending',
      createdAt: state.referenceNowIso,
    };

    state.appeals.unshift(record);
    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: record.contributorHandle,
      action: 'appeal_submitted',
      target: denouncedByProjectId,
      details: `Appeal submitted against ${denouncedByProjectId}: ${record.appealStatement.slice(0, 90)}`,
    });

    res.json(buildSnapshot());
  });

  app.post('/api/appeals/:id/resolve', (req, res) => {
    const { id } = req.params;
    const { decision, resolverNote } = req.body as {
      decision?: 'overturned' | 'upheld';
      resolverNote?: string;
    };
    const appeal = state.appeals.find((a) => a.id === id);
    if (!appeal || (decision !== 'overturned' && decision !== 'upheld')) {
      res.status(400).json({ error: 'Valid appeal id and decision required' });
      return;
    }

    appeal.status = decision;
    appeal.resolvedAt = state.referenceNowIso;
    appeal.resolverNote =
      resolverNote?.trim() ||
      (decision === 'overturned'
        ? 'Denouncement overturned after peer review; contributor restored to fair evaluation.'
        : 'Denouncement upheld with verified abuse evidence.');

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: state.observerProjectId,
      action: 'appeal_resolved',
      target: appeal.contributorHandle,
      details: `Appeal ${appeal.id} ${decision}: ${appeal.resolverNote}`,
    });

    res.json(buildSnapshot());
  });

  app.post('/api/policy', (req, res) => {
    const updates = req.body as Partial<ProjectPolicy>;

    // Enforce design invariant: gain rate must always be <= 50% of slash rate
    // (slow positive climb, rapid slashing — explicit user requirement)
    const baseSlash = updates.reputationSlashRate ?? state.policy.reputationSlashRate;
    const maxAllowedGain = Number((baseSlash * 0.5).toFixed(4));
    if (typeof updates.reputationGainRate === 'number') {
      updates.reputationGainRate = Math.min(updates.reputationGainRate, maxAllowedGain);
    }
    // Also enforce budget < burst threshold to keep the circuit-breaker meaningful
    if (
      typeof updates.vouchBudgetPer24h === 'number' &&
      typeof updates.vouchBurstFreezeThreshold === 'number' &&
      updates.vouchBudgetPer24h >= updates.vouchBurstFreezeThreshold
    ) {
      updates.vouchBudgetPer24h = updates.vouchBurstFreezeThreshold - 1;
    }

    const observerProj = state.projects.find((p) => p.id === state.observerProjectId);
    if (observerProj) {
      observerProj.policy = {
        ...(observerProj.policy ?? {}),
        ...updates,
      };
    } else {
      state.policy = {
        ...state.policy,
        ...updates,
      };
    }

    const activePolicy = {
      ...state.policy,
      ...(observerProj?.policy ?? {}),
    };

    state.auditLog.unshift({
      id: `aud-${Date.now()}`,
      timestamp: state.referenceNowIso,
      actor: state.observerProjectId,
      action: 'policy_updated',
      target: state.observerProjectId,
      details: `Updated ${state.observerProjectId} policy (gain=+${activePolicy.reputationGainRate}, slash=-${activePolicy.reputationSlashRate}, burstCap=${activePolicy.vouchBurstFreezeThreshold})`,
    });

    res.json(buildSnapshot());
  });

  app.post('/api/scan-repo', async (req, res) => {
    const { repoUrl, limit, stateFilter } = (req.body ?? {}) as {
      repoUrl?: string;
      limit?: number;
      stateFilter?: 'all' | 'open';
    };

    try {
      const observerProj = state.projects.find((p) => p.id === state.observerProjectId);
      const effectivePolicy: ProjectPolicy = {
        ...state.policy,
        ...(observerProj?.policy ?? {}),
      };

      const report = await scanPublicGitHubRepository({
        repoUrl: repoUrl ?? '',
        limit: typeof limit === 'number' ? limit : 10,
        stateFilter: stateFilter === 'open' ? 'open' : 'all',
        existingVouchEntries: state.vouchEntries,
        policy: effectivePolicy,
      });

      res.json(report);
    } catch (err) {
      if (err instanceof GitHubScanError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to scan GitHub repository.',
      });
    }
  });

  app.post('/api/reset', (_req, res) => {
    state = createFreshState();
    res.json(buildSnapshot());
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VouchMesh server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
