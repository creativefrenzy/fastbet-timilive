// src/utils/notify.js
// Fire-and-forget HTTP POST (no await, no unhandled rejection)
export function notifyTencent(receiver_id, message) {
  try {
    const url = "https://timivoilet.in/api/send-tencent-message";
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_id, message })
    };

    // Do not await; swallow errors so it never block/fail the main flow
    // Use .then/.catch to avoid unhandled rejections in Node.
    // If you're on Node <18, install 'node-fetch' and import it.
    fetch(url, opts).then(() => {}).catch(() => {});
  } catch {
    // no-op: absolutely non-blocking
  }
}
