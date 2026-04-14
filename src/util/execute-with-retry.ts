import { lingerOnPage } from './timing.js';
import { DBG } from './debug.js';
import type { Context } from './context.js';
import type { FailureCategory } from './failures.js';
import type { ProgressPayload } from './messaging.js';

export interface RetryPolicy {
  maxAttempts: number;
  lingerLabel: string;
  retryLogMessage?: string;
  retryHeaderPayload?: ProgressPayload;
}

export interface FailureRecord {
  category: FailureCategory;
  message: string;
}

export async function executeWithRetry(
  ctx: Context,
  fn: (attempt: number) => Promise<boolean>,
  policy: RetryPolicy,
  onFailure: FailureRecord,
): Promise<boolean> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    let succeeded: boolean;
    try {
      succeeded = await fn(attempt);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      succeeded = false;
    }

    if (succeeded) return true;

    if (attempt < policy.maxAttempts) {
      if (policy.retryLogMessage) await ctx.dbg(DBG.WARN, policy.retryLogMessage);
      if (policy.retryHeaderPayload) await ctx.updateHeader(policy.retryHeaderPayload);
      await lingerOnPage(policy.lingerLabel, undefined, ctx.signal);
      ctx.signal.throwIfAborted();
    }
  }

  await ctx.fail(onFailure.category, onFailure.message);
  return false;
}
