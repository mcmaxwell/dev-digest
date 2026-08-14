import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { countTokens, TOKEN_BUDGET } from '../scripts/token-budget.js';
import { connect, type Harness } from './helpers/client.js';
import { fakeApi } from './helpers/fake-api.js';

/**
 * The structural gate.
 *
 * Everything asserted here is a convention that would otherwise survive only as
 * a paragraph in AGENTS.md: flat schemas, described parameters, capped
 * descriptions, one paid tool, one output schema, a hard token budget. The
 * point is that the NEXT lesson, adding a sixth tool, cannot quietly break any
 * of them.
 *
 * The expected texts below are an INDEPENDENT transcription of section 2.0 of
 * the L04 plan - deliberately not imported from `src/`, or the test would only
 * prove the code equals itself. Changing a description means changing it here
 * too, which is exactly the friction the wording deserves: every one of these
 * strings is loaded into the system prompt of every session of every user.
 */

const PLAN_TOOL_DESCRIPTIONS: Record<string, string> = {
  list_agents:
    'List the reviewer agents configured in this DevDigest workspace. Call this before run_agent_on_pr: it returns the agent slug and id that tool needs, and agent ids are UUIDs that cannot be guessed from a name.',
  run_agent_on_pr:
    'Run one DevDigest reviewer agent on an already-imported pull request, wait for it to finish, and return the verdict and findings. This spends real LLM tokens and usually takes 30 to 180 seconds. If the wait limit is reached the tool returns status running plus a run_id instead of an error; call get_findings with that run_id a minute later.',
  get_findings:
    'Return the verdict and findings of a DevDigest review that has already run. Pass run_id for one specific run, or repo plus pr_number for the latest review from every agent on that PR. This does not start a review and costs nothing.',
  get_conventions:
    'Return the coding conventions DevDigest extracted from a repository: house rules a human has accepted, each with a measured adherence rate. Read these before writing or reviewing code in that repo so the change matches the existing style.',
  get_blast_radius:
    'Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints and cron jobs sit behind those callers. Reads a prebuilt index, costs nothing, and reports when that index is partial so missing callers are never mistaken for none.',
};

const PLAN_PARAM_DESCRIPTIONS: Record<string, string> = {
  repo: 'Repository as "owner/name", exactly as listed in DevDigest.',
  pr_number: 'Pull request number.',
  agent: 'Agent slug or id from list_agents.',
  severity_min: 'Drop findings below this severity.',
  limit: 'Maximum findings returned; the response says how many were withheld.',
  wait_seconds: 'How long to wait before returning status running instead of results.',
  run_id: 'Run id from run_agent_on_pr. Takes precedence over repo and pr_number.',
  detail: 'concise lists severity, location and title; full adds rationale and suggested fix.',
  enabled_only: 'Only agents that can run. Set false to also see disabled ones.',
  category: 'Only rules in this category.',
  status: 'accepted means a human confirmed the rule; all adds unreviewed candidates.',
  evidence: 'Include one file:line pointer proving each rule.',
  max_callers: 'Maximum callers listed per changed symbol, highest-ranked first.',
  min_rank: 'Drop callers whose file rank is below this. Ignored on an unranked index.',
  include_endpoints: 'Include the endpoints and scheduled jobs the callers sit behind.',
};

/** Two parameters carry tool-specific wording. `repo` is optional in
 *  `get_findings` alone, so there it has to explain how it relates to `run_id`.
 *  `limit` in `get_conventions` counts rules, not findings. Every other
 *  occurrence uses the shared text. */
const PLAN_PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  get_findings: {
    repo: 'Repository as "owner/name". Use with pr_number when you have no run_id.',
  },
  get_conventions: {
    limit: 'Maximum rules returned; the response says how many were withheld.',
  },
};

const MAX_TOOL_DESCRIPTION = 350;
const MAX_PROPERTY_DESCRIPTION = 160;
const MAX_PROPERTIES_PER_TOOL = 8;

type Json = Record<string, unknown>;

/** Every nested object in a JSON Schema, so the checks cannot be dodged by
 *  hiding a construct one level down. */
function everyNode(node: unknown, path = '$'): { path: string; node: Json }[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => everyNode(v, `${path}[${i}]`));
  if (node === null || typeof node !== 'object') return [];
  const self = { path, node: node as Json };
  return [
    self,
    ...Object.entries(node as Json).flatMap(([k, v]) => everyNode(v, `${path}.${k}`)),
  ];
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Json;
  outputSchema?: Json;
  annotations?: Record<string, unknown>;
}

let harness: Harness;
let tools: ListedTool[];
let payload: string;

