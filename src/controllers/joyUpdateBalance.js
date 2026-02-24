// /src/controllers/joyUpdateBalance.js
import pool from "../db.js";
import { notifyTencent } from "../utils/notify.js";
import NodeRSA from 'node-rsa';
import { nowStrLocal, todayStrLocal } from '../utils/localDateTime.js';

const gamesData = {
  16: { name: "Teen-Patti 2", statusCodeDr: "154", statusCodeCr: "155", statusTips: "170", statusTipsDr: "185" },
  25: { name: "Amazing Fishing", statusCodeDr: "156", statusCodeCr: "157", statusTips: "171", statusTipsDr: "186" },
  1:  { name: "Slots",          statusCodeDr: "158", statusCodeCr: "159", statusTips: "172", statusTipsDr: "187" },
  2:  { name: "Fruit Machine",  statusCodeDr: "160", statusCodeCr: "161", statusTips: "173", statusTipsDr: "188" },
  6:  { name: "Dice2",          statusCodeDr: "162", statusCodeCr: "163", statusTips: "174", statusTipsDr: "189" },
  10: { name: "Roulette",       statusCodeDr: "164", statusCodeCr: "165", statusTips: "175", statusTipsDr: "190" },
  14: { name: "Greedy",         statusCodeDr: "168", statusCodeCr: "169", statusTips: "176", statusTipsDr: "191" },
};

// --- helpers ---
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
// const todayStr = () => new Date().toISOString().slice(0, 10);
// const nowStr = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const nowStr = nowStrLocal();
const todayStr = todayStrLocal();
// const dayYYYYMMDD = dayYYYYMMDDLocal();


