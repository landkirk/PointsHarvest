import { session, setState } from './state.js';
import { dbg } from './debug.js';
import type { Session, AppState } from './state.js';
import type { DebugType } from './debug.js';

export interface Context {
  session: Session;
  setState: (updates: Partial<AppState>) => Promise<void>;
  dbg: (type: DebugType, message: string) => Promise<void>;
}

export function createContext(): Context {
  return { session, setState, dbg };
}
