import pool from '../db.js';
import { verifySignature } from '../middleware/verifySignature.js';
import { makeUniqueId } from '../utils/uniqueId.js';
import { appendRequestLog } from '../utils/logger.js';

export async function handlePost(req, res) {
  res.set('Content-Type', 'application/json');

  // Enforce application/json header like the PHP script
  const ct = req.headers['content-type'] || '';
  if (!ct || ct.toLowerCase() !== 'application/json') {
    return res.status(200).json({ code: 1, message: 'Invalid content type. Only JSON is supported' });
  }

  const jsonData = req.body;

  // Validate JSON parse (Express throws earlier on invalid JSON)
  if (!jsonData || typeof jsonData !== 'object') {
    return res.status(200).json({ code: 1, message: 'Invalid JSON data' });
  }

  // Extract fields
  const {
    app_id = null,
    user_id = null,
    ss_token = null,
    client_ip = null,
    game_id = null,
    signature = null,
    signature_nonce = null,
    timestamp = null
  } = jsonData;

  // Log request
  try { 
    // appendRequestLog(jsonData); 
  } catch (e) { 
    /* ignore logging failures */ 
  }

  // Required parameter check
  if (!app_id || !user_id || !ss_token || !game_id || !signature || !signature_nonce || !timestamp) {
    return res.status(200).json({ code: 1, message: 'Missing required parameters' });
  }

  // Signature check
  const ok = verifySignature({ signature_nonce, timestamp, signature });
  if (!ok) {
    return res.status(200).json({ code: 1, message: 'signature mismatch' });
  }

  const uid = Number.parseInt(user_id, 10);
  if (!Number.isFinite(uid)) {
    return res.status(200).json({ code: 1, message: 'Missing required parameters' });
  }

  const userImageDir = process.env.USER_IMAGE_DIR || 'https://zeeplive.blr1.cdn.digitaloceanspaces.com/zeepliveProfileImages/';
  const unique_id = makeUniqueId();

  let conn;
  try {
    conn = await pool.getConnection();

    // User detail query (prepared)
    const userSql = `
      SELECT 
        users.id AS user_id,
        users.name AS user_name,
        IFNULL(CONCAT(?, IFNULL(profile_images.image_name, '1.jpeg')), NULL) AS user_avatar,
        users.points AS balance
      FROM users
      LEFT JOIN profile_images
        ON users.id = profile_images.user_id
       AND profile_images.is_profile_image = 1
      WHERE users.id = ?
    `;

    const [rows] = await conn.execute(userSql, [userImageDir, uid]);

    if (!rows || rows.length === 0) {
      return res.status(200).json({ code: 1, message: 'No data exists' });
    }

    const data = rows[0];
    let total_coin = Number.parseInt(data.balance, 10) || 0;

    // Mic join feature
    const micSql = `
      SELECT id, caller_id, start_time, end_time, duration, call_rate, created_at
      FROM mic_join_details
      WHERE caller_id = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    const [micRows] = await conn.execute(micSql, [uid]);
    let mic_join_coin = 0;
    if (micRows && micRows.length > 0) {
      const mic = micRows[0];
      // If end_time is null/empty, compute accrued cost
      if (mic.end_time === null || mic.end_time === '' || typeof mic.end_time === 'undefined') {
        const nowMs = Date.now();
        const start = Number(mic.start_time) || 0;
        if (start > 0) {
          const cal_duration = ((nowMs - start) / 1000) / 60; // minutes
          const duration = Math.ceil(cal_duration);
          const callRate = Number(mic.call_rate) || 0;
          mic_join_coin = Math.ceil(callRate * duration);
        }
      }
    }

    total_coin = total_coin - mic_join_coin;
    data.balance = total_coin;
    data.user_id = String(data.user_id);

    return res.status(200).json({
      code: 0,
      message: 'succeed',
      unique_id,
      data
    });
  } catch (err) {
    // Generic JSON error (mirroring PHP style would still return JSON)
    return res.status(200).json({ code: 1, message: 'Internal server error', error: err?.message });
  } finally {
    if (conn) conn.release();
  }
}
