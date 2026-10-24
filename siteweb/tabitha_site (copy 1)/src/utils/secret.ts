import { sha256Hex } from "./sha256";

// SHA-256 of the 8 digits of the secret code (dashes are not part of the input).
// The code itself is never stored in clear in this file.
const SECRET_HASH =
  "91d862cbeb1b9171b09e03c0b52784913e3c08671b38c76aec3f3689f40ffc84";

export const CODE_LENGTH = 8;

/** Returns true only if the 8 entered digits match the secret code. */
export async function isSecretCode(digits: string): Promise<boolean> {
  if (digits.length !== CODE_LENGTH || !/^[0-9]{8}$/.test(digits)) return false;
  const hash = await sha256Hex(digits);
  return hash === SECRET_HASH;
}
