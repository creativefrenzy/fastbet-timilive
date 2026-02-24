// /src/utils/createTlsSigner.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

export function createTlsSigner(sdkAppId, secretKey) {
  const mod = require("tls-sig-api-v2");

  // Your module shows: Module keys: Api
  // So first try Api
  const candidate =
    mod?.Api ??
    mod?.TLSSigAPIv2 ??
    mod?.default?.Api ??
    mod?.default?.TLSSigAPIv2 ??
    mod?.default ??
    mod;

  // If candidate already has genUserSig (rare but possible)
  if (candidate && typeof candidate.genUserSig === "function") {
    return candidate;
  }

  // If Api is an object that contains a class/function inside
  if (candidate && typeof candidate === "object") {
    // common: candidate.Api or candidate.TLSSigAPIv2 nested
    const inner =
      candidate?.Api ??
      candidate?.TLSSigAPIv2 ??
      candidate?.default ??
      null;

    if (inner && typeof inner.genUserSig === "function") return inner;

    if (typeof inner === "function") {
      // class vs factory
      try {
        const inst = new inner(sdkAppId, secretKey);
        if (inst && typeof inst.genUserSig === "function") return inst;
      } catch (_) {
        const inst = inner(sdkAppId, secretKey);
        if (inst && typeof inst.genUserSig === "function") return inst;
      }
    }
  }

  // If Api is directly a function (constructor or factory)
  if (typeof candidate === "function") {
    try {
      const inst = new candidate(sdkAppId, secretKey);
      if (inst && typeof inst.genUserSig === "function") return inst;
    } catch (_) {
      const inst = candidate(sdkAppId, secretKey);
      if (inst && typeof inst.genUserSig === "function") return inst;
    }
  }

  // Helpful debug
  const keys = Object.keys(mod || {}).join(", ");
  const apiKeys = Object.keys(mod?.Api || {}).join(", ");

  throw new Error(
    `tls-sig-api-v2 export shape not supported. Module keys: ${keys}. Api keys: ${apiKeys}`
  );
}
