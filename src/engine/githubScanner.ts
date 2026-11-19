import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { computePrSimHash, formatSimHashHex, hammingDistance64 } from './campaignDetector.ts';
import { analyzePullRequestDiff } from './diffAnalyzer.ts';
import type {
  DiffFinding,
  PositiveCodeSignal,
  ProjectImportance,
  ProjectPolicy,
  PullRequestEvent,
  RepoScanReport,
  RepoScanVerdict,
  ScannedPrResult,
  VouchEntry,
  VouchStatus,
} from './types.ts';
import { parseVouchedTd } from './vouchParser.ts';

const execFileAsync = promisify(execFile);

interface CachedUserSignals {
  fetchedAt: number;
  accountAgeDays: number | null;
  accountAgeIsLowerBound?: boolean;
  publicRepos: number | null;
  recentPrReposCount: number | null;
  recentPrCount: number | null;
}

interface RawPullRecord {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  diff_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  created_at: string;
  author_association: string;
  user: {
    login: string;
    html_url: string;
    type?: string;
  } | null;
}

interface RepoMetadataResult {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  default_branch: string;
  usedWebFallback: boolean;
}

interface ParsedDiffInfo {
  diffText: string;
  filesChanged: string[];
  newFiles: string[];
  modifiedExistingFiles: string[];
  wiredNewFiles: string[];
  codeLinesChanged: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const userSignalCache = new Map<string, CachedUserSignals>();
const repoTreeCache = new Map<string, { fetchedAt: number; paths: string[] }>();

export class GitHubScanError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function parseGitHubRepoUrl(rawInput: string): { owner: string; repo: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new GitHubScanError(400, 'Please enter a GitHub repository URL or owner/repo slug.');
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate) || /^github\.com\//i.test(candidate)) {
    const normalizedUrl = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      throw new GitHubScanError(400, 'Invalid URL format. Example: https://github.com/ghostty-org/ghostty');
    }
    if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) {
      throw new GitHubScanError(400, 'Only github.com public repositories are supported.');
    }
    candidate = parsed.pathname.replace(/^\/+|\/+$/g, '');
  }

  const parts = candidate.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new GitHubScanError(
      400,
      'Could not find owner and repository name. Example: https://github.com/vitejs/vite or vitejs/vite'
    );
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');

  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new GitHubScanError(400, 'Repository owner or name contains invalid characters.');
  }

  return { owner, repo };
}

const WEB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VouchMesh-RepoScanner/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function parseUnifiedDiffDetails(fullText: string): ParsedDiffInfo {
  const files = new Set<string>();
  const newFiles = new Set<string>();
  const modifiedExistingFiles = new Set<string>();
  const addedLinesByFile = new Map<string, string[]>();
  let currentFile: string | null = null;
  let currentIsNew = false;
  let codeLinesChanged = 0;

  const lines = fullText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (currentFile) {
        if (currentIsNew) newFiles.add(currentFile);
        else modifiedExistingFiles.add(currentFile);
      }
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      currentFile = match?.[1]?.trim() ?? null;
      currentIsNew = false;
      if (currentFile) files.add(currentFile);
    } else if (line.startsWith('new file mode') || line === '--- /dev/null') {
      currentIsNew = true;
    } else if (line.startsWith('+++ b/')) {
      const file = line.slice(6).trim();
      if (file && file !== '/dev/null') {
        currentFile = file;
        files.add(file);
      }
    } else if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      if (line.startsWith('+') && currentFile) {
        const list = addedLinesByFile.get(currentFile) ?? [];
        list.push(line.slice(1).toLowerCase());
        addedLinesByFile.set(currentFile, list);
      }
      const isLockfile =
        currentFile && /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i.test(currentFile);
      if (!isLockfile && line.slice(1).trim().length > 0) {
        codeLinesChanged++;
      }
    }
  }
  if (currentFile) {
    if (currentIsNew) newFiles.add(currentFile);
    else modifiedExistingFiles.add(currentFile);
  }

  // Check across the FULL (untruncated) diff whether any other file in the PR imports/uses each new file
  const wiredNewFiles: string[] = [];
  for (const newFile of newFiles) {
    const stem = fileStem(newFile);
    const noExtLower = newFile.replace(/\.[^/.]+$/, '').toLowerCase();
    let isWired = false;
    for (const [otherFile, otherLines] of addedLinesByFile.entries()) {
      if (otherFile === newFile) continue;
      if (
        otherLines.some(
          (l) =>
            (stem.length >= 3 && l.includes(stem)) ||
            (noExtLower.length >= 4 && l.includes(noExtLower))
        )
      ) {
        isWired = true;
        break;
      }
    }
    if (isWired) {
      wiredNewFiles.push(newFile);
    }
  }

  return {
    diffText: fullText.slice(0, 24000),
    filesChanged: Array.from(files),
    newFiles: Array.from(newFiles),
    modifiedExistingFiles: Array.from(modifiedExistingFiles),
    wiredNewFiles,
    codeLinesChanged,
  };
}

async function fetchRawDiff(diffUrl: string): Promise<ParsedDiffInfo> {
  try {
    const res = await fetch(diffUrl, {
      headers: { 'User-Agent': 'VouchMesh-RepoScanner/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        diffText: '',
        filesChanged: [],
        newFiles: [],
        modifiedExistingFiles: [],
        wiredNewFiles: [],
        codeLinesChanged: 0,
      };
    }
    const fullText = await res.text();
    return parseUnifiedDiffDetails(fullText);
  } catch {
    return {
      diffText: '',
      filesChanged: [],
      newFiles: [],
      modifiedExistingFiles: [],
      wiredNewFiles: [],
      codeLinesChanged: 0,
    };
  }
}

const GENERIC_TOKENS = new Set([
  'index',
  'main',
  'init',
  'utils',
  'util',
  'helper',
  'helpers',
  'common',
  'types',
  'type',
  'test',
  'tests',
  'spec',
  'config',
  'setup',
  'src',
  'lib',
  'pkg',
  'core',
  'mod',
  'new',
  'add',
  'fix',
  'update',
  'file',
  'card',
  'view',
  'panel',
  'modal',
  'dialog',
  'page',
  'layout',
  'item',
  'list',
  'form',
  'button',
  'widget',
  'step',
  'resolve',
  'floating',
  'data',
  'component',
  'module',
  'service',
  'handler',
  'hooks',
  'hook',
  'context',
  'style',
  'styles',
]);

function fileStem(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.[^/.]+$/, '').toLowerCase();
}

