export interface ActionState {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Arbitrary payload, e.g. duplicate candidates. */
  data?: unknown;
  /** Incremented per submission so client effects can react to repeat results. */
  ts?: number;
}

export const initialActionState: ActionState = { ok: false };
