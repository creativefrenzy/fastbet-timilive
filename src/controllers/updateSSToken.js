// src/controllers/updateSSToken.js
import crypto from "crypto";
// import { appendRequestLog } from "../utils/logger.js";

export async function updateSSToken(req, res) {
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

  
  return res.status(200).json({
    code: 0,
    message: "succeed"
  });
}