function extractBasenameTokens(filePath: string): string[] {
  const stemRaw = (filePath.split('/').pop() ?? filePath).replace(/\.[^/.]+$/, '');
  return stemRaw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_TOKENS.has(t));
}

async function fetchRepoTreePaths(
  owner: string,
  repo: string,
  defaultBranch: string,
  remainingQuota: { current: number | null }
): Promise<string[]> {
  const cacheKey = `${owner}/${repo}@${defaultBranch}`.toLowerCase();
  const cached = repoTreeCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.paths;
  }

  // Primary: shallow treeless git clone (uses Git smart HTTP — 0 REST API quota)
  let tmpRoot: string | null = null;
  try {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'vouchmesh-tree-'));
    await execFileAsync(
      'git',
      [
        'clone',
        '--depth=1',
        '--filter=blob:none',
        '--no-checkout',
        '--branch',
        defaultBranch,
        `https://github.com/${owner}/${repo}.git`,
        tmpRoot,
      ],
      { timeout: 15000 }
    );
    const { stdout } = await execFileAsync(
      'git',
      ['-C', tmpRoot, 'ls-tree', '-r', '--name-only', 'HEAD'],
      { timeout: 10000, maxBuffer: 12 * 1024 * 1024 }
    );
    const paths = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length > 0) {
      repoTreeCache.set(cacheKey, { fetchedAt: Date.now(), paths });
      return paths;
    }
  } catch {
    // Fall back to GitHub REST tree API below if git clone is unavailable
  } finally {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (remainingQuota.current !== null && remainingQuota.current <= 0) {
    return [];
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
      {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(8000),
      }
    );
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) remainingQuota.current = Number(rem);
    if (!res.ok) return [];

    const data = (await res.json()) as {
      tree?: Array<{ path?: string; type?: string }>;
    };
    const paths = (data.tree ?? [])
      .filter((item) => item.type === 'blob' && typeof item.path === 'string')
      .map((item) => item.path!);
    repoTreeCache.set(cacheKey, { fetchedAt: Date.now(), paths });
    return paths;
  } catch {
    return [];
  }
}

