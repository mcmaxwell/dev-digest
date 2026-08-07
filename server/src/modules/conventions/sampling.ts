import {
  MAX_CHARS_PER_FILE,
  MAX_LINES_PER_FILE,
  MAX_TOTAL_SAMPLE_CHARS,
} from './constants.js';
import type { SampleFile, SampleKind } from './types.js';

/**
 * PURE sample assembly. No DB, no fs, no model — the caller supplies raw file
 * contents and this decides what the extraction passes actually see.
 *
 * The shape of the sample is the single biggest lever on how many conventions a
 * scan finds. Sampling purely by rank returns N files from whichever layer ranks
 * highest, so every rule ends up describing that one layer; the strata (source
 * spread across directories, tests, configs, docs) is what makes naming, testing
 * and structure rules reachable in the same scan.
 */

/** Slice a file to the per-file ceiling, keeping whole lines. */
export function truncateFile(content: string): {
  content: string;
  totalLines: number;
  truncated: boolean;
} {
  const lines = content.split('\n');
  const totalLines = lines.length;
  let kept = lines.slice(0, MAX_LINES_PER_FILE);
  let truncated = kept.length < totalLines;

  let text = kept.join('\n');
  if (text.length > MAX_CHARS_PER_FILE) {
    // Re-cut by lines so we never hand the model a half-token tail.
    let acc = 0;
    const under: string[] = [];
    for (const line of kept) {
      if (acc + line.length + 1 > MAX_CHARS_PER_FILE) break;
      acc += line.length + 1;
      under.push(line);
    }
    kept = under;
    text = kept.join('\n');
    truncated = true;
  }
  return { content: text, totalLines, truncated };
}

/**
 * Render a slice with 1-based line numbers: `  42 | const x = 1`.
 *
 * This is why evidence line numbers are trustworthy — the model copies a number
 * it can see instead of estimating one, so verification lands `exact` and the
 * "cite file:line" contract holds without a second grounding call.
 */
export function numberLines(content: string, startLine = 1): string {
  return content
    .split('\n')
    .map((line, i) => `${String(startLine + i).padStart(5, ' ')} | ${line}`)
    .join('\n');
}

/** Build one sample entry from raw file content. */
export function toSampleFile(path: string, kind: SampleKind, raw: string): SampleFile {
  const { content, totalLines, truncated } = truncateFile(raw);
  return { path, kind, content, numbered: numberLines(content), totalLines, truncated };
}

/**
 * Enforce the total budget across strata, keeping the mix intact.
 *
 * Round-robins by stratum instead of truncating the tail, so a repo with huge
 * source files cannot starve the tests/docs strata — losing a whole stratum
 * silently removes a whole class of conventions from the results.
 */
export function fitBudget(
  files: SampleFile[],
  maxChars = MAX_TOTAL_SAMPLE_CHARS,
): SampleFile[] {
  const byKind = new Map<SampleKind, SampleFile[]>();
  for (const f of files) {
    const arr = byKind.get(f.kind);
    if (arr) arr.push(f);
    else byKind.set(f.kind, [f]);
  }

  const out: SampleFile[] = [];
  let used = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const arr of byKind.values()) {
      const next = arr.shift();
      if (!next) continue;
      progressed = true;
      const cost = next.numbered.length;
      if (used + cost > maxChars) continue;
      used += cost;
      out.push(next);
    }
  }
  // Preserve the caller's ordering (config → doc → source → test reads better
  // in a prompt than the round-robin interleave the budget pass produces).
  const order = new Map(files.map((f, i) => [f.path, i]));
  return out.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
}

/** Render the sample set into the block the extraction prompt embeds. */
export function renderSamples(files: SampleFile[]): string {
  return files
    .map((f) => {
      const head = `### ${f.path} (${f.kind}${
        f.truncated ? `, first ${f.content.split('\n').length} of ${f.totalLines} lines` : ''
      })`;
      return `${head}\n\`\`\`\n${f.numbered}\n\`\`\``;
    })
    .join('\n\n');
}