beforeAll(async () => {
  harness = await connect({ api: fakeApi() });
  const listed = await harness.client.listTools();
  tools = listed.tools as unknown as ListedTool[];
  payload = JSON.stringify(listed.tools);
});

afterAll(async () => {
  await harness.close();
});

describe('tools/list', () => {
  it('advertises exactly the five L04 tools', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'list_agents',
      'run_agent_on_pr',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);
  });

  it('costs less than the token budget', () => {
    const total = countTokens(payload);
    expect(total).toBeLessThan(TOKEN_BUDGET);
  });

  it('has no anyOf, oneOf, allOf or $ref anywhere', () => {
    // A model reads a flat object far more reliably than a union, and every
    // one of these constructs is a way for a union to sneak back in. The
    // `run_id` XOR `repo`+`pr_number` rule is prose in get_findings for exactly
    // this reason.
    const banned = ['anyOf', 'oneOf', 'allOf', '$ref'];
    const hits: string[] = [];
    for (const tool of tools) {
      for (const { path, node } of everyNode({ i: tool.inputSchema, o: tool.outputSchema })) {
        for (const key of banned) {
          if (key in node) hits.push(`${tool.name} ${path}.${key}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps every tool at 8 parameters or fewer', () => {
    for (const tool of tools) {
      const props = (tool.inputSchema?.properties ?? {}) as Json;
      expect(
        Object.keys(props).length,
        `${tool.name} has ${Object.keys(props).length} parameters`,
      ).toBeLessThanOrEqual(MAX_PROPERTIES_PER_TOOL);
    }
  });

  it('describes every property, in input and output schemas alike', () => {
    const missing: string[] = [];
    for (const tool of tools) {
      for (const { node } of everyNode({ i: tool.inputSchema, o: tool.outputSchema })) {
        const props = node.properties;
        if (!props || typeof props !== 'object') continue;
        for (const [name, value] of Object.entries(props as Json)) {
          const description = (value as Json | null)?.description;
          if (typeof description !== 'string' || description.length === 0) {
            missing.push(`${tool.name}.${name}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('caps tool descriptions at 350 characters and property descriptions at 160', () => {
    for (const tool of tools) {
      expect(tool.description ?? '', `${tool.name} description`).not.toBe('');
      expect(
        (tool.description ?? '').length,
        `${tool.name} description is ${(tool.description ?? '').length} chars`,
      ).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION);

      for (const { node } of everyNode({ i: tool.inputSchema, o: tool.outputSchema })) {
        const props = node.properties;
        if (!props || typeof props !== 'object') continue;
        for (const [name, value] of Object.entries(props as Json)) {
          const description = String((value as Json).description ?? '');
          expect(
            description.length,
            `${tool.name}.${name} description is ${description.length} chars`,
          ).toBeLessThanOrEqual(MAX_PROPERTY_DESCRIPTION);
        }
      }
    }
  });

  it('matches the approved tool descriptions character for character', () => {
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(PLAN_TOOL_DESCRIPTIONS[tool.name]);
    }
  });

  it('matches the approved parameter descriptions character for character', () => {
    for (const tool of tools) {
      const props = (tool.inputSchema?.properties ?? {}) as Json;
      for (const [name, value] of Object.entries(props)) {
        const expected = PLAN_PARAM_OVERRIDES[tool.name]?.[name] ?? PLAN_PARAM_DESCRIPTIONS[name];
        expect(expected, `${tool.name}.${name} is not in the approved list`).toBeDefined();
        expect((value as Json).description, `${tool.name}.${name}`).toBe(expected);
      }
    }
  });

  it('declares readOnlyHint on every tool', () => {
    for (const tool of tools) {
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean');
    }
  });

  it('has exactly one tool that is not read-only, and it opens the world', () => {
    // One tool spends money. If a second one ever does, that is a decision, not
    // an accident, and it fails here first.
    const writers = tools.filter((t) => t.annotations?.readOnlyHint === false);
    expect(writers.map((t) => t.name)).toEqual(['run_agent_on_pr']);
    expect(writers[0]?.annotations?.openWorldHint).toBe(true);
    // MCP defaults destructiveHint to true once readOnlyHint is false, and a
    // review only appends rows.
    expect(writers[0]?.annotations?.destructiveHint).toBe(false);
  });

  it('has at most one outputSchema', () => {
    const withOutput = tools.filter((t) => t.outputSchema !== undefined);
    expect(withOutput.map((t) => t.name)).toEqual(['get_blast_radius']);
  });

  // The payload verbatim: any schema change shows up as a readable diff in code
  // review, which is what actually stops budget creep.
  it('matches the recorded tools/list payload', () => {
    expect(JSON.parse(payload)).toMatchInlineSnapshot(`
      [
        {
          "annotations": {
            "idempotentHint": true,
            "openWorldHint": false,
            "readOnlyHint": true,
          },
          "description": "List the reviewer agents configured in this DevDigest workspace. Call this before run_agent_on_pr: it returns the agent slug and id that tool needs, and agent ids are UUIDs that cannot be guessed from a name.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "properties": {
              "detail": {
                "default": "concise",
                "description": "concise lists severity, location and title; full adds rationale and suggested fix.",
                "enum": [
                  "concise",
                  "full",
                ],
                "type": "string",
              },
              "enabled_only": {
                "default": true,
                "description": "Only agents that can run. Set false to also see disabled ones.",
                "type": "boolean",
              },
            },
            "type": "object",
          },
          "name": "list_agents",
        },
        {
          "annotations": {
            "destructiveHint": false,
            "idempotentHint": false,
            "openWorldHint": true,
            "readOnlyHint": false,
          },
          "description": "Run one DevDigest reviewer agent on an already-imported pull request, wait for it to finish, and return the verdict and findings. This spends real LLM tokens and usually takes 30 to 180 seconds. If the wait limit is reached the tool returns status running plus a run_id instead of an error; call get_findings with that run_id a minute later.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "properties": {
              "agent": {
                "description": "Agent slug or id from list_agents.",
                "minLength": 1,
                "type": "string",
              },
              "limit": {
                "default": 20,
                "description": "Maximum findings returned; the response says how many were withheld.",
                "maximum": 50,
                "minimum": 1,
                "type": "integer",
              },
              "pr_number": {
                "description": "Pull request number.",
                "maximum": 9007199254740991,
                "minimum": 1,
                "type": "integer",
              },
              "repo": {
                "description": "Repository as "owner/name", exactly as listed in DevDigest.",
                "minLength": 1,
                "type": "string",
              },
              "severity_min": {
                "default": "SUGGESTION",
                "description": "Drop findings below this severity.",
                "enum": [
                  "SUGGESTION",
                  "WARNING",
                  "CRITICAL",
                ],
                "type": "string",
              },
              "wait_seconds": {
                "default": 180,
                "description": "How long to wait before returning status running instead of results.",
                "maximum": 300,
                "minimum": 10,
                "type": "integer",
              },
            },
            "required": [
              "repo",
              "pr_number",
              "agent",
            ],
            "type": "object",
          },
          "name": "run_agent_on_pr",
        },
        {
          "annotations": {
            "idempotentHint": true,
            "openWorldHint": false,
            "readOnlyHint": true,
          },
          "description": "Return the verdict and findings of a DevDigest review that has already run. Pass run_id for one specific run, or repo plus pr_number for the latest review from every agent on that PR. This does not start a review and costs nothing.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "properties": {
              "detail": {
                "default": "concise",
                "description": "concise lists severity, location and title; full adds rationale and suggested fix.",
                "enum": [
                  "concise",
                  "full",
                ],
                "type": "string",
              },
              "limit": {
                "default": 20,
                "description": "Maximum findings returned; the response says how many were withheld.",
                "maximum": 50,
                "minimum": 1,
                "type": "integer",
              },
              "pr_number": {
                "description": "Pull request number.",
                "maximum": 9007199254740991,
                "minimum": 1,
                "type": "integer",
              },
              "repo": {
                "description": "Repository as "owner/name". Use with pr_number when you have no run_id.",
                "minLength": 1,
                "type": "string",
              },
              "run_id": {
                "description": "Run id from run_agent_on_pr. Takes precedence over repo and pr_number.",
                "minLength": 1,
                "type": "string",
              },
              "severity_min": {
                "default": "SUGGESTION",
                "description": "Drop findings below this severity.",
                "enum": [
                  "SUGGESTION",
                  "WARNING",
                  "CRITICAL",
                ],
                "type": "string",
              },
            },
            "type": "object",
          },
          "name": "get_findings",
        },
        {
          "annotations": {
            "idempotentHint": true,
            "openWorldHint": false,
            "readOnlyHint": true,
          },
          "description": "Return the coding conventions DevDigest extracted from a repository: house rules a human has accepted, each with a measured adherence rate. Read these before writing or reviewing code in that repo so the change matches the existing style.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "properties": {
              "category": {
                "description": "Only rules in this category.",
                "enum": [
                  "naming",
                  "structure",
                  "error-handling",
                  "async",
                  "imports",
                  "types",
                  "testing",
                  "api-contract",
                  "logging",
                  "config",
                ],
                "type": "string",
              },
              "evidence": {
                "default": false,
                "description": "Include one file:line pointer proving each rule.",
                "type": "boolean",
              },
              "limit": {
                "default": 40,
                "description": "Maximum rules returned; the response says how many were withheld.",
                "maximum": 100,
                "minimum": 1,
                "type": "integer",
              },
              "repo": {
                "description": "Repository as "owner/name", exactly as listed in DevDigest.",
                "minLength": 1,
                "type": "string",
              },
              "status": {
                "default": "accepted",
                "description": "accepted means a human confirmed the rule; all adds unreviewed candidates.",
                "enum": [
                  "accepted",
                  "pending",
                  "all",
                ],
                "type": "string",
              },
            },
            "required": [
              "repo",
            ],
            "type": "object",
          },
          "name": "get_conventions",
        },
        {
          "annotations": {
            "idempotentHint": true,
            "openWorldHint": false,
            "readOnlyHint": true,
          },
          "description": "Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints and cron jobs sit behind those callers. Reads a prebuilt index, costs nothing, and reports when that index is partial so missing callers are never mistaken for none.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "properties": {
              "include_endpoints": {
                "default": true,
                "description": "Include the endpoints and scheduled jobs the callers sit behind.",
                "type": "boolean",
              },
              "max_callers": {
                "default": 25,
                "description": "Maximum callers listed per changed symbol, highest-ranked first.",
                "maximum": 100,
                "minimum": 1,
                "type": "integer",
              },
              "min_rank": {
                "default": 0,
                "description": "Drop callers whose file rank is below this. Ignored on an unranked index.",
                "maximum": 1,
                "minimum": 0,
                "type": "number",
              },
              "pr_number": {
                "description": "Pull request number.",
                "maximum": 9007199254740991,
                "minimum": 1,
                "type": "integer",
              },
              "repo": {
                "description": "Repository as "owner/name", exactly as listed in DevDigest.",
                "minLength": 1,
                "type": "string",
              },
            },
            "required": [
              "repo",
              "pr_number",
            ],
            "type": "object",
          },
          "name": "get_blast_radius",
          "outputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "changed_symbols": {
                "description": "Symbols this PR changes, most-called first.",
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "file": {
                      "description": "File that declares it.",
                      "type": "string",
                    },
                    "kind": {
                      "description": "function, class, method, …",
                      "type": "string",
                    },
                    "name": {
                      "description": "Symbol declared in a changed file.",
                      "type": "string",
                    },
                  },
                  "required": [
                    "name",
                    "file",
                    "kind",
                  ],
                  "type": "object",
                },
                "type": "array",
              },
              "downstream": {
                "description": "One entry per changed symbol. An empty callers list is a real answer.",
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "callers": {
                      "description": "Files that call it, highest-ranked first.",
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "file": {
                            "description": "File containing the caller.",
                            "type": "string",
                          },
                          "line": {
                            "description": "1-based line of the call.",
                            "maximum": 1000000,
                            "minimum": 0,
                            "type": "integer",
                          },
                          "name": {
                            "description": "The calling symbol.",
                            "type": "string",
                          },
                          "rank": {
                            "description": "Importance of the caller file.",
                            "maximum": 1,
                            "minimum": 0,
                            "type": "number",
                          },
                        },
                        "required": [
                          "name",
                          "file",
                          "line",
                          "rank",
                        ],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "crons_affected": {
                      "description": "Scheduled jobs reachable from them.",
                      "items": {
                        "type": "string",
                      },
                      "type": "array",
                    },
                    "endpoints_affected": {
                      "description": "HTTP endpoints as "METHOD /path" reachable from those callers.",
                      "items": {
                        "type": "string",
                      },
                      "type": "array",
                    },
                    "symbol": {
                      "description": "Which changed symbol this row is about.",
                      "type": "string",
                    },
                  },
                  "required": [
                    "symbol",
                    "callers",
                    "endpoints_affected",
                    "crons_affected",
                  ],
                  "type": "object",
                },
                "type": "array",
              },
              "index_status": {
                "description": "partial means callers or endpoints may be missing; degraded means no index.",
                "enum": [
                  "ok",
                  "partial",
                  "degraded",
                ],
                "type": "string",
              },
              "summary": {
                "description": "One-paragraph impact summary, or empty if none was generated.",
                "type": "string",
              },
            },
            "required": [
              "changed_symbols",
              "downstream",
              "summary",
              "index_status",
            ],
            "type": "object",
          },
        },
      ]
    `);
  });
});