function analyzeRepoOverlapAndImportance(params: {
  title: string;
  body: string;
  diffInfo: ParsedDiffInfo;
  repoPaths: string[];
  findings: DiffFinding[];
  positiveSignals: PositiveCodeSignal[];
}): {
  similarExistingFiles: string[];
  unwiredNewFiles: string[];
  projectImportance: ProjectImportance;
  importanceReason: string;
} {
  const { title, body, diffInfo, repoPaths, findings, positiveSignals } = params;
  const changedSet = new Set(diffInfo.filesChanged.map((f) => f.toLowerCase()));
  const similarSet = new Set<string>();

  // Compute repo-wide basename token frequency so common domain words (e.g. "circuit", "schematics", "plugin")
  // don't produce false similarity hits across unrelated modules.
  const tokenFrequency = new Map<string, number>();
  for (const p of repoPaths) {
    for (const tok of new Set(extractBasenameTokens(p))) {
      tokenFrequency.set(tok, (tokenFrequency.get(tok) ?? 0) + 1);
    }
  }
  const commonThreshold = Math.max(4, Math.floor(repoPaths.length * 0.03));
  const distinctiveTokens = (filePath: string) =>
    extractBasenameTokens(filePath).filter((t) => (tokenFrequency.get(t) ?? 0) < commonThreshold);

  // 1. Compare newly created files against existing repository basenames (never folder names)
  for (const newFile of diffInfo.newFiles) {
    if (/\.(md|txt)$/i.test(newFile)) continue;
    const baseLower = (newFile.split('/').pop() ?? newFile).toLowerCase();
    const stem = fileStem(newFile);
    const tokens = distinctiveTokens(newFile);

    for (const existing of repoPaths) {
      if (changedSet.has(existing.toLowerCase())) continue;
      if (/\.(md|txt|lock|png|jpg|svg)$/i.test(existing)) continue;
      const existingBase = (existing.split('/').pop() ?? existing).toLowerCase();
      const existingStem = fileStem(existing);

      if (baseLower === existingBase && !GENERIC_TOKENS.has(stem) && stem.length >= 4) {
        similarSet.add(existing);
      } else if (stem.length >= 6 && existingStem === stem && !GENERIC_TOKENS.has(stem)) {
        similarSet.add(existing);
      } else if (tokens.length >= 2) {
        const existingTokens = new Set(distinctiveTokens(existing));
        const shared = tokens.filter((t) => existingTokens.has(t));
        if (shared.length >= 2) {
          similarSet.add(existing);
        }
      }
      if (similarSet.size >= 5) break;
    }
  }

  // Only check standalone feature PR titles against distinctive file basenames (never folder paths)
  const isStandaloneAddition =
    diffInfo.newFiles.length > 0 && diffInfo.modifiedExistingFiles.length === 0;
  if (
    isStandaloneAddition &&
    similarSet.size < 3 &&
    /^(feat|add|implement|create|introduce|build)\b/i.test(title.trim())
  ) {
    const titleTokens = title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (t) =>
          t.length >= 4 &&
          !GENERIC_TOKENS.has(t) &&
          (tokenFrequency.get(t) ?? 0) < commonThreshold
      );
    if (titleTokens.length >= 2) {
      for (const existing of repoPaths) {
        if (changedSet.has(existing.toLowerCase())) continue;
        if (/\.(md|txt|test\.|spec\.)/i.test(existing)) continue;
        const existingBaseTokens = new Set(extractBasenameTokens(existing));
        const hits = titleTokens.filter((t) => existingBaseTokens.has(t));
        if (hits.length >= 2) {
          similarSet.add(existing);
          if (similarSet.size >= 5) break;
        }
      }
    }
  }

  // 2. Identify unwired standalone new code files using the FULL-diff cross-file check
  const wiredSet = new Set(diffInfo.wiredNewFiles);
  const unwiredNewFiles: string[] = [];
  for (const newFile of diffInfo.newFiles) {
    const isCodeFile = /\.(ts|tsx|js|jsx|py|rs|go|zig|c|cpp|h)$/i.test(newFile);
    const isTestOrStandaloneEntry =
      /(\.|_)(test|spec)\.|\/tests?\//i.test(newFile) ||
      /(^|\/)(scripts|bin|tools|cli|migrations|e2e|fixtures|examples)\//i.test(newFile) ||
      /\.(config|setup|d)\.(ts|js|mjs|cjs)$/i.test(newFile);
    if (!isCodeFile || isTestOrStandaloneEntry) continue;

    if (!wiredSet.has(newFile)) {
      unwiredNewFiles.push(newFile);
    }
  }

  const similarExistingFiles = Array.from(similarSet).slice(0, 5);

  // 3. Project importance scoring (small surgical fixes in existing core source are HIGH impact!)
  const onlyDocsOrLock =
    diffInfo.filesChanged.length > 0 &&
    diffInfo.filesChanged.every((f) => /\.(md|txt|lock|lockb)$/i.test(f) || f.endsWith('-lock.json'));
  const hasTrivialChurn = findings.some((f) => f.ruleId === 'TRIVIAL_DOC_CHURN');
  const touchesCoreSource = diffInfo.filesChanged.some(
    (f) => /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|zig|c|cpp|h|css|scss)$/i.test(f) && !/(\.|_)(test|spec)\./i.test(f)
  );
  const touchesBuildOrSecurity = diffInfo.filesChanged.some((f) =>
    /(package\.json|Cargo\.toml|build\.zig|Makefile|Dockerfile|\.github\/workflows\/)/i.test(f)
  );
  const isFixOrSecurityTitle =
    /(fix|bug|crash|security|cve|perf|regression|leak|race|overflow)/i.test(title) ||
    /(fixes|closes|resolves)\s+#\d+/i.test(body);
  const hasSurgicalFixSignal = positiveSignals.some((s) => s.signalId === 'SURGICAL_CODE_FIX');

  let projectImportance: ProjectImportance = 'MODERATE';
  let importanceReason = 'Targeted update affecting existing repository configuration or source files.';

  if (
    hasTrivialChurn ||
    diffInfo.codeLinesChanged === 0 ||
    (onlyDocsOrLock && diffInfo.codeLinesChanged <= 5)
  ) {
    projectImportance = 'LOW';
    importanceReason =
      'Low project impact: trivial documentation, whitespace, or lockfile-only change with minimal functional effect.';
  } else if (
    similarExistingFiles.length > 0 &&
    unwiredNewFiles.length > 0 &&
    diffInfo.modifiedExistingFiles.length === 0
  ) {
    projectImportance = 'LOW';
    importanceReason = `Low project impact: adds standalone file(s) not wired into existing code while similar module(s) already exist (${similarExistingFiles[0]}).`;
  } else if (
    (touchesCoreSource &&
      diffInfo.modifiedExistingFiles.length > 0 &&
      (diffInfo.codeLinesChanged >= 1 && findings.length === 0)) ||
    (touchesCoreSource && hasSurgicalFixSignal) ||
    (touchesCoreSource && isFixOrSecurityTitle) ||
    (touchesCoreSource && positiveSignals.some((s) => s.signalId === 'INCLUDES_UNIT_TESTS'))
  ) {
    projectImportance = 'HIGH';
    importanceReason =
      diffInfo.codeLinesChanged <= 15 && diffInfo.modifiedExistingFiles.length > 0
        ? `High project impact: surgical edit (${diffInfo.codeLinesChanged} code line(s)) updating existing core source file(s) — small targeted changes often fix critical edge cases or logic bugs.`
        : `High project impact: updates ${diffInfo.modifiedExistingFiles.length || diffInfo.filesChanged.length} core source file(s) (${diffInfo.codeLinesChanged} code lines changed${
            isFixOrSecurityTitle ? ', linked fix/bug patch' : ''
          }).`;
  } else if (touchesCoreSource && unwiredNewFiles.length === 0 && findings.length === 0) {
    projectImportance = 'MODERATE';
    importanceReason = `Integrates ${diffInfo.filesChanged.length} source file(s) cleanly with zero static code defects.`;
  } else if (touchesBuildOrSecurity) {
    projectImportance = 'MODERATE';
    importanceReason = 'Modifies build, dependency, or workflow manifests; verify necessity before merging.';
  }

  return {
    similarExistingFiles,
    unwiredNewFiles,
    projectImportance,
    importanceReason,
  };
}

async function fetchUserSignalsWebFallback(login: string): Promise<CachedUserSignals> {
  const safeLogin = encodeURIComponent(login);
  const [profileRes, contribRes, atomRes] = await Promise.allSettled([
    fetch(`https://github.com/${safeLogin}`, {
      headers: WEB_HEADERS,
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://github.com/users/${safeLogin}/contributions`, {
      headers: WEB_HEADERS,
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://github.com/${safeLogin}.atom`, {
      headers: { 'User-Agent': 'VouchMesh-RepoScanner/1.0' },
      signal: AbortSignal.timeout(6000),
    }),
  ]);

  let publicRepos: number | null = null;
  if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
    try {
      const html = await profileRes.value.text();
      const repoMatch =
        html.match(/Repositories[\s\S]{0,300}Counter[^>]*>(\d+)</i) ||
        html.match(/data-tab-item="repositories"[\s\S]{0,300}Counter[^>]*>(\d+)</i);
      if (repoMatch) {
        publicRepos = Number(repoMatch[1]);
      }
    } catch {
      // Ignore parse error
    }
  }

  let accountAgeDays: number | null = null;
  if (contribRes.status === 'fulfilled' && contribRes.value.ok) {
    try {
      const cHtml = await contribRes.value.text();
      const activeDates = [
        ...cHtml.matchAll(
          /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="([1-4])"|data-level="([1-4])"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g
        ),
      ]
        .map((m) => m[1] || m[4])
        .filter(Boolean)
        .sort();
      if (activeDates.length > 0) {
        const earliestTs = Date.parse(activeDates[0]);
        if (!Number.isNaN(earliestTs)) {
          accountAgeDays = Math.max(0, Math.floor((Date.now() - earliestTs) / 86400000));
        }
      }
    } catch {
      // Ignore parse error
    }
  }

  let recentPrReposCount: number | null = null;
  let recentPrCount: number | null = null;
  if (atomRes.status === 'fulfilled' && atomRes.value.ok) {
    try {
      const atomXml = await atomRes.value.text();
      if (atomXml.includes('<feed')) {
        const entries = [...atomXml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
        const openedRepos: string[] = [];
        for (const entry of entries) {
          const isOpenedPr =
            /tag:github\.com,\d+:pr_created\//i.test(entry) ||
            (/PullRequestEvent/i.test(entry) && /opened a pull request/i.test(entry));
          if (!isOpenedPr) continue;
          const repoMatch = entry.match(/href="https:\/\/github\.com\/([^/"]+\/[^/"]+)\/pull\/\d+"/);
          if (repoMatch?.[1]) {
            openedRepos.push(repoMatch[1].toLowerCase());
          }
        }
        recentPrCount = openedRepos.length;
        recentPrReposCount = new Set(openedRepos).size;
      }
    } catch {
      // Ignore parse error
    }
  }

  return {
    fetchedAt: Date.now(),
    accountAgeDays,
    accountAgeIsLowerBound: true,
    publicRepos,
    recentPrReposCount,
    recentPrCount,
  };
}

