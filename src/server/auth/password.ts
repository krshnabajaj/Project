import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password is too long")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// Used to keep login timing constant for unknown emails.
export const DUMMY_HASH = "$2b$12$Lyu289zGbH5xCeL.D4hbJ.LvNKDfqn25UREgNw/Ss11lUQW5Nnr9K";
