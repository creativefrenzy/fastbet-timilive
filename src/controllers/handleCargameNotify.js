// /src/controllers/handleCargameNotify.js
import crypto from "crypto";
import pool from "../db.js";
import { notifyTencent } from "../utils/notify.js";

const secret = process.env.GLOBAL_BET_SECRET || "";

// HMAC signature builder (matches Python)
function makeSignature(secretKey, domainId, eventId, ts, payloadStr) {
  const msg = `${domainId}.${eventId}.${ts}.${payloadStr}`;
  return crypto.createHmac("sha256", secretKey).update(msg, "utf8").digest("hex");
}

// helpers to compute per-seat tip
function parsePartySeats(value, exclude) {
  if (!value || !/^[0-9,]+$/.test(value)) return [];
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== String(exclude));
  return [...new Set(parts)];
}

function perShareTip(totalTips, partySeatUsers, roomId) {
  const seats = parsePartySeats(partySeatUsers, roomId);
  const shareholders = Math.max(1, 1 + seats.length);
  return Math.trunc((totalTips || 0) / shareholders);
}

async function getUserByProfileId(conn, profileId) {
  const [rows] = await conn.execute(
    `SELECT id, name, profile_id, group_id, login_type
       FROM users
      WHERE profile_id = ?
      LIMIT 1`,
    [profileId]
  );
  return rows[0] || null;
}

async function getUserByGroupId(conn, groupId) {
  const [rows] = await conn.execute(
    `SELECT id, name, profile_id, group_id, login_type
       FROM users
      WHERE group_id = ?
      LIMIT 1`,
    [groupId]
  );
  return rows[0] || null;
}

/**
 * Fire-and-forget worker:
 * - runs AFTER HTTP response is sent
 * - uses its own DB connection + transaction
 * - all errors are logged, never thrown to Express
 */
async function processCargameNotifyJob({ contestId }) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ---------------------------------------------------
    // A) Aggregate per-room totals
    // ---------------------------------------------------
    const [betStats] = await conn.execute(
      `
      SELECT
        COUNT(id) AS total_user,
        room_id,
        GROUP_CONCAT(group_id) AS group_id,
        contestid,
        COALESCE(SUM(total_bet),0) AS total_bet,
        COALESCE(SUM(total_won),0) AS total_won,
        COALESCE(SUM(tips),0) AS total_tips,
        MAX(party_seat_users) AS party_seat_users
      FROM cargame_bet_global
      WHERE contestid = ?
        AND total_won > 0
        AND room_id IS NOT NULL
      GROUP BY room_id
      ORDER BY room_id ASC
      `,
      [contestId]
    );

    for (const bs of betStats) {
      const totalUser = Number(bs.total_user || 0);
      const roomIdVal = String(bs.room_id || "");
      const totalWonVal = Number(bs.total_won || 0);
      const totalTipsVal = Number(bs.total_tips || 0);
      const partySeatsStr = bs.party_seat_users || "";

      if (!roomIdVal) continue;

      const tipsEach = perShareTip(totalTipsVal, partySeatsStr, roomIdVal);

      const roomUser = await getUserByProfileId(conn, roomIdVal);
      if (roomUser?.group_id) {
        const gid = roomUser.group_id;

        // NOTE: if notifyTencent is async, await it; if it's sync, just call it.
        await Promise.resolve(
          notifyTencent(gid, `In car game, ${totalUser} players have won ${totalWonVal} diamonds as reward.`)
        );

        if (tipsEach > 0) {
          await Promise.resolve(
            notifyTencent(gid, `Each party seat member has received ${tipsEach} diamonds as tips in car game`)
          );
        }
      }
    }

    // ---------------------------------------------------
    // B) Detailed per-bet notifications
    // ---------------------------------------------------
    const [detailedRows] = await conn.execute(
      `
      SELECT
        cb.id,
        cb.user_id,
        cb.group_id AS group_list,
        cb.room_id,
        cb.contestid,
        cb.total_bet,
        cb.total_won,
        cb.profit,
        cb.party_seat_users,
        cb.tips,
        u.name AS name
      FROM cargame_bet_global cb
      LEFT JOIN users u ON cb.user_id = u.id
      WHERE cb.contestid = ?
        AND cb.total_won > 0
      `,
      [contestId]
    );

    for (const row of detailedRows) {
      const groupListStr = row.group_list || "";
      const name = String(row.name || "User");

      const tipsEach = perShareTip(Number(row.tips || 0), row.party_seat_users || "", row.room_id);

      const groups = groupListStr
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      for (const gid of groups) {
        const hostUser = await getUserByGroupId(conn, gid);
        if (!hostUser?.group_id) continue;

        if (tipsEach > 0) {
          await Promise.resolve(
            notifyTencent(gid, `${hostUser.name}: Tips ${tipsEach} diamonds earned in Car Game from ${name}`)
          );
        }
      }
    }

    await conn.commit();
    console.log(`[cargameNotifyJob] done contestId=${contestId} rooms=${betStats.length} bets=${detailedRows.length}`);
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    console.error(`[cargameNotifyJob] FAILED contestId=${contestId}`, e);
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
  }
}

export async function handleCargameNotify(req, res) {
  res.set("Content-Type", "application/json");

  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  try {
    const eventId = req.header("X-Event-Id");
    const domainIdH = req.header("X-Domain-Id");
    const ts = req.header("X-Timestamp");
    const sig = req.header("X-Signature");

    if (!eventId || !domainIdH || !ts || !sig) {
      return res.status(400).json({ code: 1, msg: "Missing required headers", traceId });
    }

    // ✅ Use raw body captured by express.json verify()
    const rawBuf = req.rawBody;
    if (!rawBuf || !Buffer.isBuffer(rawBuf)) {
      return res.status(400).json({ code: 1, msg: "Missing rawBody (check express.json verify)", traceId });
    }
    const payloadStr = rawBuf.toString("utf8"); // exact bytes -> string

    const domainId = parseInt(domainIdH, 10) || 0;
    const eventIdInt = parseInt(eventId, 10) || 0;

    const expected = makeSignature(secret, domainId, eventIdInt, ts, payloadStr);
    if (expected !== String(sig)) {
      return res.status(401).json({ code: 1, msg: "Invalid signature", traceId });
    }

    const contestId = String(req.body?.contest_id || "").trim();
    if (!contestId) {
      return res.status(400).json({ code: 1, msg: "Missing contest_id", traceId });
    }

    // ✅ ACK immediately
    res.status(200).json({ code: 0, msg: "queued", traceId });

    // ✅ fire-and-forget
    setImmediate(() => processCargameNotifyJob({ contestId, traceId }));
  } catch (err) {
    console.error(`[handleCargameNotify:${traceId}]`, err);
    return res.status(500).json({
      code: 1,
      msg: "Internal server error",
      traceId,
      error: err?.message || String(err),
    });
  }
}
