import { session, setState } from './state.js';
import { dbg } from './debug.js';

export function createContext() {
  return { session, setState, dbg };
}
