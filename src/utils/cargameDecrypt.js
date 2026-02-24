import crypto from "crypto";

const CIPHER = "aes-256-cbc";
const KEY = "E9M6ef023KKrX98DbAjLhQHEx9QiDdXZ"; // 32 bytes
const IV = "ETWKYc2LJA2ET4AZ";                   // 16 bytes

export function decryptRequest(encryptedData) {
  if (!encryptedData) return null;

  try {
    // PHP openssl_encrypt/decrypt uses base64 by default
    const decipher = crypto.createDecipheriv(
      CIPHER,
      Buffer.from(KEY, "utf8"),
      Buffer.from(IV, "utf8")
    );

    let decrypted = decipher.update(encryptedData, "base64", "utf8");
    decrypted += decipher.final("utf8");

    const decoded = JSON.parse(decrypted);
    if (!decoded || typeof decoded !== "object") return null;

    const req = {};
    for (const [k, v] of Object.entries(decoded)) {
      req[k] = v;
    }
    return req;
  } catch (e) {
    console.error("decryptRequest error:", e.message);
    return null;
  }
}

export function signRequest(bodyObject, signing_secret) {
  const ts = Math.floor(Date.now() / 1000);
  const rawBody = Buffer.from(JSON.stringify(bodyObject), "utf8");

  const payloadToSign = Buffer.concat([
    Buffer.from(String(ts), "utf8"),
    Buffer.from(".", "utf8"),
    rawBody,
  ]);

  const sig = crypto
    .createHmac("sha256", signing_secret)
    .update(payloadToSign)
    .digest("hex");

  return {
    ts,
    signatureHeader: `sha256=${sig}`,
    rawBody: rawBody.toString("utf8"),
  };
}
