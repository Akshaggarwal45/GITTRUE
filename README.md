
# VouchMesh: Decentralized Contributor Trust Network

> **Autonomous, privacy-preserving open-source PR triage and transitive trust network built on the Ghostty `VOUCHED.td` specification.**  
> Built for open-source maintainers to defeat coordinated AI-generated spam campaigns, isolate Sybil clusters, and protect genuine newcomers — with **zero AI/LLM hallucinations** and **no external API keys required**.

---

## 👥 Team & Architecture Division (3 Members)

To ensure modularity and clear contribution separation across our 3 team members:

| Part | Member Role | Owned Components & Files | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Part 1** | **Trust Engine & Algorithmic Core** | `src/engine/types.ts`<br>`src/engine/campaignDetector.ts`<br>`src/engine/trustGraph.ts`<br>`src/engine/reputationEngine.ts`<br>`src/engine/diffAnalyzer.ts`<br>`src/engine/vouchParser.ts` | 64-bit privacy SimHash, transitive Dijkstra trust propagation, asymmetric reputation (+0.04 gain / -0.22 slash), 24h budget dilution & burst circuit breaker. |
| **Part 2** | **Backend Server & Federation API** | `server.ts`<br>`src/engine/policyEngine.ts`<br>`src/engine/dataset.ts`<br>`package.json`<br>`tsconfig.json` | Express + Vite API server, Ghostty import/export federation, 26-project peer network graph seed, 100-fake rogue attack generator, appeals pipeline. |
| **Part 3** | **Frontend Cockpit & Interactive Lab** | `src/App.tsx`<br>`src/components/*`<br>`src/index.css`<br>`index.html`<br>`vite.config.ts` | Interactive SVG Web-of-Trust graph, live triage queue with evidence drawer, campaign radar, policy lab sliders, live VOUCHED.td editor. |

---

## 🚀 Key Features

1. **Ghostty `VOUCHED.td` Compatible**: Full parser and serializer supporting standard format (`github:handle` and `-github:handle # reason`).
2. **Asymmetric Reputation Engine**: Reputation climbs slowly (+0.04 per verified good contribution) and slashes aggressively (-0.22 per bad vouch), ensuring vouch integrity.
3. **100-Fake Account Rogue Attack Mitigation**:
   - **24-Hour Vouch Budget Dilution**: Projects exceeding their daily budget have individual vouch weights diluted (`6 / 100 = 0.06x`).
   - **Burst Circuit Breaker**: Sudden mass-vouch spikes (≥ 10 fresh accounts in 24h) trigger immediate quarantine to Newcomer Review.
4. **Privacy-Preserving SimHash Campaign Radar**: Strips PII and computes 64-bit Hamming distance to detect cross-repository spam waves and same-repo duplicate PRs.
5. **Transitive Web-of-Trust (Dijkstra with Hop Decay)**: Hop-decayed trust (`0.65^hops`) with Sybil clique isolation (`0.00` trust) and hostile damping (`0.15x`).
6. **Newcomer Fast-Track & Protection**: Genuine first-time contributors with clean diffs or unit tests are guaranteed fair review and never auto-blocked.

---

## 🧪 Prior Work & Test Data Disclosure

- **Prior Work:** Extends Ghostty's `VOUCHED.td` manual vouch/denounce lists with decentralized weighted trust propagation, multi-project corroboration, asymmetric voucher credibility, Sybil/burst isolation, static diff inspection, and privacy-preserving SimHash campaign detection.
- **Test Data:** No automated issues or comments were posted to any real GitHub repositories. All evaluations use Ghostty's public `VOUCHED.td` format alongside a synthetic 26-project network and labeled PR/Issue stream.

---

## 🛠️ Quick Start

No API keys or cloud credentials needed! Runs entirely locally with Node.js.

```bash
# 1. Install dependencies
npm install

# 2. Start dev server (Express backend + Vite React frontend)
npm run dev

# 3. Open browser
# Navigate to http://localhost:3000
```

---

## 📊 Benchmark Results

| Metric | Result | Benchmark Target | Status |
| :--- | :--- | :--- | :--- |
| **Campaign Spam Recall** | **100%** (12/12 caught) | ≥ 90% | Passed |
| **Newcomer & Fair Review Inclusion** | **100%** (4/4 newcomers + 1/1 falsely denounced) | ≥ 95% | Passed |
| **False Positive Rate** | **0%** (0 false flags) | ≤ 2% | Passed |
| **Rogue 100-Fake PRs Blocked** | **5/5 blocked from Vouched** | 100% | Passed |
| **Sybil Clusters Neutralized** | **6 isolated** | 100% isolation | Passed |
