import type { Context } from '../util/context.js';

export interface OrchestratorBase<TArgs extends unknown[] = []> {
  run(ctx: Context, ...args: TArgs): Promise<void>;
}
