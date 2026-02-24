// src/controllers/getSSToken.js
import crypto from "crypto";
import { makeUniqueId } from "../utils/uniqueId.js";
// import { appendRequestLog } from "../utils/logger.js";

export async function getSSToken(req, res) {
  res.set("Content-Type", "application/json");

  // Check content type
  const ct = req.headers["content-type"] || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return res.status(200).json({
      code: 1,
      message: "Invalid content type. Only JSON is supported",
    });
  }

  const jsonData = req.body;
  if (!jsonData || typeof jsonData !== "object") {
    return res.status(200).json({
      code: 1,
      message: "Invalid JSON data",
    });
  }

  const { app_id = null, user_id = null, code = null, timestamp = null } = jsonData;

  // Required parameter check
  if (!app_id || !user_id || !timestamp) {
    return res.status(200).json({
      code: 1,
      message: "Missing required parameters",
    });
  }

  try {
    // Optional: log request
    // appendRequestLog(jsonData);
  } catch {
    // ignore log errors
  }

  // Compute ss_token = md5(app_id + user_id + code)
  const ss_token = crypto
    .createHash("md5")
    .update(String(app_id) + String(user_id) + String(code))
    .digest("hex");

  // Expire date: timestamp + (365 days)
  const new_timestamp = Number(timestamp) + 365 * 24 * 60 * 60;

  // Generate unique_id
  const unique_id = makeUniqueId();

  return res.status(200).json({
    code: 0,
    message: "succeed",
    unique_id,
    data: {
      ss_token,
      expire_date: new_timestamp,
    },
  });
}
