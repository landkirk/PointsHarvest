import type { Context } from '../util/context.js';

export abstract class StepBase<TArgs extends unknown[] = [], TResult = void> {
  abstract readonly name: string;
  abstract run(ctx: Context, ...args: TArgs): Promise<TResult>;
}
