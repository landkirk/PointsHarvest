import {
  setState,
  setHeaderState,
  getActiveOrchestrator,
  setIsActivelyRunning,
} from '../util/state.js';
import { dbg, DBG } from '../util/debug.js';
import { createContext } from '../util/context.js';

class StopRun {
  async run(): Promise<void> {
    setIsActivelyRunning(false);
    await setState({ isRunning: false });
    await setHeaderState({ headerMessage: 'Stopped', activePhase: null });
    await dbg(DBG.WARN, 'Run stopped by user');
    await getActiveOrchestrator()?.stop(createContext());
  }
}

export { StopRun };
