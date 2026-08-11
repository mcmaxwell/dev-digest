import * as z from 'zod';

/**
 * The one fetch wrapper. Everything that can go wrong with an HTTP call is
 * turned into one of the four error classes below, so a tool handler has a
 * closed set of cases to render (see src/format/errors.ts).
 *
 * Nothing here ever logs a response BODY: GET /agents carries `system_prompt`
 * and GET /repos carries `clone_path`. One line per call, to stderr only -
 * stdout is the JSON-RPC channel and a stray write there breaks `initialize`.
 */

/** The API answered, with a non-2xx status. */
export class ApiError extends Error {
  readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Nothing is listening on the configured port. */
export class ApiUnreachableError extends Error {
  readonly name = 'ApiUnreachableError';
  constructor(readonly baseUrl: string) {
    super(
      `Cannot reach the DevDigest API at ${baseUrl}. ` +
        `Start the stack with ./scripts/dev.sh from the repo root, then retry.`,
    );
  }
}

/**
 * Something IS listening but did not answer in time. Deliberately distinct from
 * unreachable: "still booting / still cloning" and "not running" need different
 * actions from the caller.
 */
export class ApiTimeoutError extends Error {
  readonly name = 'ApiTimeoutError';
  constructor(
    readonly baseUrl: string,
    readonly timeoutMs: number,
    readonly path: string,
  ) {
    super(
      `The DevDigest API at ${baseUrl} did not answer ${path} within ${timeoutMs}ms. ` +
        `It is probably still starting up, cloning, or indexing - wait a few seconds and retry.`,
    );
  }
}

/** The API answered 2xx with a body this package cannot read. */
export class ApiShapeError extends Error {
  readonly name = 'ApiShapeError';
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`Unexpected response shape from ${path}: ${detail}`);
  }
}

const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  /**
   * Prefix for the one stderr line per call. Two binaries share this client and
   * a user reading `devdigest: ...` should not be told a different program name
   * than the one they typed.
   */
  label?: string;
}

/** `AbortSignal.timeout` rejects with a DOMException named TimeoutError; an
 *  explicit abort surfaces as AbortError. Both mean "we gave up waiting". */
function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const parsed = ApiErrorBody.safeParse(body);
  if (parsed.success) {
    return new ApiError(
      res.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.details,
    );
  }
  return new ApiError(res.status, `http_${res.status}`, `${res.statusText || 'Request failed'} (${path})`);
}

export async function request<T>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  opts: RequestOptions,
): Promise<T> {
  const method = opts.method ?? 'GET';
  const label = opts.label ?? 'devdigest-mcp';
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      ...(opts.body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }
        : {}),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    console.error(`${label}: ${method} ${path} failed after ${Date.now() - started}ms`);
    if (isTimeout(err)) throw new ApiTimeoutError(baseUrl, opts.timeoutMs, path);
    throw new ApiUnreachableError(baseUrl);
  }
  console.error(`${label}: ${method} ${path} -> ${res.status} in ${Date.now() - started}ms`);
  if (!res.ok) throw await toApiError(res, path);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiShapeError(path, 'the body was not JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'unknown field';
    throw new ApiShapeError(path, where);
  }
  return parsed.data;
}