async function fetchUserSignals(
  login: string,
  remainingQuota: { current: number | null }
): Promise<{ signals: CachedUserSignals; quotaSkipped: boolean }> {
  const key = login.toLowerCase();
  const cached = userSignalCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { signals: cached, quotaSkipped: false };
  }

  if (!process.env.GITHUB_TOKEN && remainingQuota.current !== null && remainingQuota.current <= 4) {
    const webSignals = await fetchUserSignalsWebFallback(login);
    userSignalCache.set(key, webSignals);
    return { signals: webSignals, quotaSkipped: true };
  }

  try {
    const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(6000),
    });
    const remHeader = userRes.headers.get('x-ratelimit-remaining');
    if (remHeader !== null) {
      remainingQuota.current = Number(remHeader);
    }

    if (!userRes.ok) {
      const skipped = userRes.status === 403 || userRes.status === 429;
      if (skipped) {
        const webSignals = await fetchUserSignalsWebFallback(login);
        userSignalCache.set(key, webSignals);
        return { signals: webSignals, quotaSkipped: true };
      }
      return {
        signals: {
          fetchedAt: Date.now(),
          accountAgeDays: null,
          publicRepos: null,
          recentPrReposCount: null,
          recentPrCount: null,
        },
        quotaSkipped: false,
      };
    }

    const userJson = (await userRes.json()) as {
      created_at?: string;
      public_repos?: number;
    };

    const accountAgeDays = userJson.created_at
      ? Math.max(0, Math.floor((Date.now() - Date.parse(userJson.created_at)) / 86400000))
      : null;

    let recentPrReposCount: number | null = null;
    let recentPrCount: number | null = null;

    // Only fetch cross-repo public PR events if we have comfortable rate-limit headroom
    if (process.env.GITHUB_TOKEN || remainingQuota.current === null || remainingQuota.current > 10) {
      try {
        const eventsRes = await fetch(
          `https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=30`,
          {
            headers: githubHeaders(),
            signal: AbortSignal.timeout(6000),
          }
        );
        const evRem = eventsRes.headers.get('x-ratelimit-remaining');
        if (evRem !== null) {
          remainingQuota.current = Number(evRem);
        }
        if (eventsRes.ok) {
          const events = (await eventsRes.json()) as Array<{
            type?: string;
            repo?: { name?: string };
            payload?: { action?: string };
          }>;
          const prEvents = events.filter(
            (ev) => ev.type === 'PullRequestEvent' && ev.payload?.action === 'opened'
          );
          recentPrCount = prEvents.length;
          recentPrReposCount = new Set(prEvents.map((ev) => ev.repo?.name).filter(Boolean)).size;
        }
      } catch {
        // Optional enrichment; proceed cleanly without cross-repo event data
      }
    }

    const result: CachedUserSignals = {
      fetchedAt: Date.now(),
      accountAgeDays,
      accountAgeIsLowerBound: false,
      publicRepos: typeof userJson.public_repos === 'number' ? userJson.public_repos : null,
      recentPrReposCount,
      recentPrCount,
    };
    userSignalCache.set(key, result);
    return { signals: result, quotaSkipped: false };
  } catch {
    const webSignals = await fetchUserSignalsWebFallback(login);
    userSignalCache.set(key, webSignals);
    return { signals: webSignals, quotaSkipped: false };
  }
}

async function fetchRepoMetadataWithFallback(
  owner: string,
  repo: string,
  remainingQuota: { current: number | null }
): Promise<RepoMetadataResult> {
  if (process.env.GITHUB_TOKEN || remainingQuota.current === null || remainingQuota.current > 0) {
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      const remAfterRepo = repoRes.headers.get('x-ratelimit-remaining');
      if (remAfterRepo !== null) remainingQuota.current = Number(remAfterRepo);

      if (repoRes.status === 404) {
        throw new GitHubScanError(
          404,
          `Repository "${owner}/${repo}" was not found or is private. Only public GitHub repositories can be checked.`
        );
      }
      if (repoRes.ok) {
        const json = (await repoRes.json()) as {
          full_name: string;
          html_url: string;
          description: string | null;
          stargazers_count: number;
          default_branch: string;
        };
        return { ...json, usedWebFallback: false };
      }
      // Fall through to web HTML if 403/429 or upstream API error
    } catch (err) {
      if (err instanceof GitHubScanError) throw err;
    }
  }

  // Zero-quota fallback: fetch public GitHub repository HTML page directly
  const webRes = await fetch(`https://github.com/${owner}/${repo}`, {
    headers: WEB_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (webRes.status === 404) {
    throw new GitHubScanError(
      404,
      `Repository "${owner}/${repo}" was not found or is private. Only public GitHub repositories can be checked.`
    );
  }
  if (!webRes.ok) {
    throw new GitHubScanError(502, `GitHub returned status ${webRes.status} for ${owner}/${repo}.`);
  }

  const html = await webRes.text();
  const branchMatch = html.match(/"defaultBranch":"([^"]+)"/);
  const starsMatch = html.match(/"stargazerCount":(\d+)/);
  const rawDesc = html.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? '';
  const cleanedDesc = decodeHtmlEntities(rawDesc)
    .replace(new RegExp(`\\s*-\\s*${owner}/${repo}$`, 'i'), '')
    .trim();

  return {
    full_name: `${owner}/${repo}`,
    html_url: `https://github.com/${owner}/${repo}`,
    description: cleanedDesc || null,
    stargazers_count: starsMatch ? Number(starsMatch[1]) : 0,
    default_branch: branchMatch?.[1] || 'main',
    usedWebFallback: true,
  };
}

