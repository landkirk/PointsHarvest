export class StoppedError extends Error {
  constructor() {
    super('Run stopped');
  }
}
