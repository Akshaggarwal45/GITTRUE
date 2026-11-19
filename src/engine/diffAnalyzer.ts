import type { DiffFinding, PositiveCodeSignal, PullRequestEvent } from './types.ts';

function shannonEntropy(input: string): number {
  if (!input.length) return 0;
  const counts = new Map<string, number>();
  for (const ch of input) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / input.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Deterministic static code, diff, and issue metadata inspection.
 * Explicitly avoids AI writing-style detection and intent classification,
 * focusing strictly on verifiable code, structural, and supply-chain anomalies.
 */
export function analyzePullRequestDiff(pr: PullRequestEvent): {
  findings: DiffFinding[];
  positiveSignals: PositiveCodeSignal[];
} {
  const findings: DiffFinding[] = [];
  const positiveSignals: PositiveCodeSignal[] = [];

  if (pr.kind === 'issue') {
    const bodyLower = pr.body.toLowerCase();
    const hasSuspiciousLink = /(webhook\.site|requestbin|ngrok\.io|bit\.ly|tinyurl\.com|https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i.test(
      pr.body
    );
    if (hasSuspiciousLink) {
      findings.push({
        ruleId: 'ISSUE_SUSPICIOUS_EXTERNAL_LINK',
        severity: 'high',
        file: 'issue-body',
        snippet: pr.body.slice(0, 100),
        explanation: 'Issue contains raw IP or disposable/shortened external URL characteristic of phishing or spam.',
      });
    }

    const referencesMissingPlaceholder =
      /(non-existent|does not exist|placeholder|v0\.0\.0-fake|src\/fake_|line 99999)/i.test(pr.body) ||
      (pr.body.trim().length < 35 && pr.accountAgeDays < 14);
    if (referencesMissingPlaceholder) {
      findings.push({
        ruleId: 'LOW_SUBSTANCE_ISSUE_REPORT',
        severity: 'low',
        file: 'issue-body',
        snippet: pr.body.slice(0, 100) || '(empty body)',
        explanation: 'Issue lacks concrete reproduction steps or references non-verifiable file/version details.',
      });
    }

    const hasReproDetails =
      /(steps to reproduce|expected|actual|stack trace|version|```)/i.test(bodyLower) &&
      pr.body.length >= 60;
    if (hasReproDetails && findings.length === 0) {
      positiveSignals.push({
        signalId: 'DETAILED_ISSUE_REPRO',
        description: 'Provides structured reproduction steps, expected/actual behavior, or code context.',
      });
    }

    return { findings, positiveSignals };
  }

  const addedLines = pr.diffText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));

  const addedText = addedLines.join('\n');

  // 1. Sensitive CI / Workflow / Install Hook modifications
  const sensitiveFiles = pr.filesChanged.filter((f) =>
    /(\.github\/workflows\/|package\.json$|setup\.py$|Makefile$|Dockerfile$)/i.test(f)
  );
  if (
    sensitiveFiles.length > 0 &&
    /(postinstall|preinstall|curl\s+.*\|.*sh|wget\s+.*\|.*bash|GITHUB_TOKEN|secrets\.[A-Z0-9_]+)/i.test(
      addedText
    )
  ) {
    findings.push({
      ruleId: 'INSTALL_OR_CI_EXECUTION_HOOK',
      severity: 'high',
      file: sensitiveFiles[0],
      snippet: addedLines.find((l) => /postinstall|preinstall|curl|wget|secrets\./i.test(l)) ?? sensitiveFiles[0],
      explanation:
        'Adds shell execution hooks, install scripts, or secret/token references inside CI or package manifest files.',
    });
  } else if (
    pr.filesChanged.some((f) => /\.github\/workflows\//i.test(f)) &&
    pr.publicMergedPrs === 0
  ) {
    findings.push({
      ruleId: 'UNVOUCHED_WORKFLOW_EDIT',
      severity: 'medium',
      file: pr.filesChanged.find((f) => /\.github\/workflows\//i.test(f)) ?? '.github/workflows',
      snippet: addedLines[0] ?? 'workflow modification',
      explanation:
        'First-time contributor modifies GitHub Actions workflow configuration, which requires elevated maintainer review.',
    });
  }

  // 2. Obfuscated payloads / high-entropy encoded blobs / eval
  const obfuscationMatch = addedLines.find((l) =>
    /(eval\s*\(\s*atob|Buffer\.from\s*\([^,]+,\s*['"]base64['"]\)|exec\s*\(\s*base64|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){6,})/i.test(
      l
    )
  );
  if (obfuscationMatch) {
    findings.push({
      ruleId: 'OBFUSCATED_EXECUTION_PATTERN',
      severity: 'high',
      file: pr.filesChanged[0] ?? 'unknown',
      snippet: obfuscationMatch.trim().slice(0, 110),
      explanation: 'Contains encoded/obfuscated runtime evaluation primitives (base64 decode + eval or hex escape chains).',
    });
  } else {
    const longHighEntropyLine = addedLines.find((l) => {
      const token = l.match(/[A-Za-z0-9+/=]{48,}/)?.[0];
      return token ? shannonEntropy(token) > 4.6 : false;
    });
    if (longHighEntropyLine) {
      findings.push({
        ruleId: 'HIGH_ENTROPY_BLOB',
        severity: 'medium',
        file: pr.filesChanged[0] ?? 'unknown',
        snippet: longHighEntropyLine.trim().slice(0, 96),
        explanation: 'Introduces a high-entropy encoded string (>= 48 chars) not typical of readable source code.',
      });
    }
  }

  // 3. Suspicious external exfiltration endpoints
  const exfilLine = addedLines.find((l) =>
    /(webhook\.site|requestbin|ngrok\.io|https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i.test(l)
  );
  if (exfilLine) {
    findings.push({
      ruleId: 'EXTERNAL_EXFIL_ENDPOINT',
      severity: 'high',
      file: pr.filesChanged[0] ?? 'unknown',
      snippet: exfilLine.trim().slice(0, 110),
      explanation: 'References raw IP endpoints or disposable webhook capture services in added code.',
    });
  }

  // 4. Hardcoded credentials / secret tokens in source code
  const secretLine = addedLines.find((l) => {
    const t = l.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return false;
    if (/process\.env\.|import\.meta\.env\.|os\.environ/i.test(t)) return false;
    return (
      /(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(t) ||
      /(?:api_?key|secret_?key|private_?key|password)\s*[:=]\s*['"][^'"]{10,}['"]/i.test(t)
    );
  });
  if (secretLine) {
    findings.push({
      ruleId: 'HARDCODED_CREDENTIAL_OR_SECRET',
      severity: 'high',
      file: pr.filesChanged[0] ?? 'unknown',
      snippet: secretLine.trim().slice(0, 96),
      explanation: 'Hardcodes an apparent API key, token, or credential literal directly in source code.',
    });
  }

  // 5. Unsafe dynamic execution outside test files (eval / new Function / dangerouslySetInnerHTML / shell exec)
  const nonTestCodeFiles = pr.filesChanged.filter(
    (f) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|php)$/i.test(f) &&
      !/(\.|_)(test|spec)\.|\/tests?\//i.test(f)
  );
  if (nonTestCodeFiles.length > 0 && !obfuscationMatch) {
    const unsafeExecLine = addedLines.find((l) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return false;
      return /\b(eval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|child_process\.exec\s*\()/i.test(t);
    });
    if (unsafeExecLine) {
      findings.push({
        ruleId: 'UNSAFE_DYNAMIC_EXECUTION',
        severity: 'high',
        file: nonTestCodeFiles[0],
        snippet: unsafeExecLine.trim().slice(0, 110),
        explanation:
          'Introduces unsafe dynamic code/HTML execution (eval, new Function, shell exec, or raw HTML injection) in production code.',
      });
    }
  }

  // 6. Merge conflict markers
  const brokenMarker = addedLines.find((l) => /^(<{7}|={7}|>{7})/.test(l.trim()));
  if (brokenMarker) {
    findings.push({
      ruleId: 'UNRESOLVED_CONFLICT_MARKER',
      severity: 'medium',
      file: pr.filesChanged[0] ?? 'unknown',
      snippet: brokenMarker.trim(),
      explanation: 'Diff introduces unresolved Git conflict markers.',
    });
  }

  // 7. Handwritten bad code & sloppy AI fallback patterns (per-file inspection)
  if (nonTestCodeFiles.length > 0) {
    const perFileAdded = new Map<string, string[]>();
    let curFile = nonTestCodeFiles[0];
    for (const rawLine of pr.diffText.split(/\r?\n/)) {
      if (rawLine.startsWith('diff --git ')) {
        const m = /^diff --git a\/.+ b\/(.+)$/.exec(rawLine);
        if (m?.[1]) curFile = m[1].trim();
      } else if (rawLine.startsWith('+++ b/')) {
        const f = rawLine.slice(6).trim();
        if (f && f !== '/dev/null') curFile = f;
      } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        const list = perFileAdded.get(curFile) ?? [];
        list.push(rawLine.slice(1));
        perFileAdded.set(curFile, list);
      }
    }

    const nonTestSet = new Set(nonTestCodeFiles);
    let foundEmptyCatch = false;
    let foundHardStub = false;
    let foundDebugOrTodo = false;
    let foundTypeBypass = false;

    for (const [filePath, fileLines] of perFileAdded.entries()) {
      if (!nonTestSet.has(filePath)) continue;
      const isCliOrScript =
        /(^|\/)(scripts|bin|cli|tools)\//i.test(filePath) ||
        /(lint|check|verify|cli|server)[^/]*\./i.test(filePath);

      if (!foundEmptyCatch) {
        const emptyCatchLine = fileLines.find((l) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l));
        if (emptyCatchLine) {
          foundEmptyCatch = true;
          findings.push({
            ruleId: 'EMPTY_CATCH_OR_SILENT_ERROR',
            severity: 'medium',
            file: filePath,
            snippet: emptyCatchLine.trim().slice(0, 110),
            explanation:
              'Adds an empty catch block that silently swallows runtime errors instead of handling or propagating them.',
          });
        }
      }

      if (!foundHardStub) {
        const hardStubLine = fileLines.find((l) => {
          const t = l.trim();
          return (
            /\bdebugger\b/.test(t) ||
            /throw\s+new\s+Error\s*\(\s*['"](not implemented|todo|stub|placeholder)/i.test(t)
          );
        });
        if (hardStubLine) {
          foundHardStub = true;
          findings.push({
            ruleId: 'UNFINISHED_STUB_OR_DEBUG',
            severity: 'medium',
            file: filePath,
            snippet: hardStubLine.trim().slice(0, 110),
            explanation: 'Contains a debugger statement or unimplemented placeholder error stub.',
          });
        }
      }

      if (!foundDebugOrTodo) {
        const debugLines = fileLines.filter((l) => {
          const t = l.trim();
          if (!t) return false;
          if (!isCliOrScript && /\bconsole\.(log|debug)\s*\(/.test(t)) return true;
          return /(\/\/|#)\s*(TODO|FIXME|HACK|XXX)\b/.test(t);
        });
        if (debugLines.length >= 3) {
          foundDebugOrTodo = true;
          findings.push({
            ruleId: 'LEFTOVER_DEBUG_OR_TODO',
            severity: 'low',
            file: filePath,
            snippet: debugLines[0].trim().slice(0, 110),
            explanation: `Contains ${debugLines.length} debug logs or TODO/FIXME notes in non-script code.`,
          });
        }
      }

      if (!foundTypeBypass) {
        const typeBypassLines = fileLines.filter((l) =>
          /:\s*any\b|\bas\s+any\b|@ts-ignore\b|@ts-nocheck\b|eslint-disable\b/.test(l)
        );
        if (typeBypassLines.length >= 3) {
          foundTypeBypass = true;
          findings.push({
            ruleId: 'UNSAFE_TYPE_SUPPRESSION',
            severity: 'medium',
            file: filePath,
            snippet: typeBypassLines[0].trim().slice(0, 110),
            explanation: `Introduces ${typeBypassLines.length} type-safety bypasses (any / @ts-ignore / eslint-disable), masking potential runtime bugs.`,
          });
        }
      }
    }
  }

  // 8. Trivial churn / zero-substance README or whitespace padding
  const onlyDocsOrMarkdown =
    pr.filesChanged.length > 0 && pr.filesChanged.every((f) => /\.(md|txt)$/i.test(f));
  const nonEmptyAdded = addedLines.map((l) => l.trim()).filter(Boolean);
  if (onlyDocsOrMarkdown && nonEmptyAdded.length <= 2 && addedText.length < 110) {
    const looksLikePadding =
      nonEmptyAdded.length === 0 ||
      (/^(improve|update|fix typo|add badge|welcome)/i.test(pr.title) &&
        pr.diffText.split(/\r?\n/).filter((l) => l.startsWith('-') && !l.startsWith('---')).length <= 1);
    if (looksLikePadding) {
      findings.push({
        ruleId: 'TRIVIAL_DOC_CHURN',
        severity: 'low',
        file: pr.filesChanged[0],
        snippet: nonEmptyAdded[0] ?? '(whitespace only)',
        explanation:
          'Single-line trivial markdown/whitespace edit characteristic of automated contribution-farming waves.',
      });
    }
  }

  // Positive code signals (evaluates real code helpfulness regardless of contributor tenure or tooling)
  const codeFilesChanged = pr.filesChanged.filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|zig|c|cpp|h|css|scss)$/i.test(f)
  );
  const removedCodeLines = pr.diffText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('*'));
  const nonCommentAddedCode = addedLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('*'));

  const touchesTests = pr.filesChanged.some(
    (f) => /(\.|_)(test|spec)\.(ts|tsx|js|py|rs|go|zig)$/i.test(f) || /\/tests?\//i.test(f)
  );
  if (touchesTests && findings.filter((f) => f.severity === 'high').length === 0) {
    positiveSignals.push({
      signalId: 'INCLUDES_UNIT_TESTS',
      description: 'Modifies or adds test coverage alongside implementation changes.',
    });
  }

  const hasLogicTokens = nonCommentAddedCode.some((l) =>
    /\b(if|else|return|throw|switch|for|while|const|let|function|export|interface|type|fn|def|pub|match)\b|(\?\?|\?\.|===|!==|=>)/.test(
      l
    )
  );

  if (
    codeFilesChanged.length > 0 &&
    removedCodeLines.length >= 1 &&
    nonCommentAddedCode.length >= 1 &&
    nonCommentAddedCode.length <= 20 &&
    hasLogicTokens &&
    findings.length === 0
  ) {
    positiveSignals.push({
      signalId: 'SURGICAL_CODE_FIX',
      description: `Targeted surgical edit (${nonCommentAddedCode.length} line(s) updated) modifying real program logic cleanly without introducing defects.`,
    });
  } else if (
    codeFilesChanged.length > 0 &&
    nonCommentAddedCode.length >= 1 &&
    nonCommentAddedCode.length <= 450 &&
    hasLogicTokens &&
    findings.length === 0
  ) {
    positiveSignals.push({
      signalId: 'FOCUSED_SOURCE_PATCH',
      description: 'Clean, structured source-code implementation with zero static safety or bad-code defects.',
    });
  }

  if (/(fixes|closes|resolves)\s+#\d+/i.test(pr.body)) {
    positiveSignals.push({
      signalId: 'REFERENCES_ISSUE',
      description: 'Explicitly links to an existing repository issue with reproduction context.',
    });
  }

  return { findings, positiveSignals };
}
