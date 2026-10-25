/**
 * Contract between the puzzle host (shared sheet, hints, success layer) and one interactive puzzle
 * kind module (kinds/<kind>.ts). A kind only draws its own body and talks to the server through
 * ctx.submit / ctx.probe — it never sees the solution.
 */
export type PuzzleTone = 'info' | 'ok' | 'bad';

export interface PuzzleRunView {
  attempts: number;
  probesUsed: number;
  /** Hints already bought by the team, in order. */
  hints: string[];
  [key: string]: unknown;
}

export interface PuzzleSubmitResult {
  solved: boolean;
  /** Kind-specific feedback from the server, e.g. { firstWrong: 6 }. */
  feedback: any | null;
  message: string;
}

export interface PuzzleProbeResult {
  feedback: any | null;
  message: string;
}

export interface PuzzleContext {
  puzzleId: string;
  kind: string;
  /** Object name shown in the sheet header (e.g. "Hộp mê cung trên kệ"). */
  title: string;
  prompt: string;
  /** Public per-case parameters (never the solution). */
  params: any;
  run: PuzzleRunView;
  /** Content sent by the server once solved (null before). */
  reveal: any | null;
  solved: boolean;
  reducedMotion: boolean;
  /** Bilingual helper: tr('English', 'Tiếng Việt'). */
  tr: (en: string, vi: string) => string;
  /** Sends the final answer. Resolves with the verdict; rejects on network/server errors. */
  submit: (answer: Record<string, unknown>) => Promise<PuzzleSubmitResult>;
  /** Mid-puzzle server query (only kinds that need one, e.g. scale weighings). */
  probe: (payload: Record<string, unknown>) => Promise<PuzzleProbeResult>;
  /** Footer status line (role="status"). */
  setStatus: (text: string, tone?: PuzzleTone) => void;
}

export interface PuzzleKindHandle {
  /** Called when the shared run/solved/reveal changes (e.g. the partner bought a hint or solved it). */
  update?(ctx: PuzzleContext): void;
  unmount(): void;
}

export interface PuzzleKindModule {
  kind: string;
  label: { en: string; vi: string };
  mount(body: HTMLElement, ctx: PuzzleContext): PuzzleKindHandle;
}
