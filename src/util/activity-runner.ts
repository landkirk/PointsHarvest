import { lingerOnPage } from './timing.js';
import { DBG } from './debug.js';
import type { Context } from './context.js';
import type { FailureCategory } from './failures.js';
import type { ProgressPayload } from './messaging.js';

export class ActivityRunner {
  async executeActivityWithValidation(
    ctx: Context,
    activityFn: () => Promise<boolean | null>,
    retryFn: (() => Promise<boolean | null>) | null,
    opts: {
      retryLogMessage: string;
      lingerLabel: string;
      failCategory: FailureCategory;
      failMessage: string;
      noRetryFailMessage?: string;
      navFailMessage?: string;
      retryNavFailMessage?: string;
      retryHeaderPayload?: ProgressPayload;
    },
  ): Promise<boolean> {
    let result: boolean | null;
    try {
      result = await activityFn();
    } catch {
      if (opts.navFailMessage) await ctx.fail('navigation', opts.navFailMessage);
      return false;
    }

    if (result === true) return true;

    if (!retryFn) {
      await ctx.fail(opts.failCategory, opts.noRetryFailMessage ?? opts.failMessage);
      return false;
    }

    await ctx.dbg(DBG.WARN, opts.retryLogMessage);
    if (opts.retryHeaderPayload) await ctx.updateHeader(opts.retryHeaderPayload);

    try {
      await this.retryAfterLinger(
        ctx,
        opts.lingerLabel,
        retryFn,
        opts.failCategory,
        opts.failMessage,
      );
    } catch {
      if (opts.retryNavFailMessage) await ctx.fail('navigation', opts.retryNavFailMessage);
      return false;
    }

    return true;
  }

  private async retryAfterLinger(
    ctx: Context,
    lingerLabel: string,
    retry: () => Promise<boolean | null>,
    failCategory: FailureCategory,
    failMessage: string,
  ): Promise<void> {
    await lingerOnPage(lingerLabel, undefined, ctx.signal);
    ctx.signal.throwIfAborted();
    const result = await retry();
    if (result !== true) {
      await ctx.fail(failCategory, failMessage);
    }
  }
}
