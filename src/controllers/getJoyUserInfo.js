// /src/controllers/getJoyUserInfo.js
import pool from "../db.js";

// tiny helpers
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

export async function getJoyUserInfo(req, res) {
  res.set("Content-Type", "application/json");

  try {
    // 1) Read Authorization header
    const authorization =
      (req.headers?.authorization && String(req.headers.authorization)) || null;

    if (!authorization) {
      return res.status(200).json({ code: 1, msg: "Missing required parameters" });
    }

    // Laravel regex: /_(.*?)@(.*)/
    // e.g. "prefix_123@1016" => user_id=123, game_id=1016
    const m = authorization.match(/_(.*?)@(.*)/);
    if (!m) {
      return res.status(200).json({ code: 1, msg: "Missing required parameters" });
    }
    const user_id = toInt(m[1]);
    const game_id = m[2]; // captured but not used further (kept for parity)

    let conn;
    try {
      conn = await pool.getConnection();

      // 2) Fetch user + profile image (is_profile_image = 1)
      const [userRows] = await conn.execute(
        `
        SELECT u.id, u.name, u.rich_level, u.points,
               pi.image_name
          FROM users u
          LEFT JOIN profile_images pi
            ON pi.user_id = u.id AND pi.is_profile_image = 1
         WHERE u.id = ?
        `,
        [user_id]
      );

      if (!userRows || userRows.length === 0) {
        return res.status(200).json({ code: 1, msg: "No data exists"+user_id });
      }

      const user = userRows[0];
      const defaultAvatar =
        "https://zeeplive.blr1.cdn.digitaloceanspaces.com/zeepliveProfileImages/1.jpeg";

      // 3) Get latest mic join detail for this caller
      //    (Only charge if end_time is empty/NULL -> ongoing call)
      const [micRows] = await conn.execute(
        `
        SELECT id, start_time, end_time, call_rate
          FROM mic_join_details
         WHERE caller_id = ?
         ORDER BY id DESC
         LIMIT 1
        `,
        [user_id]
      );

      let mic_charge_point = 0;
      if (micRows && micRows.length > 0) {
        const mrow = micRows[0];
        const end_time = mrow.end_time; // may be NULL or '' when ongoing
        if (end_time === null || end_time === "" || end_time === 0) {
          // Laravel code:
          // end_duration = time() * 1000  (milliseconds now)
          // duration (minutes, ceil): ((now_ms - start_time)/1000)/60
          const nowMs = Date.now();
          const startMs = toInt(mrow.start_time); // stored in ms
          const callRate = toInt(mrow.call_rate);

          if (startMs > 0 && nowMs >= startMs) {
            const minutes = Math.ceil(((nowMs - startMs) / 1000) / 60);
            mic_charge_point = Math.ceil(callRate * minutes);
          }
        }
      }

      // 4) Build response payload (match Laravel)
      const data = {
        userId: toInt(user.id),
        pkgName: "starmate",
        nickname: user.name || "",
        avatarUrl: user.image_name || defaultAvatar,
        availableCoins: toInt(user.points) - mic_charge_point,
        level: toInt(user.rich_level),
      };

      return res.status(200).json({ code: 0, msg: "succeed", data });
    } finally {
      if (conn) conn.release();
    }
  } catch (err) {
    return res.status(200).json({
      code: 1,
      msg: "Internal server error",
      error: err?.message || String(err),
    });
  }
}
