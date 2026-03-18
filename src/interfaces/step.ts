import { StoppableBase } from './stoppable.js';
import type { Context } from '../util/context.js';

export abstract class StepBase<TArgs extends unknown[] = [], TResult = void> extends StoppableBase {
  abstract readonly name: string;
  abstract run(ctx: Context, ...args: TArgs): Promise<TResult>;
}