export async function joyUpdateBalance(req, res) {
  res.set("Content-Type", "application/json");

  try {
    const authorization = (req.headers?.authorization && String(req.headers.authorization)) || null;
    const m = authorization.match(/_(.*?)@(.*)/);
    if (!m) {
      return res.status(200).json({ code: 1, msg: "Missing required parameters" });
    }
    const user_id = toInt(m[1]);
    const game_id = toInt(m[2]);

    if (!gamesData[game_id]) {
      return res.status(200).json({ code: 1, msg: "Invalid gameId" });
    }
    const JOY_PRIVATE_KEY_ENV =process.env.JOY_PRIVATE_KEY || "";
    const JOY_PRIVATE_KEY =`-----BEGIN PRIVATE KEY-----${JOY_PRIVATE_KEY_ENV}-----END PRIVATE KEY-----`;

  const dataRaw = String(req.body?.data || '').trim();
  if (!dataRaw) return res.status(200).json({ code: 1, msg: 'Missing required parameters' });
    const key = new NodeRSA(JOY_PRIVATE_KEY);
    const bf = Buffer.from(dataRaw, 'hex')
    key.setOptions({ encryptionScheme: 'pkcs1', environment: "browser" });
    const requestdata = key.decrypt(bf, 'json');
    
    const coin = toInt(requestdata.coins);
    const type = toInt(requestdata.type); // 1=bet (debit), 2=result (credit)
    const room_id = requestdata.roomId ?? null;
    const roundId = String(requestdata.roundId ?? "");
    const transactionId = requestdata.transactionId ?? "";
    const today = todayStrLocal();
    const now = nowStrLocal();

    if (![1, 2].includes(type)) {
      return res.status(200).json({ code: 1, msg: "not allowed type" });
    }

    const statusCode =
      type === 2 ? gamesData[game_id].statusCodeCr : gamesData[game_id].statusCodeDr;

    const newData = {
      transactionId,
      coin,
      type,
      roomId: room_id,
    };

    let conn;
    try {
      conn = await pool.getConnection();

      // Fetch user
      const [uRows] = await conn.execute(
        `SELECT id, name, points, redeem_point FROM users WHERE id=?`,
        [user_id]
      );
      if (!uRows?.length) {
        return res.status(200).json({ code: 1, msg: "No data exists" });
      }
      const user = uRows[0];
      const balpoints = toInt(user.points);
      // const bal_redeem_point = toInt(user.redeem_point);
      const playerName = user.name || "";

      // Find existing bet row for today (avoid DATE() on index -> use BETWEEN)
      const dayStart = `${today} 00:00:00`;
      const dayEnd = `${today} 23:59:59`;
      const [betRows] = await conn.execute(
        `SELECT id, total_bet, total_won, tips, json_data
           FROM joy_third_party_bet
          WHERE user_id=? AND roundId=? AND gameId=? AND created_at BETWEEN ? AND ?
          ORDER BY id DESC LIMIT 1`,
        [user_id, roundId, game_id, dayStart, dayEnd]
      );
      const existingBet = betRows?.[0] || null;

      // -------- TYPE=1 (bet/debit) --------
      if (type === 1) {
        if (balpoints < coin) {
          return res.status(200).json({ code: 1, msg: "Balance too low" });
        }

        // Minimal transaction: wallets + users + bet row
        await conn.beginTransaction();
        try {
          const [uLock] = await conn.execute(
            `SELECT points, redeem_point FROM users WHERE id=? FOR UPDATE`,
            [user_id]
          );
          const up = toInt(uLock[0].points);
          const ur = toInt(uLock[0].redeem_point);
          if (up < coin) throw new Error("Balance too low");

          const new_points = up - coin;

          await conn.execute(
            `INSERT INTO wallets (user_id, debit, points, redeem_point, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user_id, coin, new_points, ur, statusCode, now, now]
          );

          await conn.execute(
            `UPDATE users SET points = points - ? WHERE id = ?`,
            [coin, user_id]
          );

          if (existingBet) {
            let arr = [];
            try { arr = JSON.parse(existingBet.json_data || "[]"); } catch {}
            arr.push(newData);
            const newJson = JSON.stringify(arr);
            const newBetTotal = toInt(existingBet.total_bet) + coin;
            await conn.execute(
              `UPDATE joy_third_party_bet
                  SET total_bet=?, json_data=?, updated_at=?
                WHERE id=?`,
              [newBetTotal, newJson, now, existingBet.id]
            );
          } else {
            await conn.execute(
              `INSERT INTO joy_third_party_bet
                 (gameId, roundId, roomId, user_id, total_bet, status, json_data, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
              [game_id, roundId, room_id ?? "", user_id, coin, JSON.stringify([newData]), now, now]
            );
          }

          await conn.commit();

        //   // best-effort (no locks/tx): user_energies
        //   try {
        //     const [eUpd] = await conn.execute(
        //       `UPDATE user_energies SET total_return = total_return - ?, updated_at=? WHERE user_id=?`,
        //       [coin, now, user_id]
        //     );
        //     if (eUpd.affectedRows === 0) {
        //       await conn.execute(
        //         `INSERT INTO user_energies (user_id, total_return, created_at, updated_at)
        //          VALUES (?, ?, ?, ?)`,
        //         [user_id, -coin, now, now]
        //       );
        //     }
        //   } catch {}

            // best-effort (no locks/tx): user_energies
            try {
                await conn.execute(
                `INSERT INTO user_energies (user_id, total_return, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE total_return = total_return - VALUES(total_return), updated_at = VALUES(updated_at)`,
                [user_id, -coin, current_date, now]
                );
            } catch {}

          return res.status(200).json({ code: 0, msg: "succeed", data: {} });
        } catch (e) {
          await conn.rollback();
          return res.status(200).json({ code: 1, msg: "Internal server error", error: e?.message });
        }
      }

      // -------- TYPE=2 (result/credit) --------
      if (type === 2) {
        const new_points = balpoints + coin;

        // wallets + users (credit)
        await conn.beginTransaction();
        try {
          const [uLock] = await conn.execute(
            `SELECT points, redeem_point FROM users WHERE id=? FOR UPDATE`,
            [user_id]
          );
          const up = toInt(uLock[0].points);
          const ur = toInt(uLock[0].redeem_point);

          await conn.execute(
            `INSERT INTO wallets (user_id, credit, points, redeem_point, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user_id, coin, up + coin, ur, gamesData[game_id].statusCodeCr, now, now]
          );
          await conn.execute(
            `UPDATE users SET points = points + ? WHERE id = ?`,
            [coin, user_id]
          );

          // Update bet history if exists
          if (existingBet) {
            let arr = [];
            try { arr = JSON.parse(existingBet.json_data || "[]"); } catch {}
            arr.push(newData);
            const newJson = JSON.stringify(arr);
            const newWon = toInt(existingBet.total_won) + coin;
            await conn.execute(
              `UPDATE joy_third_party_bet
                  SET total_won=?, json_data=?, status=2, updated_at=?
                WHERE id=?`,
              [newWon, newJson, now, existingBet.id]
            );
          }

          await conn.commit();
        } catch (e) {
          await conn.rollback();
          return res.status(200).json({ code: 1, msg: "Internal server error", error: e?.message });
        }
        try {
            // user_energies (best-effort, no explicit locking)
            await conn.execute(
            `INSERT INTO user_energies (user_id, total_return, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE total_return = total_return + VALUES(total_return), updated_at = VALUES(updated_at)`,
            [user_id, coin, now, now]
            );
        } catch {}

        // Won-case: tip share to host (1%) once if profit>0 and not already tipped
        if (existingBet) {
          const existingBetAmount = toInt(existingBet.total_bet) || 0;
          const existingWonAmount = toInt(existingBet.total_won) || 0; // note: we updated it above by +coin for display, but Laravel read-before-update pattern anyway
          const existingTipsAmount = toInt(existingBet.tips) || 0;

          const profit = existingWonAmount - existingBetAmount;
          const statusTips = gamesData[game_id].statusTips;
          let giveshare = 1;
          let room_share = 0;

          if (giveshare === 1 && room_id && profit > 0 && existingTipsAmount === 0) {
            room_share = Math.trunc((1 / 100) * profit); // 1%
          } else {
            giveshare = 0;
          }

          // derive room_profile_id
          let room_profile_id = "";
          if (room_id && String(room_id).includes("Zeeplive")) {
            room_profile_id = String(room_id).replace(/^Zeeplive/, "");
          } else if (room_id && String(room_id).includes("party_")) {
            room_profile_id = String(room_id).replace(/^party_/, "");
          }

          // credit tips to host and deduct from winner (no company wallet share here per Laravel you shared—commented out)
          if (profit > 0 && giveshare === 1 && room_id && room_profile_id) {
            try {
              const [hostRows] = await conn.execute(
                `SELECT id, points, redeem_point, group_id FROM users WHERE profile_id=? LIMIT 1`,
                [room_profile_id]
              );
              const host = hostRows?.[0];
              if (host) {
                const host_id = toInt(host.id);

                // small tx around host+winner deductions to keep rows consistent
                await conn.beginTransaction();
                try {
                  // lock both rows deterministically to reduce deadlocks
                  const [hLock] = await conn.execute(
                    `SELECT points, redeem_point FROM users WHERE id=? FOR UPDATE`,
                    [host_id]
                  );
                  const [wLock] = await conn.execute(
                    `SELECT points, redeem_point, name FROM users WHERE id=? FOR UPDATE`,
                    [user_id]
                  );

                  // 1) credit host
                  await conn.execute(
                    `INSERT INTO wallets (user_id, credit, points, redeem_point, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                      host_id,
                      room_share,
                      toInt(hLock[0].points) + room_share,
                      toInt(hLock[0].redeem_point) + room_share,
                      statusTips,
                      now,
                      now,
                    ]
                  );
                  await conn.execute(
                    `UPDATE users SET points = points + ?, redeem_point = redeem_point + ? WHERE id = ?`,
                    [room_share, room_share, host_id]
                  );

                  // 2) mark tips on bet
                  await conn.execute(
                    `UPDATE joy_third_party_bet
                        SET tips = tips + ?
                      WHERE user_id = ? AND gameId = ? AND roundId = ?`,
                    [room_share, user_id, game_id, roundId]
                  );

                  // 3) debit winner for tips (Laravel: also creates a Wallet debit with statusTipsDr)
                  const winnerNewPts = toInt(wLock[0].points) - room_share;
                  await conn.execute(
                    `INSERT INTO wallets (user_id, debit, points, redeem_point, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [user_id, room_share, winnerNewPts, toInt(wLock[0].redeem_point), gamesData[game_id].statusTipsDr, now, now]
                  );
                  await conn.execute(
                    `UPDATE users SET points = points - ? WHERE id = ?`,
                    [room_share, user_id]
                  );

                  await conn.commit();

                  // send group notification (best-effort)
                  try {
                    const group_id = host.group_id;
                    if (group_id) {
                      const msg = `In ${gamesData[game_id].name} Game get tips ${room_share} by ${playerName}`;
                      notifyTencent(host_id, msg);
                    }
                  } catch {}
                  
                } catch (e2) {
                  await conn.rollback();
                }
              }
            } catch {}
          }

          // Winner win-notification (best-effort)
          try {
            const [hostRows2] = await conn.execute(
              `SELECT id, group_id FROM users WHERE profile_id=? LIMIT 1`,
              [room_profile_id]
            );
            const groupId2 = hostRows2?.[0]?.group_id;
            if (groupId2 && hostRows2?.[0]?.id) {
                const tips_user_id2 = toInt(hostRows2[0].id);
                const msg1 = `${playerName} won ${coin} diamonds in ${gamesData[game_id].name}`;
                notifyTencent(tips_user_id2, msg1);
            }
          } catch {}
        }

        return res.status(200).json({ code: 0, msg: "succeed", data: {} });
      }

      // Fallback
      return res.status(200).json({ code: 1, msg: "Invalid type" });
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
