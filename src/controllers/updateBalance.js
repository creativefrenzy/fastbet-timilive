// /src/controllers/updateBalance.js
import crypto from "crypto";
import pool from "../db.js";
import { makeUniqueId } from "../utils/uniqueId.js";
import { appendRequestLog } from "../utils/logger.js";
import { notifyTencent } from "../utils/notify.js";
import { nowStrLocal, todayStrLocal, dayYYYYMMDDLocal } from '../utils/localDateTime.js';

// Static mapping from PHP
const gamesData = {
  1010: { name: "Lottery", statusCodeDr: "140", statusCodeCr: "141", statusTips: "177" },
  1016: { name: "Crash", statusCodeDr: "142", statusCodeCr: "143", statusTips: "178" },
  1017: { name: "Greedy2", statusCodeDr: "144", statusCodeCr: "145", statusTips: "179" },
  1022: { name: "FishingStar", statusCodeDr: "146", statusCodeCr: "147", statusTips: "180" },
  1061: { name: "TeenPattiPro", statusCodeDr: "148", statusCodeCr: "149", statusTips: "181" },
  1081: { name: "RoulettePro", statusCodeDr: "150", statusCodeCr: "151", statusTips: "182" },
  1004: { name: "Slots", statusCodeDr: "152", statusCodeCr: "153", statusTips: "183" },
  1034: { name: "Fishing Star", statusCodeDr: "166", statusCodeCr: "167", statusTips: "184" },
  1063: { name: "GreedyFruit", statusCodeDr: "194", statusCodeCr: "195", statusTips: "196" },
  1090: { name: "FruitLoops", statusCodeDr: "197", statusCodeCr: "198", statusTips: "199" },
  1070: { name: "Luck77", statusCodeDr: "203", statusCodeCr: "204", statusTips: "205" },
  1095: { name: "Hide or Seek", statusCodeDr: "206", statusCodeCr: "207", statusTips: "208" },
  1058: { name: "UEFA Penalty kick", statusCodeDr: "209", statusCodeCr: "210", statusTips: "211" },
  1105: { name: "Magic Card", statusCodeDr: "212", statusCodeCr: "213", statusTips: "214" },
  1029: { name: "Fruit Carnival", statusCodeDr: "215", statusCodeCr: "216", statusTips: "217" },
  1053: { name: "MagicSlot", statusCodeDr: "225", statusCodeCr: "226", statusTips: "227" },
  1084: { name: "DragonTiger2", statusCodeDr: "252", statusCodeCr: "253", statusTips: "254" },
  1116: { name: "LuckyStairs", statusCodeDr: "228", statusCodeCr: "229", statusTips: "230" },
  1131: { name: "ChickenRun", statusCodeDr: "258", statusCodeCr: "259", statusTips: "260" },
};

const ROOM_SHARE_PERCENT_DEFAULT = 1; // matches PHP default

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
// const nowStr = () => new Date().toISOString().replace("T", " ").slice(0, 19);
// const todayStr = () => new Date().toISOString().slice(0, 10);
// const dayYYYYMMDD = () => {
//   const d = new Date();
//   return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
// };

const nowStr = nowStrLocal();

const todayStr = todayStrLocal();

const dayYYYYMMDD = dayYYYYMMDDLocal();


function verifySignature(signature_nonce, timestamp, signature) {
  const key = process.env.APP_KEY || "";
  const generated = md5(String(signature_nonce) + String(key) + String(timestamp));
  return generated === String(signature);
}

