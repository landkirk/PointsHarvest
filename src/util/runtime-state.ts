import type { OrchestratorBase } from '../interfaces/orchestrator.js';

// ── In-memory runtime state (not persisted) ────────────────────────────────
// Resets on every service worker restart.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrchestrator = OrchestratorBase<any[]>;

let activeOrchestrator: AnyOrchestrator | null = null;

export function getActiveOrchestrator(): AnyOrchestrator | null {
  return activeOrchestrator;
}

export function setActiveOrchestrator(instance: AnyOrchestrator | null): void {
  activeOrchestrator = instance;
}
