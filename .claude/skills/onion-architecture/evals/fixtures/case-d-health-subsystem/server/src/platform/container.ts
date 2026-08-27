/**
 * Excerpt of `platform/container.ts` — only the parts this change adds.
 * The surrounding class, constructor and existing getters are unchanged.
 */

import { HealthRepository } from '../modules/health/repository.js';
import { HealthScorer } from '../modules/health/scorer.js';
import { HealthTrend } from '../modules/health/trend.js';
import { HealthPolicy } from '../modules/health/policy.js';

export interface ContainerOverrides {
  // …existing slots…
  healthRepo?: HealthRepository;
  healthScorer?: HealthScorer;
  healthTrend?: HealthTrend;
  healthPolicy?: HealthPolicy;
}

export class Container {
  // …existing fields and getters…

  private _healthRepo?: HealthRepository;
  private _healthScorer?: HealthScorer;
  private _healthTrend?: HealthTrend;
  private _healthPolicy?: HealthPolicy;

  get healthRepo(): HealthRepository {
    if (this.overrides.healthRepo) return this.overrides.healthRepo;
    return (this._healthRepo ??= new HealthRepository(this));
  }

  get healthScorer(): HealthScorer {
    if (this.overrides.healthScorer) return this.overrides.healthScorer;
    return (this._healthScorer ??= new HealthScorer());
  }

  get healthTrend(): HealthTrend {
    if (this.overrides.healthTrend) return this.overrides.healthTrend;
    return (this._healthTrend ??= new HealthTrend());
  }

  get healthPolicy(): HealthPolicy {
    if (this.overrides.healthPolicy) return this.overrides.healthPolicy;
    return (this._healthPolicy ??= new HealthPolicy());
  }
}
