import { declaredEndpoints, loadDevvitConfig, type DevvitConfig } from './devvit-config';

/**
 * Endpoints the ScenarioRunner reached (non-404) in this test file. Vitest isolates
 * modules per file, so check coverage from the file that holds the scenarios.
 */
const hit = new Set<string>();

export function recordEndpointHit(path: string): void {
  hit.add(path);
}

export function endpointCoverage(config: DevvitConfig = loadDevvitConfig()) {
  const declared = declaredEndpoints(config);
  return {
    declared,
    hit: declared.filter((e) => hit.has(e)),
    missing: declared.filter((e) => !hit.has(e)),
  };
}

/** Throws listing every devvit.json endpoint no scenario in this file has exercised. */
export function expectAllEndpointsCovered(config?: DevvitConfig): void {
  const { missing } = endpointCoverage(config);
  if (missing.length) {
    throw new Error(
      `No scenario exercised these devvit.json endpoints:\n  ${missing.join('\n  ')}`
    );
  }
}
