import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const AUTH_TAG_LENGTH = 16;

function keyBytes(): Buffer {
  const raw = process.env.BANK_TOKEN_ENCRYPTION_KEY || "";
  if (!raw) {
    throw new Error(
      "Missing BANK_TOKEN_ENCRYPTION_KEY for token encryption. " +
        "Set a dedicated random secret in Doppler (do not reuse CRON_SECRET).",
    );
  }
  return createHash("sha256").update(raw).digest();
}

/** Encrypt secrets at rest (AES-256-GCM). Stored as iv:tag:ciphertext hex. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Unexpected GCM auth tag length.");
  }
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted secret payload.");
  }
  const tag = Buffer.from(tagHex, "hex");
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid GCM auth tag length.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivHex, "hex"),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
