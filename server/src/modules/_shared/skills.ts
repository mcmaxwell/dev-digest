import { wrapUntrusted } from '../../platform/prompt.js';

/**
 * Render one linked skill into a prompt block.
 *
 * Lives in `_shared/` rather than in `reviews/` because two modules now need
 * it: `reviews` (the studio review and the CLI diff review) and `eval` (a run
 * over a case set must assemble the SAME prompt the real agent would, or it is
 * measuring a different agent). `no-cross-module-imports` exempts only another
 * module's `service.ts`, `types.ts` or `constants.ts`, so a helper two modules
 * share belongs here by placement, not by exception.
 *
 * A body from any source but `manual` is someone else's instructions arriving
 * inside our prompt, so it is delimiter-wrapped and the INJECTION_GUARD then
 * treats it as data.
 */
export function skillToBlock(skill: { name: string; body: string; source: string }): string {
  const body =
    skill.source === 'manual' ? skill.body : wrapUntrusted(`skill:${skill.name}`, skill.body);
  return `### Skill: ${skill.name}\n${body}`;
}
