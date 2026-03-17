import { setState, getActiveOrchestrator, setIsActivelyRunning } from '../util/state.js';
import { dbg } from '../util/debug.js';
import { createContext } from '../util/context.js';


class StopRun {
  async run(): Promise<void> {
    setIsActivelyRunning(false);
    await setState({ isRunning: false, status: 'Stopped' });
    await dbg('warn', 'Run stopped by user');
    await getActiveOrchestrator()?.stop(createContext());
  }
}

export { StopRun };
