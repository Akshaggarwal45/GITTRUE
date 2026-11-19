import type { VouchEntry } from './types.ts';

/**
 * Parses Ghostty-compatible VOUCHED.td format:
 *   github:mitchellh
 *   mitchellh
 *   github:rockorager # Core contributor
 *   -bad_actor Automated spam wave
 *   -github:bad_actor # Automated spam PR wave
 */
export function parseVouchedTd(
  rawText: string,
  projectId: string,
  defaultTimestamp: string
): { entries: VouchEntry[]; errors: string[] } {
  const lines = rawText.split(/\r?\n/);
  const entries: VouchEntry[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      return;
    }

    const hashIdx = trimmed.indexOf('#');
    const beforeHash = (hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed).trim();
    const hashComment = hashIdx >= 0 ? trimmed.slice(hashIdx + 1).trim() : '';

    // Per Ghostty VOUCHED.td spec: comment can follow after whitespace on the same line
    const firstSpaceIdx = beforeHash.search(/\s/);
    const tokenPart = (firstSpaceIdx >= 0 ? beforeHash.slice(0, firstSpaceIdx) : beforeHash).trim();
    const spaceComment = firstSpaceIdx >= 0 ? beforeHash.slice(firstSpaceIdx).trim() : '';
    const commentPart = [spaceComment, hashComment].filter(Boolean).join(' ').trim();

    let status: 'vouched' | 'denounced' = 'vouched';
    let identity = tokenPart;

    if (identity.startsWith('-')) {
      status = 'denounced';
      identity = identity.slice(1).trim();
    } else if (identity.startsWith('+')) {
      identity = identity.slice(1).trim();
    }

    const withPlatform = /^(github|gitlab|codeberg):([a-zA-Z0-9_.-]+)$/.exec(identity);
    const bareHandle = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(identity);

    let handle: string | null = null;
    if (withPlatform) {
      handle = withPlatform[2].toLowerCase();
    } else if (bareHandle && !identity.includes(':')) {
      handle = bareHandle[1].toLowerCase();
    }

    if (!handle) {
      errors.push(`Line ${idx + 1}: Unrecognized VOUCHED.td identity "${tokenPart}"`);
      return;
    }

    entries.push({
      id: `${projectId}-${status}-${handle}-${idx}`,
      projectId,
      contributorHandle: handle,
      status,
      reason: commentPart || (status === 'vouched' ? 'Vouched in VOUCHED.td' : 'Denounced in VOUCHED.td'),
      createdAt: defaultTimestamp,
    });
  });

  return { entries, errors };
}

export function serializeVouchedTd(entries: VouchEntry[], projectName: string): string {
  const header = [
    `# VOUCHED.td — ${projectName}`,
    `# Format: <platform>:<handle> (vouched) or -<platform>:<handle> # <reason> (denounced)`,
    '',
  ];

  const vouched = entries
    .filter((e) => e.status === 'vouched')
    .map((e) => `github:${e.contributorHandle}${e.reason ? ` # ${e.reason}` : ''}`);

  const denounced = entries
    .filter((e) => e.status === 'denounced')
    .map((e) => `-github:${e.contributorHandle}${e.reason ? ` # ${e.reason}` : ''}`);

  return [...header, ...vouched, '', ...denounced].join('\n');
}
