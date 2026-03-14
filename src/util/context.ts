import { session, setState } from './state.js';
import { dbg } from './debug.js';

export interface Context {
  session: typeof session;
  setState: typeof setState;
  dbg: typeof dbg;
}

export function createContext(): Context {
  return { session, setState, dbg };
}
