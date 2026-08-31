import type { CiBundle, CiBundleInput } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildBundle, type BundleAgent } from './bundle.js';

/**
 * L06 Export to CI - the I/O half.
 *
 * Loads the agent and its linked skills, hands them to the pure `buildBundle`,
 * and returns the files. There is no repository here and no `ci` table is
 * touched: a bundle is a derivation of the agent, not a record of anything, so
 * exporting twice is indistinguishable from exporting once. The iteration that
 * records a `ci_installations` row and opens a pull request is a separate
 * endpoint (`POST /agents/:id/export-ci`), still unimplemented.
 *
 * Skills are read through `container.agentsRepo` - the documented cross-module
 * seam - rather than by importing the agents module's repository.
 */
export class CiService {
  constructor(private container: Container) {}

  async bundle(workspaceId: string, agentId: string, input: CiBundleInput): Promise<CiBundle> {
    const row = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!row) throw new NotFoundError('Agent not found');

    const linked = await this.container.agentsRepo.linkedSkills(agentId);

    const agent: BundleAgent = {
      name: row.name,
      provider: row.provider,
      model: row.model,
      system_prompt: row.systemPrompt,
      strategy: row.strategy,
      ci_fail_on: row.ciFailOn,
    };

    // Bodies go into the bundle VERBATIM. `_shared/skills.ts` wraps a non-manual
    // body in untrusted-content fencing before it reaches a model prompt; a
    // Markdown file on disk has no prompt to be injected into, and fencing it
    // would corrupt the file the user is about to commit.
    const skills = linked.map((l) => ({
      name: l.skill.name,
      body: l.skill.body,
      enabled: l.skill.enabled,
    }));

    return { files: buildBundle(agent, skills, input) };
  }
}
