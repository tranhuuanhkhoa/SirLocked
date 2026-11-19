/** Public types of the automatic playtest (tool `playtest` of sirlocked-studio). */

export type Json = Record<string, any>;

export interface PlaytestOptions {
  /** Absolute path of the repository root (holds src/BE and src/FE). */
  repoRoot: string;
  /** The full V3 case JSON, solution included (finalLogic, puzzle solutions). */
  caseJson: Json;
  /** Absolute folder for screenshots and report.json. Created when missing. */
  outDir: string;
  /** Loopback API, e.g. http://127.0.0.1:5231. Defaults to PLAYTEST_API_URL or the stack's own port. */
  apiUrl?: string;
  /** Loopback frontend (Vite), e.g. http://127.0.0.1:5232. Defaults to PLAYTEST_WEB_URL or the stack's own port. */
  webUrl?: string;
  /** When the API does not answer /health, build and start a local stack (default true). */
  startStack?: boolean;
  /** Play a case that already exists on the stack instead of importing it again (default true). */
  reuseExistingCase?: boolean;
  /** Keep a stack this run started alive after the run (default false: stopped at the end). */
  keepStack?: boolean;
  /** Open both players in Chromium and capture each scene (default true). */
  screenshots?: boolean;
  /** Headless Chromium (default true). */
  headless?: boolean;
  /** Whole run limit in ms (default 20 minutes). */
  timeoutMs?: number;
  /** Ports for a stack started by this run (env PLAYTEST_API_PORT / PLAYTEST_WEB_PORT / PLAYTEST_MONGO_PORT). */
  apiPort?: number;
  webPort?: number;
  mongoPort?: number;
  /** Admin of an external local stack (env PLAYTEST_ADMIN_EMAIL / PLAYTEST_ADMIN_PASSWORD). */
  adminEmail?: string;
  adminPassword?: string;
  log?: (line: string) => void;
}

export interface PlaytestStep {
  action: string;
  actor: 'INVESTIGATOR' | 'INTERROGATOR' | 'ADMIN' | 'SYSTEM';
  target: string;
  ok: boolean;
  error?: string;
  sceneId?: string;
}

export interface PlaytestScreenshot {
  sceneId: string;
  role: 'INVESTIGATOR' | 'INTERROGATOR';
  file: string;
}

export interface AudioChecks {
  scenesWithoutMusic: string[];
  outdoorScenesWithoutWeather: string[];
  indoorScenesWithWeather: string[];
  notes: string[];
}

export interface EstimateBreakdown {
  formula: string;
  counts: Record<string, number>;
  seconds: Record<string, number>;
  totalSeconds: number;
}

export interface PlaytestReport {
  ok: boolean;
  caseId: string;
  roomId: string;
  accusationSuccess: boolean;
  scenesVisited: string[];
  screenshots: PlaytestScreenshot[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** API calls made by the game pages themselves that the server refused ("[inv] 409 POST /api/..."). */
  pageApiErrors: string[];
  steps: PlaytestStep[];
  stuck?: { sceneId: string; missing: string[] };
  estimatedMinutes: number;
  estimateBreakdown: EstimateBreakdown;
  durationMs: number;
  audioChecks: AudioChecks;
  /** Non-fatal observations (UI did not follow a move in time, skipped mechanics, stack used). */
  notes: string[];
  /** Set when the run itself failed before or outside play (import refused, stack did not start). */
  error?: string;
}
