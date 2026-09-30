export type ActorRole = "ADMIN" | "ENGINEER" | "SYSTEM";

/** Who is performing an action. Passed to every service so it can authorize and audit. */
export interface Actor {
  id: string | null;
  name: string;
  role: ActorRole;
  email?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, name: "System", role: "SYSTEM" };

export function isAdmin(actor: Actor) {
  return actor.role === "ADMIN";
}