function mapWebAssociation(rawAssoc?: string): string {
  if (!rawAssoc) return 'NONE';
  return rawAssoc.replace(/^REPO_PULL_REQUEST_AUTHOR_ASSOCIATION_/, '') || 'NONE';
}

async function fetchLatestPullsWithFallback(
  owner: string,
  repo: string,
  stateFilter: 'all' | 'open',
  clampedLimit: number,
  remainingQuota: { current: number | null }
): Promise<{ pulls: RawPullRecord[]; usedWebFallback: boolean }> {
  if (process.env.GITHUB_TOKEN || remainingQuota.current === null || remainingQuota.current > 0) {
    try {
      const pullsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=${stateFilter}&sort=created&direction=desc&per_page=${clampedLimit}`,
        {
          headers: githubHeaders(),
          signal: AbortSignal.timeout(8000),
        }
      );
      const remAfterPulls = pullsRes.headers.get('x-ratelimit-remaining');
      if (remAfterPulls !== null) remainingQuota.current = Number(remAfterPulls);

      if (pullsRes.ok) {
        const rawPulls = (await pullsRes.json()) as RawPullRecord[];
        return { pulls: rawPulls, usedWebFallback: false };
      }
      // On 403/429, cleanly fall back to zero-quota GitHub web PR listing
    } catch {
      // Fall through to zero-quota GitHub web PR listing
    }
  }

  const query = stateFilter === 'open' ? 'is:pr is:open sort:created-desc' : 'is:pr sort:created-desc';
  const webPullsRes = await fetch(
    `https://github.com/${owner}/${repo}/pulls?q=${encodeURIComponent(query)}`,
    {
      headers: WEB_HEADERS,
      signal: AbortSignal.timeout(9000),
    }
  );
  if (!webPullsRes.ok) {
    throw new GitHubScanError(
      502,
      `Failed to fetch pull requests from GitHub (HTTP ${webPullsRes.status}).`
    );
  }
  const html = await webPullsRes.text();
  const scripts = [
    ...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g),
  ];

  interface WebEmbeddedPrItem {
    number?: number;
    title?: string;
    createdAt?: string;
    mergedAt?: string | null;
    state?: string;
    displayState?: string;
    permalink?: string;
    author?: {
      displayLogin?: string;
      association?: string;
      identity?: string;
    };
  }

  let items: WebEmbeddedPrItem[] = [];
  for (const s of scripts) {
    try {
      const parsed = JSON.parse(s[1]) as {
        payload?: {
          repoPullsDashboardContentRoute?: {
            results?: WebEmbeddedPrItem[];
          };
        };
      };
      const results = parsed?.payload?.repoPullsDashboardContentRoute?.results;
      if (Array.isArray(results)) {
        items = results;
        break;
      }
    } catch {
      // Ignore malformed/other JSON blocks
    }
  }

  const mapped: RawPullRecord[] = items
    .filter((item): item is WebEmbeddedPrItem & { number: number } => typeof item.number === 'number')
    .slice(0, clampedLimit)
    .map((item) => {
      const login = item.author?.displayLogin ?? 'unknown';
      const isBot =
        item.author?.identity === 'REPO_PULL_REQUEST_AUTHOR_IDENTITY_BOT' ||
        /\[bot\]$/i.test(login);
      const isOpen =
        item.state === 'REPO_PULL_REQUEST_STATE_OPEN' ||
        item.displayState === 'REPO_PULL_REQUEST_DISPLAY_STATE_OPEN';
      const isMerged =
        Boolean(item.mergedAt) ||
        item.state === 'REPO_PULL_REQUEST_STATE_MERGED' ||
        item.displayState === 'REPO_PULL_REQUEST_DISPLAY_STATE_MERGED';

      return {
        number: item.number,
        title: item.title ?? `Pull Request #${item.number}`,
        body: '',
        html_url: item.permalink ?? `https://github.com/${owner}/${repo}/pull/${item.number}`,
        diff_url: `https://github.com/${owner}/${repo}/pull/${item.number}.diff`,
        state: isOpen ? 'open' : 'closed',
        merged_at: item.mergedAt ?? (isMerged ? item.createdAt ?? new Date().toISOString() : null),
        created_at: item.createdAt ?? new Date().toISOString(),
        author_association: mapWebAssociation(item.author?.association),
        user: {
          login,
          html_url: `https://github.com/${login}`,
          type: isBot ? 'Bot' : 'User',
        },
      };
    });

  return { pulls: mapped, usedWebFallback: true };
}

async function tryFetchRepoVouchedTd(
  owner: string,
  repo: string,
  defaultBranch: string,
  repoSlug: string
): Promise<{ found: boolean; entries: VouchEntry[] }> {
  const candidates = [
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(defaultBranch)}/VOUCHED.td`,
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(defaultBranch)}/.github/VOUCHED.td`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VouchMesh-RepoScanner/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const text = await res.text();
        const { entries } = parseVouchedTd(text, repoSlug, new Date().toISOString());
        return { found: true, entries };
      }
    } catch {
      // Ignore and try next path
    }
  }
  return { found: false, entries: [] };
}

