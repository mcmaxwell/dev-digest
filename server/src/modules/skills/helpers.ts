import { unzipSync } from 'fflate';
import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { SkillType as SkillTypeSchema } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { DERIVED_DESCRIPTION_MAX_CHARS, IMPORT_MAX_FILE_BYTES } from './constants.js';
import type { SkillRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the import
 * parser. The parser only ever READS markdown text out of an upload: archive
 * entries that are not markdown (scripts, binaries, anything executable) are
 * never opened — they are merely listed back as skipped, so the preview can
 * show the user what was ignored.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export interface ParsedSkillImport {
  name: string;
  description: string;
  type: SkillType | null;
  body: string;
  warnings: string[];
  skippedEntries: string[];
}

const MD_FILE = /\.(md|markdown)$/i;
const ZIP_FILE = /\.zip$/i;

/**
 * Parse an uploaded skill file (.md or .zip) into a preview. Throws
 * ValidationError on unsupported/empty uploads; never executes or evaluates
 * any content.
 */
export function parseSkillImport(filename: string, data: Uint8Array): ParsedSkillImport {
  if (ZIP_FILE.test(filename)) return parseZipImport(data);
  if (MD_FILE.test(filename)) {
    return { ...parseMarkdownCore(decodeUtf8(data), filename), skippedEntries: [] };
  }
  throw new ValidationError('Unsupported file type — upload a .md file or a .zip archive');
}

function parseZipImport(data: Uint8Array): ParsedSkillImport {
  // DECOMPRESS only markdown entries, and only within the upload byte budget —
  // without the filter, unzipSync eagerly inflates EVERY entry, so a
  // size-compliant zip bomb (deflate packs ~1000:1) could allocate gigabytes
  // for entries we would never read. Non-matching entries are merely listed.
  const allPaths: string[] = [];
  let budget = IMPORT_MAX_FILE_BYTES;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        if (!f.name.endsWith('/')) allPaths.push(f.name);
        if (!MD_FILE.test(f.name) || f.originalSize > budget) return false;
        budget -= f.originalSize;
        return true;
      },
    });
  } catch {
    throw new ValidationError('Could not read the archive — is it a valid .zip file?');
  }

  const paths = allPaths.filter(
    (p) => !p.startsWith('__MACOSX/') && !basename(p).startsWith('.'),
  );
  // Only decompressed (markdown, in-budget) entries are candidates; an
  // oversized markdown entry stays in `paths` and is reported as skipped.
  const mdPaths = Object.keys(entries).filter((p) => paths.includes(p));
  if (mdPaths.length === 0) {
    throw new ValidationError('No markdown file found in the archive (expected a SKILL.md)');
  }

  // Prefer SKILL.md; then the shallowest markdown file; ties break alphabetically.
  const chosen =
    mdPaths.find((p) => basename(p).toLowerCase() === 'skill.md') ??
    [...mdPaths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]!;

  const skipped = paths.filter((p) => p !== chosen);
  const warnings: string[] = [];
  if (mdPaths.length > 1) {
    warnings.push(`Archive contains ${mdPaths.length} markdown files — used "${chosen}".`);
  }
  if (skipped.length > 0) {
    warnings.push('Non-markdown archive entries are never read or executed.');
  }

  const core = parseMarkdownCore(decodeUtf8(entries[chosen]!), chosen);
  return { ...core, warnings: [...core.warnings, ...warnings], skippedEntries: skipped };
}

/**
 * Extract the skill core from markdown text: optional YAML-ish frontmatter
 * (`name` / `description` / `type` as flat `key: value` lines — no YAML
 * evaluation), else name from the first `# heading` / the filename, and
 * description from the first paragraph line.
 */
function parseMarkdownCore(
  text: string,
  filename: string,
): Omit<ParsedSkillImport, 'skippedEntries'> {
  const warnings: string[] = [];
  const fm = extractFrontmatter(text);
  const body = fm.body.trim();
  if (body.length === 0) throw new ValidationError('The markdown file has no content');

  let type: SkillType | null = null;
  if (fm.fields.type !== undefined) {
    const parsed = SkillTypeSchema.safeParse(fm.fields.type);
    if (parsed.success) type = parsed.data;
    else warnings.push(`Unknown skill type "${fm.fields.type}" in frontmatter — pick one manually.`);
  }

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = fm.fields.name?.trim() || heading || basename(filename).replace(MD_FILE, '');
  const description =
    fm.fields.description?.trim() || firstParagraphLine(body) || '';

  return { name, description, type, body, warnings };
}

function extractFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) fields[kv[1]!.toLowerCase()] = kv[2]!.replace(/^["']|["']$/g, '');
  }
  return { fields, body: text.slice(m[0].length) };
}

/** First non-empty, non-heading line — the derived one-line description. */
function firstParagraphLine(body: string): string | undefined {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return line?.slice(0, DERIVED_DESCRIPTION_MAX_CHARS);
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function depth(path: string): number {
  return path.split('/').length;
}
