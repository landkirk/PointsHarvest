import { getIsActivelyRunning } from '../util/state.js';

export class StoppedError extends Error {
  constructor() {
    super('Run stopped');
  }
}

export abstract class StoppableBase {
  /** Throws StoppedError if the run is no longer active. */
  protected checkStopped(): void {
    if (!getIsActivelyRunning()) throw new StoppedError();
  }
}
