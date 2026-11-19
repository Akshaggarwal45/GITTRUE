TrueGit: Decentralized Contributor Trust Network & Live PR Checker

Autonomous, privacy-preserving open-source PR & issue triage built on the Ghostty VOUCHED.td specification.

Built for open-source maintainers to inspect live GitHub pull requests, defeat coordinated spam campaigns, isolate Sybil clusters, and admit genuine newcomers on code merit — with zero AI/LLM hallucinations and no external API keys required.

Core Features

1. Live Public Repository PR Checker (Repo PR Checker)

Zero-Setup GitHub Inspection: Paste any public GitHub URL or owner/repo slug (e.g., https://github.com/ghostty-org/ghostty or vitejs/vite) and scan the latest 1–20 pull requests (All Latest or Open Only).

Project Importance & Codebase Overlap: Indexes the repository's full file tree via treeless shallow git clone (0 REST API quota) to detect whether a PR introduces unwired standalone files (unwiredNewFiles) or duplicates existing repository modules (similarExistingFiles), while classifying impact as HIGH, MODERATE, or LOW.

Code-Merit Verdicts: Assigns every PR a clear GENUINE, NEWCOMER_REVIEW (Manual Review), or NOT_GENUINE verdict with explicit bulleted reasons—rewarding clean surgical fixes even from first-time contributors while holding diffs with quality or security warnings regardless of author role.

VOUCHED.td Auto-Discovery: Automatically fetches VOUCHED.td or .github/VOUCHED.td from the target repository's default branch.

Zero-Quota Fallback: Uses Git smart HTTP (git clone --filter=blob:none), raw .diff endpoints, and GitHub Web/Atom fallbacks if unauthenticated REST API rate limits are exhausted (optional GITHUB_TOKEN supported for higher API throughput).

One-Click Triage Import: Send any scanned GitHub PR directly into the local PR & Issue Triage queue (Send to Triage Queue).

2. PR & Issue Triage Queue + Evidence Drawer (PR & Issue Triage)

Unified Triage Stream: Evaluates both Pull Requests (pr) and GitHub Issues (issue) from the perspective of the selected observing project (Observing as Project switcher).

Three-Tier Verdicts: Routes submissions into VOUCHED, NEWCOMER_REVIEW (never auto-blocking honest newcomers), or FLAGGED.

Explainable Evidence Drawer: Displays the step-by-step Decision Evidence Trace, transitive trust path weights, voucher credibility & dilution multipliers, SimHash cluster membership, static diff findings, and raw patch diff / issue body.

Interactive Actions: Vouch, denounce, file an appeal, or inject custom scenarios via the Simulate Incoming PR / Issue modal (includes presets for Honest Hackathon Student, Campaign Spam Variant, Fake Bug Wave Issue, and Malicious postinstall Hook).

3. Deterministic Static Diff & Metadata Inspection

Zero LLM guessing—every finding is triggered by verifiable rules in src/engine/diffAnalyzer.ts:

Supply-Chain & CI Risks (High): INSTALL_OR_CI_EXECUTION_HOOK (postinstall/preinstall + curl|sh or secrets.*), OBFUSCATED_EXECUTION_PATTERN (eval(atob(...)), base64 exec, hex chains), EXTERNAL_EXFIL_ENDPOINT, HARDCODED_CREDENTIAL_OR_SECRET, UNSAFE_DYNAMIC_EXECUTION (eval, new Function, dangerouslySetInnerHTML, child_process.exec), ISSUE_SUSPICIOUS_EXTERNAL_LINK.

Code Quality & Slop Warnings (Medium/Low): UNVOUCHED_WORKFLOW_EDIT, HIGH_ENTROPY_BLOB (Shannon entropy > 4.6), UNRESOLVED_CONFLICT_MARKER, EMPTY_CATCH_OR_SILENT_ERROR, UNFINISHED_STUB_OR_DEBUG, LEFTOVER_DEBUG_OR_TODO, UNSAFE_TYPE_SUPPRESSION (any / @ts-ignore / eslint-disable), TRIVIAL_DOC_CHURN, LOW_SUBSTANCE_ISSUE_REPORT.

Positive Merit Signals: INCLUDES_UNIT_TESTS, SURGICAL_CODE_FIX, FOCUSED_SOURCE_PATCH, REFERENCES_ISSUE, DETAILED_ISSUE_REPRO.

4. Asymmetric Voucher Reputation & 100-Fake-Account Defense (Voucher Reputation)

Slow Climb, Rapid Slash: Project and person-to-person (Person B → Person A) voucher credibility climbs slowly (+0.04 per verified good vouch) and slashes 5.5× faster (-0.22 per bad vouch).

24-Hour Vouch Budget Dilution: Projects exceeding their daily budget (6 vouches/24h by default) have individual vouch weights diluted proportionally (budget / recent24hVouches, e.g., 6 / 100 = 0.06x).

Burst Circuit Breaker: Sudden high-volume spikes (≥ 10 vouches in 24h or mass-vouching fresh accounts) trigger automatic burst quarantine, holding burst-vouched fresh accounts in NEWCOMER_REVIEW.

Fresh-Account Cap: Accounts < 14 days old with 0 prior merged PRs require ≥ 2 independent vouch sources or 1 merged PR before fast-tracking to VOUCHED.

1-Click Rogue Attack Simulator: Test a compromised trusted peer (zig-stdx) injecting 100 fake accounts + 5 PRs and verify all 5 are blocked from VOUCHED.

5. Personalized Web-of-Trust Graph (Trust Graph)

26-Project Federated Topology: Interactive SVG graph computing directed, hop-decayed Dijkstra trust (0.65 decay per hop, max 3 hops) from the observer's seed node.

Sybil Ring Isolation: Isolated mutual-vouch cliques (sybil-alpha..delta) and mutual-vouch user rings without seed grounding receive 0.00 trust.

Hostile-Node Damping: Projects with anomalous denounce ratios (e.g., rogue-lint) are automatically damped to 0.15× and cannot unilaterally block contributors without multi-project corroboration.

Live Edge Controls: Click any peer node to adjust or sever your direct trust weight.

6. Privacy-Preserving SimHash Campaign Radar (Campaign Radar)

Strips author handles, repository names, and numeric constants, then computes a 64-bit FNV-1a SimHash over normalized titles, bodies, and diff shingles.

Flags both cross-project spam waves (CMP-: ≥ 3 projects within 6h, Hamming distance ≤ 14) and same-repo duplicate submissions (DUP-: ≥ 2 distinct authors on the same repo, Hamming distance ≤ 8) with zero PII stored in the cluster index.

7. Ghostty VOUCHED.td Feeds, Appeals & Per-Project Policy Lab

VOUCHED.td Feeds: Live editor, parser, and serializer supporting github:, gitlab:, codeberg:, and -github:handle # reason denouncements with instant network re-evaluation.

Appeals & Audit: Contributors can dispute denouncements (pending appeals damp penalty by 50%); maintainers can Overturn & Restore or Uphold Flag with an append-only audit log.

Policy & Benchmark Lab: Tune per-project gain/slash rates, 24h vouch budgets, burst freeze thresholds, hop decay, and corroboration rules while watching live benchmark metrics update.

Why We Approve vs. Why We Flag (Decision Logic)

Every submission in both the PR & Issue Triage queue and the Live Public Repository PR Checker surfaces explicit, auditable reasons explaining why it was approved, held for review, or flagged.

Why Something Is Approved (VOUCHED / GENUINE)

Verified Code Merit (Live Repo Checker): Even if a contributor is new (NONE / FIRST_TIME_CONTRIBUTOR), a PR is approved as GENUINE when it passes all static safety checks, wires new files cleanly, and provides HIGH project impact or clean surgical source/test updates (e.g., vitejs/vite#24152 by @Ultroncn, oven-sh/bun#49294 by @i098).

Transitive Trust Threshold Met (Triage Queue): Net trust score meets or exceeds vouchThreshold (>= 0.35), denounceWeightSum < 0.25, and zero static medium/high code warnings are present.

Repository Role / VOUCHED.td / Merged Status: Author is explicitly listed in VOUCHED.td (e.g., ghostty-org/ghostty 425-entry list), holds an elevated repository association (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR), is a recognized automation bot (dependabot[bot], ghostty-vouch[bot]), or the PR is already merged and has zero medium/high diff warnings.

Why Something Is Flagged (FLAGGED / NOT_GENUINE)

High-Severity Static Diff & Supply-Chain Risks: Triggers immediately—even for trusted roles—on INSTALL_OR_CI_EXECUTION_HOOK (postinstall + curl|sh or secrets.*), OBFUSCATED_EXECUTION_PATTERN (eval(atob(...))), EXTERNAL_EXFIL_ENDPOINT, HARDCODED_CREDENTIAL_OR_SECRET, UNSAFE_DYNAMIC_EXECUTION (eval, new Function, dangerouslySetInnerHTML, child_process.exec), or ISSUE_SUSPICIOUS_EXTERNAL_LINK.

Coordinated Spam Waves & Duplicate PRs (SimHash): Matches a cross-project spam wave (>= 3 projects within 6h, Hamming distance <= 14) or a same-repo duplicate cluster (>= 2 distinct authors, Hamming distance <= 8) without a trusted bot/collaborator exemption.

Explicit Denouncement (-github:handle): Author is denounced in VOUCHED.td or corroborated across >= 2 independent trusted projects with denounceWeightSum >= 0.70 (or >= 0.90 direct observer denouncement with no pending appeal).

Cross-Repo Spam Blast: Unestablished or fresh (< 14d) account opening PRs across >= 4 distinct repositories without clean high-impact code.

Multiple Quality Defects or Redundant Low-Impact Churn: >= 2 medium-severity code defects, trivial markdown/whitespace farming (TRIVIAL_DOC_CHURN), or LOW-impact unwired standalone files duplicating existing modules in the repository.

Why Something Is Held for Manual / Newcomer Review (NEWCOMER_REVIEW)

Code-Quality Warnings on Otherwise Trusted/Clean PRs: Triggered when a single medium-severity defect is detected—such as UNSAFE_TYPE_SUPPRESSION (caught on colinhacks/zod#6764), HIGH_ENTROPY_BLOB (caught on oven-sh/bun#49291), EMPTY_CATCH_OR_SILENT_ERROR, UNFINISHED_STUB_OR_DEBUG, or UNRESOLVED_CONFLICT_MARKER.

Fair Newcomer Protection: First-time contributors with no prior network vouches or denouncements are never auto-blocked; they stay in NEWCOMER_REVIEW so maintainers can verify minimal diffs or unwired new files (unwiredNewFiles).

Burst Quarantine & Fresh-Account Cap: Fresh accounts (< 14d, 0 prior PRs) vouched by a compromised peer in a 24h mass-vouch spike (e.g., the 100-fake-account attack) or backed by only 1 peer are held in NEWCOMER_REVIEW rather than fast-tracked to VOUCHED.

Isolated Sybil / Hostile False-Flag Damping: Mutual-vouch Sybil rings get 0.00 trust and unilateral denouncements from anomalous/hostile peers (rogue-lint) are damped (0.15x), keeping honest contributors safely in NEWCOMER_REVIEW.

Quick Start: Commands to Run

Prerequisites

Node.js >= 20 and npm

Git CLI installed on PATH (used for fast treeless git ls-tree file indexing during live GitHub scans)

1. Install Dependencies

npm install

2. Start the Application (Development Mode)

Starts the Express API server + Vite React frontend together on port 3000:

npm run dev

Then open http://localhost:3000 in your browser.

3. Typecheck, Build & Run in Production Mode

TypeScript typecheck (no emit)

npm run lint

Build production frontend bundle into dist/

npm run build

Start production Express server on http://0.0.0.0:3000

NODE_ENV=production npm start

4. Optional Environment Variable (Higher GitHub API Rate Limits)

TrueGit works out of the box with no API keys using public GitHub endpoints and zero-quota git / web fallbacks. If you scan many repositories rapidly, you can optionally export a GitHub personal access token before starting the server:

export GITHUB_TOKEN="your_github_pat_here"
npm run dev

5. Run CLI Smoke Tests & Live Open-Source Repo Scans

With dependencies installed, you can test the core trust engine and scan any real public GitHub repository directly from your terminal:

1. Verify the trust engine benchmark + 100-fake rogue attack simulation

npx tsx -e "
import { createInitialAppeals, createInitialProjects, createInitialPullRequests, createInitialVouchEntries, DEFAULT_POLICY, DEFAULT_REFERENCE_NOW, generateRogueMassVouchAttack } from './src/engine/dataset.ts';
import { evaluatePullRequestStream } from './src/engine/policyEngine.ts';

const projects = createInitialProjects();
const vouches = createInitialVouchEntries();
const prs = createInitialPullRequests();
const appeals = createInitialAppeals();

const base = evaluatePullRequestStream('acme-runtime', prs, projects, vouches, appeals, DEFAULT_POLICY, DEFAULT_REFERENCE_NOW);
console.log('Baseline metrics:', base.metrics);

const rogue = generateRogueMassVouchAttack('zig-stdx', 'acme-runtime', DEFAULT_REFERENCE_NOW);
const attacked = evaluatePullRequestStream('acme-runtime', [...rogue.fakePrs, ...prs], projects, [...rogue.fakeVouches, ...vouches], appeals, DEFAULT_POLICY, DEFAULT_REFERENCE_NOW);
console.log('100-fake attack metrics:', attacked.metrics);
"

2. Scan a real public GitHub repository via HTTP API (while server is running on port 3000)

curl -s -X POST http://localhost:3000/api/scan-repo 
-H "Content-Type: application/json" 
-d '{"repoUrl":"https://github.com/ghostty-org/ghostty","limit":5,"stateFilter":"all"}' | head -c 1000

Real Open-Source Project Test Results

Verified live against public GitHub repositories using scanPublicGitHubRepository (read-only; no comments or issues posted to any repository):

Repository| Scope| Repo Files Indexed| VOUCHED.td Detected| Verdicts (Genuine / Manual Review / Not Genuine)| Notable Verified Behavior
ghostty-org/ghostty (64,247 stars)| Latest 5 PRs (all)| 6,003 files| Yes (425 entries)| 5 / 0 / 0| Loaded live VOUCHED.td; recognized ghostty-vouch[bot] & core PRs (#15285, #15280, #15277, #15275, #15272) with 0 false flags.
vitejs/vite (83,981 stars)| Latest 5 PRs (all)| 3,016 files| No| 5 / 0 / 0| Approved PR #24152 (fix(types): add missing '*?url&raw' module declaration) from non-member @Ultroncn (NONE) as GENUINE on clean code merit.
colinhacks/zod (44,357 stars)| Latest 5 PRs (all)| 746 files| No| 4 / 1 / 0| Held PR #6764 (by repo OWNER) for NEWCOMER_REVIEW due to UNSAFE_TYPE_SUPPRESSION (any / @ts-ignore / eslint-disable), proving diff safety checks are never bypassed by author role.
oven-sh/bun (96,767 stars)| Latest 5 PRs (open)| 100,377 files| No| 4 / 1 / 0| Indexed 100k+ files via treeless git clone; approved newcomer PR #49294 (sendfile optimization) as GENUINE and held PR #49291 (Add Bun.diff) for review due to HIGH_ENTROPY_BLOB + 5 similar existing files.

Simulated Stream Benchmark Results

Verified across the 23-item synthetic PR/Issue stream and the 28-item 100-fake-account rogue attack stream (acme-runtime observer):

Metric| Result| Benchmark Target| Status
Campaign & Duplicate Spam Recall| 100% (12 / 12 caught)| >= 90%| Passed
Malicious Code Diffs Flagged| 100% (3 / 3 caught)| 100%| Passed
Newcomer & Fair Review Inclusion| 100% (4 / 4 newcomers + 1 / 1 falsely denounced protected)| >= 95%| Passed
Trusted Regulars Fast-Tracked| 100% (2 / 2 vouched)| 100%| Passed
False Positive Rate| 0% (0 false flags on healthy contributors)| <= 2%| Passed
Rogue 100-Fake PRs Blocked| 5 / 5 blocked from VOUCHED| 100%| Passed
Sybil Clusters & Rings Neutralized| 6 isolated (4 Sybil project nodes + 2 mutual-vouch user accounts)| 100% isolation| Passed

Architecture & File Map

Layer| Files| Responsibilities
Trust & Detection Engine| src/engine/types.ts, src/engine/vouchParser.ts, src/engine/campaignDetector.ts, src/engine/diffAnalyzer.ts, src/engine/reputationEngine.ts, src/engine/trustGraph.ts, src/engine/policyEngine.ts, src/engine/githubScanner.ts| VOUCHED.td parser/serializer, 64-bit privacy SimHash clustering, deterministic static diff inspection, asymmetric reputation (+0.04 / -0.22), Dijkstra trust graph, policy engine, and live GitHub PR + codebase overlap scanner.
Backend API & Seed Network| server.ts, src/engine/dataset.ts| Express + Vite dev/prod server (/api/state, /api/scan-repo, /api/vouch, /api/trust-edge, /api/vouched-td/, /api/prs, /api/simulate/rogue-mass-vouch, /api/appeals/, /api/policy, /api/reset), 26-project topology, and attack generator.
Frontend Cockpit| src/App.tsx, src/types/api.ts, src/components/TriageQueueView.tsx, src/components/RepoScannerView.tsx, src/components/ReputationView.tsx, src/components/TrustGraphView.tsx, src/components/CampaignRadarView.tsx, src/components/VouchedTdView.tsx, src/components/AppealsAuditView.tsx, src/components/PolicyLabView.tsx, src/components/SubmitPrModal.tsx| Multi-view maintainer cockpit with triage queue, live GitHub PR checker, voucher credibility simulator, interactive SVG trust graph, campaign radar, VOUCHED.td editor, appeals workflow, and policy tuning lab.

Prior Work & Safety Disclosure

Prior Work: Extends Ghostty's VOUCHED.td manual vouch/denounce lists with decentralized weighted trust propagation, multi-project corroboration, asymmetric voucher credibility, Sybil/burst isolation, static diff + codebase overlap inspection, and privacy-preserving SimHash campaign detection.

Read-Only Live Scanning: The Repo PR Checker performs strictly read-only inspection of public GitHub repositories. It never creates commits, comments, reviews, or issues on any GitHub repository.
