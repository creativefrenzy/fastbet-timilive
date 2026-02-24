// /src/controllers/handleWebhookWinner.js
import crypto from "crypto";
import pool from "../db.js";
import { notifyTencent } from "../utils/notify.js";
import { nowStrLocal } from "../utils/localDateTime.js";
import { updateRichLevel } from "../utils/updateRichLevel.js";
import { getSettingsData } from "../utils/getSettingsData.js";

const secret = process.env.GLOBAL_BET_SECRET || "";

const settings = await getSettingsData();

const {
  cargame_minbet_dailycontest,
  cargame_minbet_standard_dailycontest,
  cargame_maxbet_standard_dailycontest,
  cargame_minbet_pro_dailycontest,
  cargame_maxbet_pro_dailycontest,
} = settings;

// helper
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

function todayStrIST() {
  // YYYYMMDD in Asia/Kolkata
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}${m}${d}`;
}

const todayStr = todayStrIST();

function makeSignature(secret, domainId, eventId, ts, payloadStr) {
  // must match Python:
  // f"{domain_id}.{event_id}.{ts}.{payload_json_string}"
  const msg = `${domainId}.${eventId}.${ts}.${payloadStr}`;
  return crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}

// Helper function to update rich level outside of transaction
async function updateRichLevelSafe(userId) {
  try {
    await updateRichLevel(userId);
  } catch (err) {
    // Log error but don't fail the transaction
    console.error(`updateRichLevel failed for user ${userId}:`, err.message);
  }
}

export async function handleWebhookWinner(req, res) {
  res.set("Content-Type", "application/json");

  const eventId = req.header("X-Event-Id");
  const domainIdH = req.header("X-Domain-Id");
  const ts = req.header("X-Timestamp");
  const sig = req.header("X-Signature");
  const currDate = nowStrLocal();

  if (!eventId || !domainIdH || !ts || !sig) {
    return res.status(400).json({ code: 1, msg: "Missing required headers" });
  }

  // For now, use stable stringify:
  let payloadStr;
  try {
    payloadStr = JSON.stringify(req.body);
  } catch {
    return res.status(400).json({ code: 1, msg: "Invalid JSON body" });
  }

  const domainId = toInt(domainIdH);
  const eventIdInt = toInt(eventId);
  const game_id = 101;

  let conn;
  let transactionCommitted = false;
  const usersToUpdateRichLevel = []; // Store user IDs for post-transaction processing

  try {
    conn = await pool.getConnection();

    const expected = makeSignature(secret, domainId, eventIdInt, ts, payloadStr);
    if (expected !== String(sig)) {
      console.log("Invalid signature");
      // return res.status(401).json({ code: 1, msg: "Invalid signature" });
    }

    const betId = toInt(req.body.bet_id);
    const userId = toInt(req.body.user_id);
    const contestId = String(req.body.contest_id || "");

    if (!betId || !userId || !contestId) {
      return res
        .status(400)
        .json({ code: 1, msg: "Missing bet_id/user_id/contest_id" });
    }

    // ---- BASIC ----
    const roomId = String(req.body.room_id || "");
    const partySeatUsersStr = String(req.body.party_seat_users || "");
    const winningColumn = String(req.body.winning_column || "");
    const winningCar = String(req.body.winning_car || "");

    // ---- BET DATA ----
    const bet = req.body.bet || {};
    const totalBet = toInt(bet.total_bet);
    const car1Bet = toInt(bet.car1);
    const car2Bet = toInt(bet.car2);
    const car3Bet = toInt(bet.car3);

    // ---- PAYOUT DATA ----
    const payout = req.body.payout || {};
    const totalWon = toInt(payout.total_won);
    const profit = toInt(payout.profit) > 0 ? 1 : 0;
    const avgShare = toInt(payout.avg_share || 0);
    const companyWalletShare = toInt(payout.company_wallet_share || 0);

    // ---- DERIVED ----
    const systemShare = toInt(payout.system_share || 0);

    // ---- CAR NAMES ----
    const car1Name = String(req.body.car1_name || "");
    const car2Name = String(req.body.car2_name || "");
    const car3Name = String(req.body.car3_name || "");

    await conn.beginTransaction();
    try {
      // 1) Update bet row (winner) with simplified query
      const [betUpd] = await conn.execute(
        `
        UPDATE cargame_bet_global
           SET total_won = ?,
               winning = ?,
               profit = ?,
               tips = ?,
               system_share = ?,
               company_wallet_share = ?,
               car1_name = ?,
               car2_name = ?,
               car3_name = ?,
               winning_car = ?,
               status = 2,
               updated_at = ?
         WHERE contestid = ? AND user_id = ? AND status != 2
        `,
        [
          totalWon,
          winningColumn,
          profit,
          avgShare,
          systemShare,
          companyWalletShare,
          car1Name,
          car2Name,
          car3Name,
          winningCar,
          currDate,
          contestId,
          userId,
        ]
      );

      if (!betUpd || betUpd.affectedRows === 0) {
        // Check if already processed
        const [checkRows] = await conn.execute(
          `SELECT status FROM cargame_bet_global WHERE contestid = ? AND user_id = ? LIMIT 1`,
          [contestId, userId]
        );
        
        if (checkRows?.[0]?.status === 2) {
          await conn.rollback();
          return res.status(200).json({ code: 0, msg: "already processed" });
        }
        throw new Error(
          `cargame_bet_global not updated id=${betId} contestid=${contestId} user_id=${userId}`
        );
      }

      // 2) Fetch winner without FOR UPDATE (reduces lock contention)
      const [uRows] = await conn.execute(
        `SELECT id, name, login_type, points, redeem_point
           FROM users
          WHERE id = ?`,
        [userId]
      );

      if (!uRows?.length) {
        throw new Error("Winner user not found");
      }

      const winner = uRows[0];
      const loginType = String(winner.login_type || "");
      const playerName = winner.name || "";
      let privateroom_group_id = "";

      // 3) Credit winner if not cargamebot
      if (loginType !== "cargamebot") {
        if (loginType === "luckygiftbot") {
          let luckygiftbot_withdrawal_amount = 0;
          if (totalWon > totalBet) {
            luckygiftbot_withdrawal_amount = totalWon - totalBet;
          }
          const luckygiftbot_person_won =
            totalWon - luckygiftbot_withdrawal_amount;

          await conn.execute(
            `UPDATE users SET points = points + ? WHERE id = ?`,
            [luckygiftbot_person_won, userId]
          );

          if (luckygiftbot_withdrawal_amount > 0) {
            await conn.execute(
              `UPDATE users_luckygiftbots
                  SET withdrawal_amount = withdrawal_amount + ?,
                      withdrawal_redeem_amount = withdrawal_redeem_amount + ?
                WHERE bot_user_id = ?`,
              [luckygiftbot_person_won, luckygiftbot_person_won, userId]
            );
          }
        } else {
          try {
            // wallets insert (credit) status 55
            await conn.execute(
              `INSERT INTO wallets
                (user_id, credit, points, redeem_point, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 55, ?, ?)`,
              [userId, totalWon, 0, 0, currDate, currDate]
            );

            await conn.execute(
              `UPDATE users SET points = points + ? WHERE id = ?`,
              [totalWon, userId]
            );
          } catch (e) {
            if (String(e?.code) === "ER_DUP_ENTRY") {
              await conn.rollback();
              return res.status(200).json({ code: 0, msg: "already processed" });
            }
            throw e;
          }
        }

        // user_energies
        const [updEnergy] = await conn.execute(
          `UPDATE user_energies
              SET total_return = total_return + ?, updated_at = ?
            WHERE user_id = ?`,
          [totalWon, currDate, userId]
        );

        if (updEnergy.affectedRows === 0) {
          await conn.execute(
            `INSERT INTO user_energies
               (total_return, user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
            [totalWon, userId, currDate, currDate]
          );
        }

        // 4) Company game wallet share
        if (companyWalletShare > 0) {
          await conn.execute(
            `UPDATE company_game_wallets
                SET balance = balance + ?,
                    total_credit = total_credit + ?
              LIMIT 1`,
            [companyWalletShare, companyWalletShare]
          );

          await conn.execute(
            `
            INSERT INTO company_game_wallet_histories
              (domain_id, game_id, game_name, credit, day, created_at, updated_at)
            VALUES
              (?, ?, 'car game', ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              credit = credit + VALUES(credit),
              updated_at = VALUES(updated_at)
            `,
            [domainId, game_id, companyWalletShare, todayStr, currDate, currDate]
          );
        }
      }

      // 5) Tips distribution (room owner + party seats)
      if (roomId && avgShare >= 1) {
        // room owner
        const [hostRows] = await conn.execute(
          `SELECT id, points, redeem_point, group_id
             FROM users
            WHERE profile_id = ?
            ORDER BY id DESC
            LIMIT 1`,
          [roomId]
        );

        const host = hostRows?.[0] || null;

        if (host) {
          const hostId = toInt(host.id);
          const hostPoints = toInt(host.points);
          const hostRedeem = toInt(host.redeem_point);
          privateroom_group_id = host.group_id || "";

          const hostPointsTotal = hostPoints + avgShare;
          const hostRedeemTotal = hostRedeem + avgShare;

          await conn.execute(
            `INSERT INTO wallets
              (user_id, call_receiver_id, credit, points, redeem_point, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 83, ?, ?)`,
            [hostId, userId, avgShare, hostPointsTotal, hostRedeemTotal, currDate, currDate]
          );

          // Simplified: update points without wallet history for now
          await conn.execute(
            `UPDATE users
                SET points = points + ?, redeem_point = redeem_point + ?
              WHERE id = ?`,
            [avgShare, avgShare, hostId]
          );


          // Notify host group best-effort
          try {
            // const group_id = host.group_id;
            if (privateroom_group_id) {
              const msg = `In Car Game get tips ${avgShare} by ${playerName}`;
              notifyTencent(hostId, msg);
            }
          } catch {}
          
        }

        // party seat users
        const partySeats = partySeatUsersStr
          ? partySeatUsersStr.split(",").map((s) => s.trim()).filter(Boolean)
          : [];

        for (const profileId of partySeats) {
          const [psRows] = await conn.execute(
            `SELECT id, points, redeem_point
               FROM users
              WHERE profile_id = ?
              ORDER BY id DESC
              LIMIT 1`,
            [profileId]
          );

          const ps = psRows?.[0] || null;
          if (!ps) continue;

          const psId = toInt(ps.id);
          const psPoints = toInt(ps.points);
          const psRedeem = toInt(ps.redeem_point);

          const psPointsTotal = psPoints + avgShare;
          const psRedeemTotal = psRedeem + avgShare;

          await conn.execute(
            `INSERT INTO wallets
              (user_id, call_receiver_id, credit, points, redeem_point, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 83, ?, ?)`,
            [psId, userId, avgShare, psPointsTotal, psRedeemTotal, currDate, currDate]
          );

          await conn.execute(
            `UPDATE users
                SET points = points + ?, redeem_point = redeem_point + ?
              WHERE id = ?`,
            [avgShare, avgShare, psId]
          );

          // Schedule rich level update for later
          usersToUpdateRichLevel.push(psId);
        }
      }

      // 6) daily spend tables
      if (loginType !== "cargamebot") {
        if (totalBet > cargame_minbet_dailycontest) {
          await conn.execute(
            `UPDATE cargame_current_day_spend
                SET total_won = total_won + ?, profit_count = profit_count + ?, updated_at = ?
              WHERE user_id = ? AND game_id = ?`,
            [totalWon, profit, currDate, userId, game_id]
          );
        }

        if (
          totalBet > cargame_minbet_standard_dailycontest &&
          totalBet <= cargame_maxbet_standard_dailycontest
        ) {
          await conn.execute(
            `UPDATE cargame_current_day_spend_standard
                SET total_won = total_won + ?, profit_count = profit_count + ?, updated_at = ?
              WHERE user_id = ? AND game_id = ?`,
            [totalWon, profit, currDate, userId, game_id]
          );
        }

        // if (
        //   totalBet > cargame_minbet_pro_dailycontest &&
        //   totalBet <= cargame_maxbet_pro_dailycontest
        // ) {
        //   await conn.execute(
        //     `UPDATE cargame_current_day_spend_pro
        //         SET total_won = total_won + ?, profit_count = profit_count + ?, updated_at = ?
        //       WHERE user_id = ? AND game_id = ?`,
        //     [totalWon, profit, currDate, userId, game_id]
        //   );
        // }

        // winner win-notification best-effort
        try {
          const [hostRows2] = await conn.execute(
            `SELECT id, group_id FROM users WHERE profile_id = ? LIMIT 1`,
            [roomId]
          );
          const groupId2 = hostRows2?.[0]?.group_id;
          if (groupId2 && hostRows2?.[0]?.id) {
            const tips_user_id2 = toInt(hostRows2[0].id);
            const msg1 = `${playerName} won ${totalWon} diamonds in Car Race Game`;
            notifyTencent(tips_user_id2, msg1);
          }
        } catch {}

        // queue notification to cron (best-effort)
        try {
          if (totalWon > 3000 && privateroom_group_id) {
            const message_for_cron = `${playerName} won ${totalWon} diamonds in Car Race Game`;
            await conn.execute(
              `INSERT INTO send_notifi_tencent_grps
                (game_id, game_name, room_group_id, message, user_id, coin, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [game_id, "car race", privateroom_group_id, message_for_cron, userId, totalWon, currDate]
            );
          }
        } catch {}
      }

      await conn.commit();
      transactionCommitted = true;
      
      // 7) Now process rich level updates outside of transaction
      for (const uid of usersToUpdateRichLevel) {
        await updateRichLevelSafe(uid);
      }

      return res.status(200).json({ code: 0, msg: "ok" });
    } catch (err) {
      if (!transactionCommitted) {
        await conn.rollback();
      }
      throw err;
    }
  } catch (err) {
    console.error("handleWebhookWinner error:", err);
    return res.status(500).json({
      code: 1,
      msg: "Internal server error",
      error: err?.message || String(err),
    });
  } finally {
    if (conn) conn.release();
  }
}