export async function updateBalance(req, res) {
  res.set("Content-Type", "application/json");

  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return res.status(200).json({ code: 1, message: "Invalid content type. Only JSON is supported" });
  }

  const jsonData = req.body;
  if (!jsonData || typeof jsonData !== "object") {
    return res.status(200).json({ code: 1, message: "Invalid JSON data" });
  }

  const {
    app_id = null,
    currency_diff = null,
    diff_msg = null, // 'bet' or 'result'
    game_id = null,
    game_round_id = null,
    room_id = null,
    ss_token = null,
    user_id = null,
    signature = null,
    signature_nonce = null,
    timestamp = null,
    order_id = null,
  } = jsonData;

  try { 
    // appendRequestLog(jsonData); 
  } catch {}

  // Requireds
  if (!app_id || !user_id || !ss_token || !game_id || !signature || !signature_nonce || !timestamp) {
    return res.status(200).json({ code: 1, message: "Missing required parameters" });
  }

  if (!verifySignature(signature_nonce, timestamp, signature)) {
    return res.status(200).json({ code: 1, message: "signature mismatch" });
  }

  if (!["result", "bet"].includes(String(diff_msg))) {
    return res.status(200).json({ code: 1, message: "not allowed diff msg" });
  }

  const gId = toInt(game_id);
  if (!gamesData[gId]) {
    return res.status(200).json({ code: 1, message: "Invalid gameId" });
  }

  const uid = toInt(user_id);
  const coinAbs = Math.abs(toInt(currency_diff));
  const unique_id = makeUniqueId();

  const current_date = nowStrLocal();
  const today_date = todayStrLocal();

  const startOfDay = `${today_date} 00:00:00`;
  const endOfDay   = `${today_date} 23:59:59`;

  // Figure status code by diff
  const statusCode =
    diff_msg === "result" ? gamesData[gId].statusCodeCr : gamesData[gId].statusCodeDr;

  let conn;
  try {
    conn = await pool.getConnection();

    // Read last bet row for today/user/round/game (no lock)
    const [betRows] = await conn.execute(
      `SELECT id, gameId, roundId, roomId, user_id, total_bet, total_won, status, json_data
         FROM third_party_bet
        WHERE user_id = ? AND roundId = ? AND gameId = ? AND created_at >= ? AND created_at <= ?
        ORDER BY id DESC LIMIT 1`,
      [uid, String(game_round_id ?? ""), gId, startOfDay, endOfDay]
    );
    const res_bet = betRows?.[0];

    // Fetch user wallet basics (no lock yet)
    const [walletRows] = await conn.execute(
      `SELECT id, name, points, redeem_point FROM users WHERE id = ?`,
      [uid]
    );
    if (!walletRows || walletRows.length === 0) {
      return res.status(200).json({ code: 1, message: "No data exists" });
    }
    let { points: balpoints, name: playerName, redeem_point: bal_redeem_point } = walletRows[0];
    balpoints = toInt(balpoints);
    bal_redeem_point = toInt(bal_redeem_point);

    let new_points = balpoints;

    if (diff_msg === "bet") {
      // ---------- BET: do the minimum inside a short transaction ----------
      if (balpoints < coinAbs) {
        return res.status(200).json({ code: 1, message: "Balance too low" });
      }

      await conn.beginTransaction();
      try {
        // Lock user row deterministically
        const [u2] = await conn.execute(
          `SELECT points, redeem_point FROM users WHERE id = ? FOR UPDATE`,
          [uid]
        );
        const up = toInt(u2[0].points);
        const ur = toInt(u2[0].redeem_point);
        if (up < coinAbs) {
          throw new Error("Balance too low");
        }
        const nextPoints = up - coinAbs;

        await conn.execute(
          `INSERT INTO wallets (user_id, debit, points, redeem_point, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uid, coinAbs, nextPoints, ur, statusCode, current_date, current_date]
        );

        await conn.execute(
          `UPDATE users SET points = points - ? WHERE id = ?`,
          [coinAbs, uid]
        );

        const newData = {
          orderId: order_id,
          coin: coinAbs,
          diff_msg,
          roomId: room_id,
        };

        if (res_bet) {
          let arrayData = [];
          if (res_bet.json_data) {
            try { arrayData = JSON.parse(res_bet.json_data) || []; } catch {}
          }
          arrayData.push(newData);
          const modifiedJson = JSON.stringify(arrayData);
          const existingBetAmount = (toInt(res_bet.total_bet) || 0) + coinAbs;

          await conn.execute(
            `UPDATE third_party_bet
                SET total_bet = ?, json_data = ?, updated_at = ?
              WHERE id = ?`,
            [existingBetAmount, modifiedJson, current_date, res_bet.id]
          );
        } else {
          const modifiedJson = JSON.stringify([newData]);
          await conn.execute(
            `INSERT INTO third_party_bet
               (gameId, roundId, roomId, user_id, total_bet, status, json_data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [gId, String(game_round_id ?? ""), String(room_id ?? ""), uid, coinAbs, modifiedJson, current_date, current_date]
          );
        }

        await conn.commit();
        new_points = nextPoints;
      } catch (e) {
        await conn.rollback();
        throw e;
      }

      // Outside the main transaction (no explicit locks requested)
      try {
        await conn.execute(
          `INSERT INTO user_energies (user_id, total_return, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE total_return = total_return - VALUES(total_return), updated_at = VALUES(updated_at)`,
          [uid, coinAbs, current_date, current_date]
        );
      } catch {}

    } else if (diff_msg === "result") {
      // ---------- RESULT ----------
      // Read company wallet percentage WITHOUT any locks as requested
      let room_share_percentage = ROOM_SHARE_PERCENT_DEFAULT;
      let system_share_percentage = 1;
      let company_wallet_percentage = 0;

      try {
        const [cwRows] = await conn.execute(
          `SELECT deduct_percentage FROM company_game_wallets WHERE id = 1`
        );
        const ded = toInt(cwRows?.[0]?.deduct_percentage);
        if (ded > 0) {
          company_wallet_percentage = ded;
          if (room_share_percentage > company_wallet_percentage) {
            room_share_percentage -= (company_wallet_percentage / 2);
          }
          if (system_share_percentage > company_wallet_percentage) {
            system_share_percentage -= (company_wallet_percentage / 2);
          }
        }
      } catch {}

      let coin = toInt(currency_diff); // may be negative or positive
      const existingBetAmount = toInt(res_bet?.total_bet) || 0;
      const existingWonAmount0 = toInt(res_bet?.total_won) || 0;
      const profit = coin - existingBetAmount;

      const statusTips = gamesData[gId].statusTips;
      let room_share = 0;
      let system_share = 0;
      let company_wallet_share = 0;

      const excluded = [1022, 1034];
      if (profit > 0 && !excluded.includes(gId)) {
        room_share = Math.trunc((room_share_percentage / 100) * profit);
        system_share = Math.trunc((system_share_percentage / 100) * profit);
        company_wallet_share = Math.trunc((company_wallet_percentage / 100) * profit);
        coin = coin - room_share - system_share - company_wallet_share;
      }

      // Main transaction only for user balance + bet row
      await conn.beginTransaction();
      try {
        // Lock the user row to apply credit safely
        const [u3] = await conn.execute(
          `SELECT points, redeem_point FROM users WHERE id = ? FOR UPDATE`,
          [uid]
        );
        const up = toInt(u3[0].points);
        const ur = toInt(u3[0].redeem_point);

        const creditedPoints = up + coin;

        await conn.execute(
          `INSERT INTO wallets (user_id, credit, points, redeem_point, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uid, coin, creditedPoints, ur, statusCode, current_date, current_date]
        );

        await conn.execute(
          `UPDATE users SET points = points + ? WHERE id = ?`,
          [coin, uid]
        );

        // Update third_party_bet with final won values (if row exists)
        if (res_bet) {
          let arrayData = [];
          if (res_bet.json_data) {
            try { arrayData = JSON.parse(res_bet.json_data) || []; } catch {}
          }
          arrayData.push({
            orderId: order_id,
            coin: Math.abs(toInt(currency_diff)),
            diff_msg,
            roomId: room_id,
          });
          const modifiedJson = JSON.stringify(arrayData);

          const finalWon =
            (existingWonAmount0 + toInt(currency_diff)) - room_share - system_share - company_wallet_share;

          await conn.execute(
            `UPDATE third_party_bet
                SET total_won = ?, tips = ?, system_share = ?, company_wallet_share = ?, status = 2, json_data = ?, updated_at = ?
              WHERE id = ?`,
            [finalWon, room_share, system_share, company_wallet_share, modifiedJson, current_date, res_bet.id]
          );
        }

        await conn.commit();
        new_points = creditedPoints;
      } catch (e) {
        await conn.rollback();
        throw e;
      }

      // Outside main transaction as requested (no locks on these tables)
      try {
        // user_energies (best-effort, no explicit locking)
        await conn.execute(
          `INSERT INTO user_energies (user_id, total_return, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE total_return = total_return + VALUES(total_return), updated_at = VALUES(updated_at)`,
          [uid, coin, current_date, current_date]
        );
      } catch {}

      // company_game_wallets and histories (best-effort, no explicit locking/transactions)
      if (company_wallet_share > 0) {
        try {
          await conn.execute(
            `UPDATE company_game_wallets
                SET balance = balance + ?, total_credit = total_credit + ?
              WHERE id = 1`,
            [company_wallet_share, company_wallet_share]
          );

          const todayDay = dayYYYYMMDD();
          await conn.execute(
            `INSERT INTO company_game_wallet_histories (credit, day, game_name, game_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE credit = credit + VALUES(credit), updated_at = VALUES(updated_at)`,
            [company_wallet_share, todayDay, gamesData[gId].name, gId, current_date, current_date]
          );
        } catch {}
      }

      // Tip share to host (room owner) – optional, separate small tx on users only
      const excluded2 = [1022, 1034];
      if (room_share > 0 && profit > 0 && room_id && !excluded2.includes(gId)) {
        let room_profile_id = "";
        if (String(room_id).startsWith("Zeeplive")) {
          room_profile_id = String(room_id).replace(/^Zeeplive/, "");
        } else if (String(room_id).startsWith("party_")) {
          room_profile_id = String(room_id).replace(/^party_/, "");
        }

        if (room_profile_id) {
          try {
            const [roomUserRows] = await conn.execute(
              `SELECT id, points, redeem_point FROM users WHERE profile_id = ? ORDER BY id DESC LIMIT 1`,
              [room_profile_id]
            );
            const roomuser = roomUserRows?.[0];
            if (roomuser) {
              const tips_user_id = toInt(roomuser.id);
              // short, isolated transaction for room owner's credit
              await conn.beginTransaction();
              try {
                const [ru] = await conn.execute(
                  `SELECT points, redeem_point FROM users WHERE id = ? FOR UPDATE`,
                  [tips_user_id]
                );
                const rpoints = toInt(ru[0].points);
                const rredeem = toInt(ru[0].redeem_point);

                const tips_points = rpoints + room_share;
                const tips_redeem_point = rredeem + room_share;

                await conn.execute(
                  `INSERT INTO wallets (user_id, credit, points, redeem_point, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [tips_user_id, room_share, tips_points, tips_redeem_point, statusTips, current_date, current_date]
                );
                await conn.execute(
                  `UPDATE users SET points = points + ?, redeem_point = redeem_point + ? WHERE id = ?`,
                  [room_share, room_share, tips_user_id]
                );
                await conn.commit();

                try {
                  notifyTencent(tips_user_id, `In ${gamesData[gId].name} Game get tips ${room_share} by ${playerName}`);
                } catch {}
              } catch (e) {
                await conn.rollback();
              }
            }
          } catch {}
        }

        // Win notification to room owner (best-effort)
        try {
          let room_profile_id2 = "";
          if (String(room_id).startsWith("Zeeplive")) {
            room_profile_id2 = String(room_id).replace(/^Zeeplive/, "");
          } else if (String(room_id).startsWith("party_")) {
            room_profile_id2 = String(room_id).replace(/^party_/, "");
          }
          if (room_profile_id2) {
            const [roomUserRows2] = await conn.execute(
              `SELECT id FROM users WHERE profile_id = ? ORDER BY id DESC LIMIT 1`,
              [room_profile_id2]
            );
            if (roomUserRows2?.[0]?.id) {
              const tips_user_id = toInt(roomUserRows2[0].id);
              try {
                notifyTencent(tips_user_id, `${playerName} won ${coin} diamonds in ${gamesData[gId].name}`);
              } catch {}
            }
          }
        } catch {}
      }
    } else {
      return res.status(200).json({ code: 1, message: "Invalid Diff msg" });
    }

    // Response
    return res.status(200).json({
      code: 0,
      message: "succeed",
      unique_id: unique_id,
      data: { currency_balance: toInt(new_points) },
    });
  } catch (err) {
    return res.status(200).json({ code: 1, message: "Internal server error", error: err?.message });
  } finally {
    if (conn) conn.release();
  }
}