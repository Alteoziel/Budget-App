import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const raw =
    process.env.TELLER_TOKEN_ENCRYPTION_KEY ||
    process.env.CRON_SECRET ||
    "";
  if (!raw) {
    throw new Error(
      "Missing TELLER_TOKEN_ENCRYPTION_KEY (or CRON_SECRET fallback) for token encryption.",
    );
  }
  return createHash("sha256").update(raw).digest();
}

/** Encrypt access token at rest (AES-256-GCM). Stored as iv:tag:ciphertext hex. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted secret payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