export async function scanPublicGitHubRepository(params: {
  repoUrl: string;
  limit: number;
  stateFilter: 'all' | 'open';
  existingVouchEntries: VouchEntry[];
  policy: ProjectPolicy;
}): Promise<RepoScanReport> {
  const { owner, repo } = parseGitHubRepoUrl(params.repoUrl);
  const clampedLimit = Math.min(20, Math.max(1, Math.round(params.limit || 10)));
  const stateFilter = params.stateFilter === 'open' ? 'open' : 'all';
  const remainingQuota: { current: number | null } = { current: null };

  // 1. Fetch repository metadata (REST API with automatic zero-quota web fallback)
  const repoMeta = await fetchRepoMetadataWithFallback(owner, repo, remainingQuota);

  // 2. Fetch VOUCHED.td (raw -> 0 quota), repo file tree (Git CLI -> 0 quota), and latest N PRs in parallel
  const repoSlug = repoMeta.full_name.toLowerCase();
  const defaultBranch = repoMeta.default_branch || 'main';
  const [vouchedResult, repoTreePaths, pullsResult] = await Promise.all([
    tryFetchRepoVouchedTd(owner, repo, defaultBranch, repoSlug),
    fetchRepoTreePaths(owner, repo, defaultBranch, remainingQuota),
    fetchLatestPullsWithFallback(owner, repo, stateFilter, clampedLimit, remainingQuota),
  ]);

  const rawPulls = pullsResult.pulls;
  const usedWebFallback = repoMeta.usedWebFallback || pullsResult.usedWebFallback;

  // 3. Fetch real unified diffs in small batches of 5 (uses github.com web URL, 0 API quota)
  const diffsByPrNumber = new Map<number, ParsedDiffInfo>();
  for (let i = 0; i < rawPulls.length; i += 5) {
    const batch = rawPulls.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (pr) => ({
        prNumber: pr.number,
        diff: await fetchRawDiff(pr.diff_url),
      }))
    );
    for (const item of results) {
      diffsByPrNumber.set(item.prNumber, item.diff);
    }
  }

  // 4. Fetch unique contributor GitHub profiles (cached & quota-guarded)
  const uniqueAuthors = Array.from(
    new Set(
      rawPulls
        .filter((p) => p.user && p.user.type !== 'Bot')
        .map((p) => p.user!.login)
    )
  );
  const authorSignalsMap = new Map<string, CachedUserSignals>();
  let profileLookupSkippedDueToQuota = false;

  for (let i = 0; i < uniqueAuthors.length; i += 4) {
    const batch = uniqueAuthors.slice(i, i + 4);
    const resList = await Promise.all(
      batch.map(async (login) => ({
        login,
        res: await fetchUserSignals(login, remainingQuota),
      }))
    );
    for (const { login, res } of resList) {
      authorSignalsMap.set(login.toLowerCase(), res.signals);
      if (res.quotaSkipped) profileLookupSkippedDueToQuota = true;
    }
  }

  // Combine repo VOUCHED.td entries with observer VouchMesh entries
  const combinedVouchesByHandle = new Map<string, VouchEntry>();
  for (const entry of [...params.existingVouchEntries, ...vouchedResult.entries]) {
    if (entry.voucherHandle) continue; // Project-level vouch/denounce
    const handle = entry.contributorHandle.toLowerCase();
    // Prefer repo's own VOUCHED.td or any denounced flag
    const existing = combinedVouchesByHandle.get(handle);
    if (!existing || entry.projectId === repoSlug || entry.status === 'denounced') {
      combinedVouchesByHandle.set(handle, entry);
    }
  }

  // 5. Build PullRequestEvent records & compute SimHash fingerprints
  const simhashesByPr = new Map<number, bigint>();
  const prEventsByNumber = new Map<number, PullRequestEvent>();

  for (const pr of rawPulls) {
    const login = (pr.user?.login ?? 'unknown').toLowerCase();
    const userSig = authorSignalsMap.get(login);
    const diffInfo = diffsByPrNumber.get(pr.number) ?? { diffText: '', filesChanged: [] };
    const vouchEntry = combinedVouchesByHandle.get(login);
    const isTrustedRole = ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(
      pr.author_association
    );

    const prEvent: PullRequestEvent = {
      id: `gh-${owner}-${repo}-${pr.number}`,
      kind: 'pr',
      prNumber: pr.number,
      projectId: repoSlug,
      authorHandle: login,
      accountAgeDays: userSig?.accountAgeDays ?? 30,
      publicMergedPrs: pr.merged_at
        ? 1
        : vouchEntry?.status === 'vouched' || isTrustedRole
          ? 2
          : 0,
      createdAt: pr.created_at,
      title: pr.title,
      body: pr.body ?? '',
      filesChanged: diffInfo.filesChanged,
      diffText: diffInfo.diffText,
    };
    prEventsByNumber.set(pr.number, prEvent);
    simhashesByPr.set(pr.number, computePrSimHash(prEvent));
  }

  // Detect duplicate/near-identical PR submissions inside the scanned batch
  const duplicatesByPr = new Map<number, { others: number[]; similarityPercent: number }>();
  for (const prA of rawPulls) {
    const hashA = simhashesByPr.get(prA.number);
    if (!hashA) continue;
    const others: number[] = [];
    let bestSim = 0;
    for (const prB of rawPulls) {
      if (prA.number === prB.number) continue;
      const hashB = simhashesByPr.get(prB.number);
      if (!hashB) continue;
      const dist = hammingDistance64(hashA, hashB);
      if (dist <= 8) {
        others.push(prB.number);
        const sim = Math.round(((64 - dist) / 64) * 100);
        if (sim > bestSim) bestSim = sim;
      }
    }
    if (others.length > 0) {
      duplicatesByPr.set(prA.number, { others, similarityPercent: bestSim });
    }
  }

  // 6. Evaluate each PR deterministically & generate clear "Genuine vs Why Not" reasons
  const results: ScannedPrResult[] = rawPulls.map((pr) => {
    const login = pr.user?.login ?? 'unknown';
    const loginLower = login.toLowerCase();
    const authorType: 'User' | 'Bot' = pr.user?.type === 'Bot' ? 'Bot' : 'User';
    const userSig = authorSignalsMap.get(loginLower);
    const diffInfo = diffsByPrNumber.get(pr.number) ?? {
      diffText: '',
      filesChanged: [],
      newFiles: [],
      modifiedExistingFiles: [],
      wiredNewFiles: [],
      codeLinesChanged: 0,
    };
    const prEvent = prEventsByNumber.get(pr.number)!;
    const { findings, positiveSignals } = analyzePullRequestDiff(prEvent);
    const {
      similarExistingFiles,
      unwiredNewFiles,
      projectImportance,
      importanceReason,
    } = analyzeRepoOverlapAndImportance({
      title: pr.title,
      body: pr.body ?? '',
      diffInfo,
      repoPaths: repoTreePaths,
      findings,
      positiveSignals,
    });
    const vouchEntry = combinedVouchesByHandle.get(loginLower);
    const vouchedStatus: VouchStatus | null = vouchEntry?.status ?? null;
    const dupInfo = duplicatesByPr.get(pr.number);

    const isCollaborator = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association);
    const isKnownAutomationBot =
      authorType === 'Bot' &&
      (Boolean(pr.merged_at) ||
        ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(pr.author_association) ||
        /^(dependabot|renovate|github-actions|allcontributors)\[bot\]$/i.test(loginLower));
    // Trusted role exemption applies STRICTLY to recurring template similarity,
    // never to diff security findings, conflict markers, or cross-repo blasts.
    const isSimilarityExemptRole =
      vouchedStatus !== 'denounced' &&
      (isCollaborator || vouchedStatus === 'vouched' || isKnownAutomationBot);

    const genuineReasons: string[] = [];
    const notGenuineReasons: string[] = [];
    const reviewNotes: string[] = [];

    // Trust & History Signals
    if (vouchedStatus === 'vouched') {
      genuineReasons.push(
        `Contributor @${login} is explicitly vouched (${vouchEntry?.reason ?? 'VOUCHED.td'}).`
      );
    } else if (vouchedStatus === 'denounced') {
      notGenuineReasons.push(
        `Contributor @${login} is denounced in VOUCHED.td / VouchMesh (${vouchEntry?.reason ?? 'prior abuse flag'}).`
      );
    }

    if (isCollaborator) {
      genuineReasons.push(
        `Author has elevated repository role (${pr.author_association}) on ${repoMeta.full_name}.`
      );
    } else if (pr.author_association === 'CONTRIBUTOR') {
      genuineReasons.push(
        `Author is an established prior contributor (CONTRIBUTOR) with earlier merged commits in this repo.`
      );
    }

    if (pr.merged_at) {
      genuineReasons.push(`Pull request was reviewed and merged into ${repoMeta.default_branch}.`);
    }

    if (authorType === 'Bot') {
      genuineReasons.push(`Automated GitHub bot account (@${login}) recognized by GitHub.`);
    } else if (userSig?.accountAgeDays !== null && userSig?.accountAgeDays !== undefined) {
      if (!userSig.accountAgeIsLowerBound && userSig.accountAgeDays < params.policy.freshAccountAgeDays) {
        notGenuineReasons.push(
          `Brand-new GitHub account (${userSig.accountAgeDays} days old, threshold ${params.policy.freshAccountAgeDays}d) with elevated spam/throwaway risk.`
        );
      } else if (userSig.accountAgeDays >= 180 && (userSig.publicRepos ?? 0) >= 3) {
        genuineReasons.push(
          `Established GitHub profile (${userSig.accountAgeIsLowerBound ? 'at least ' : ''}${userSig.accountAgeDays} days active · ${userSig.publicRepos} public repositories).`
        );
      } else if (userSig.accountAgeDays >= 30) {
        genuineReasons.push(
          `Active GitHub contribution history spanning ${userSig.accountAgeIsLowerBound ? 'at least ' : ''}${userSig.accountAgeDays} days.`
        );
      }
    }

    // Cross-repo PR blast signal (applies regardless of collaborator/vouch role)
    if (
      authorType === 'User' &&
      userSig?.recentPrReposCount !== null &&
      userSig?.recentPrReposCount !== undefined &&
      userSig.recentPrReposCount >= 4 &&
      ((userSig.accountAgeDays !== null && userSig.accountAgeDays < 45) ||
        pr.author_association === 'FIRST_TIME_CONTRIBUTOR' ||
        pr.author_association === 'NONE')
    ) {
      notGenuineReasons.push(
        `Recent public activity shows PRs opened across ${userSig.recentPrReposCount} distinct repositories (${userSig.recentPrCount} PR events) without established maintainer trust.`
      );
    }

    // Static diff findings (ALWAYS enforced on collaborators, bots, and owners alike)
    for (const f of findings) {
      notGenuineReasons.push(`${f.ruleId} (${f.severity.toUpperCase()}) in ${f.file}: ${f.explanation}`);
    }

    // Codebase overlap & standalone file signals
    if (similarExistingFiles.length > 0) {
      notGenuineReasons.push(
        `Similar module/file(s) already exist in the repository (${similarExistingFiles.slice(0, 3).join(', ')}) — verify this PR does not duplicate existing functionality.`
      );
    }
    if (unwiredNewFiles.length > 0) {
      notGenuineReasons.push(
        `Adds standalone code file(s) (${unwiredNewFiles.slice(0, 2).join(', ')}) without wiring imports or callers into existing repository files.`
      );
    }

    // Duplicate SimHash cluster detection (ONLY similarity is exempt for trusted bots/collaborators)
    const duplicateFlagActive = Boolean(dupInfo && dupInfo.others.length > 0 && !isSimilarityExemptRole);
    if (dupInfo && dupInfo.others.length > 0) {
      if (isSimilarityExemptRole) {
        genuineReasons.push(
          `Matches recurring template of PR ${dupInfo.others.map((n) => `#${n}`).join(', ')} (${dupInfo.similarityPercent}% SimHash) — similarity exemption applied for trusted bot/collaborator.`
        );
      } else {
        notGenuineReasons.push(
          `Near-duplicate submission (${dupInfo.similarityPercent}% SimHash similarity with PR ${dupInfo.others
            .map((n) => `#${n}`)
            .join(', ')}), typical of automated spam waves.`
        );
      }
    }

    // Positive code signals & impact
    if (projectImportance === 'HIGH') {
      genuineReasons.push(importanceReason);
    }
    for (const s of positiveSignals) {
      genuineReasons.push(`${s.signalId}: ${s.description}`);
    }

    if (
      diffInfo.filesChanged.length > 0 &&
      findings.length === 0 &&
      !duplicateFlagActive &&
      positiveSignals.length === 0 &&
      projectImportance !== 'HIGH'
    ) {
      genuineReasons.push(
        `Touches ${diffInfo.filesChanged.length} file(s) with zero high-risk hooks, obfuscated payloads, or spam churn patterns.`
      );
    }

    // Compute final deterministic verdict based on code merit, safety, and slop signals
    // (rather than holding helpful small/newcomer/clean-AI PRs back on contributor tenure alone).
    const hasHighDiffRisk = findings.some((f) => f.severity === 'high');
    const mediumFindings = findings.filter((f) => f.severity === 'medium');
    const hasMediumDiffRisk = mediumFindings.length > 0;
    const hasTrivialChurn = findings.some((f) => f.ruleId === 'TRIVIAL_DOC_CHURN');
    const isFreshAccount =
      !userSig?.accountAgeIsLowerBound &&
      userSig?.accountAgeDays !== null &&
      userSig?.accountAgeDays !== undefined &&
      userSig.accountAgeDays < params.policy.freshAccountAgeDays;
    const isUnestablishedAuthor =
      authorType === 'User' &&
      !['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(pr.author_association) &&
      !pr.merged_at &&
      vouchedStatus !== 'vouched';
    const hasHelpfulCodeEdit =
      findings.length === 0 &&
      positiveSignals.some((s) =>
        ['SURGICAL_CODE_FIX', 'FOCUSED_SOURCE_PATCH', 'INCLUDES_UNIT_TESTS'].includes(s.signalId)
      );
    // Cross-repo PR activity only indicates automated spam blast if account is fresh OR lacks clean high-impact code
    const hasCrossRepoBlast =
      authorType === 'User' &&
      (userSig?.recentPrReposCount ?? 0) >= 4 &&
      (isFreshAccount || (isUnestablishedAuthor && (projectImportance !== 'HIGH' || findings.length > 0 || unwiredNewFiles.length > 0)));
    const hasRedundantLowImpactAddition =
      projectImportance === 'LOW' &&
      similarExistingFiles.length > 0 &&
      unwiredNewFiles.length > 0;

    let verdict: RepoScanVerdict = 'NEWCOMER_REVIEW';

    if (
      hasHighDiffRisk ||
      vouchedStatus === 'denounced' ||
      duplicateFlagActive ||
      hasCrossRepoBlast ||
      mediumFindings.length >= 2 ||
      (hasTrivialChurn && !hasHelpfulCodeEdit) ||
      (hasRedundantLowImpactAddition && !hasHelpfulCodeEdit) ||
      (hasMediumDiffRisk && (isFreshAccount || unwiredNewFiles.length > 0))
    ) {
      verdict = 'NOT_GENUINE';
    } else if (hasMediumDiffRisk) {
      // Even a collaborator/bot or established user with a bad-code/slop warning (empty catch, stubs, conflict marker, unsafe any) must be reviewed
      verdict = 'NEWCOMER_REVIEW';
      reviewNotes.push(
        `Code quality warning (${mediumFindings.map((f) => f.ruleId).join(', ')}) detected in the diff — requires manual inspection before merging.`
      );
    } else if (
      vouchedStatus === 'vouched' ||
      ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(pr.author_association) ||
      pr.merged_at ||
      authorType === 'Bot' ||
      (findings.length === 0 &&
        unwiredNewFiles.length === 0 &&
        (projectImportance === 'HIGH' || hasHelpfulCodeEdit))
    ) {
      verdict = 'GENUINE';
      if (
        isUnestablishedAuthor &&
        findings.length === 0 &&
        (projectImportance === 'HIGH' || hasHelpfulCodeEdit)
      ) {
        genuineReasons.push(
          'Code merit verified: clean diff passes static quality checks and directly improves or integrates with repository code (approved on code value rather than newcomer tenure).'
        );
      }
    } else {
      verdict = 'NEWCOMER_REVIEW';
      reviewNotes.push(
        unwiredNewFiles.length > 0
          ? `Adds standalone new code file(s) (${unwiredNewFiles.slice(0, 2).join(', ')}) without wiring them into existing project files — verify integration before merging.`
          : `No security hooks or bad-code patterns found, but the PR makes minimal functional code changes for repository verification — quick human check recommended.`
      );
    }

    if (verdict === 'GENUINE' && genuineReasons.length === 0) {
      genuineReasons.push('Clean code diff with established contributor profile.');
    }

    return {
      prNumber: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      htmlUrl: pr.html_url,
      state: pr.state,
      merged: Boolean(pr.merged_at),
      createdAt: pr.created_at,
      authorHandle: login,
      authorUrl: pr.user?.html_url ?? `https://github.com/${login}`,
      authorType,
      authorAssociation: pr.author_association || 'NONE',
      accountAgeDays: userSig?.accountAgeDays ?? null,
      publicRepos: userSig?.publicRepos ?? null,
      recentPrReposCount: userSig?.recentPrReposCount ?? null,
      filesChanged: diffInfo.filesChanged,
      diffPreview: diffInfo.diffText.slice(0, 3500),
      simhashHex: formatSimHashHex(simhashesByPr.get(pr.number) ?? 0n),
      duplicatePrNumbers: dupInfo?.others ?? [],
      similarityPercent: dupInfo?.similarityPercent ?? null,
      projectImportance,
      importanceReason,
      similarExistingFiles,
      unwiredNewFiles,
      verdict,
      genuineReasons,
      notGenuineReasons,
      reviewNotes,
      diffFindings: findings,
      positiveSignals,
      vouchedStatus,
    };
  });

  const summary = {
    genuine: results.filter((r) => r.verdict === 'GENUINE').length,
    newcomerReview: results.filter((r) => r.verdict === 'NEWCOMER_REVIEW').length,
    notGenuine: results.filter((r) => r.verdict === 'NOT_GENUINE').length,
  };

  return {
    repoFullName: repoMeta.full_name,
    repoUrl: repoMeta.html_url,
    description: repoMeta.description ?? '',
    stars: repoMeta.stargazers_count,
    defaultBranch: repoMeta.default_branch,
    repoFilesIndexed: repoTreePaths.length,
    requestedCount: clampedLimit,
    scannedCount: results.length,
    stateFilter,
    vouchedTdFound: vouchedResult.found,
    vouchedTdCount: vouchedResult.entries.length,
    rateLimitRemaining: remainingQuota.current,
    profileLookupSkippedDueToQuota,
    dataSource: usedWebFallback ? 'github_web_git' : 'github_api',
    summary,
    scannedAt: new Date().toISOString(),
    results,
  };
}
