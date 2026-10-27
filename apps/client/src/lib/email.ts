import { z } from "zod";

const emailSchema = z.email();

/** Strip accidental leading/trailing whitespace from an email input. */
export function normalizeEmail(value: string): string {
  return value.trim();
}

/** Same email check the login/register forms use (zod `z.email()`). */
export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(normalizeEmail(value)).success;
}
