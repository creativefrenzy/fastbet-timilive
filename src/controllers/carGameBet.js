import fs from "fs";
import path from "path";
import pool from "../db.js";
import { decryptRequest } from "../utils/cargameDecrypt.js";
import { getMainContestConfig } from "../config/gameFbConfig.js";
import { nowStrLocal, todayStrLocal } from '../utils/localDateTime.js';
import { getContestIDCount } from "../services/contestService.js";




const LOG_FILE = path.join(process.cwd(), "logs-cargame-bet.txt");

function nowStr() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}


async function runExtraStatsAsync({
  user_id,
  login_type,
  bet_coin,
  bet_date,
  isBetExists,
}) {
  if (login_type === "cargamebot") return;

  let bgConn;
  try {
    bgConn = await pool.getConnection();

    const gameId = 101;
    const game_count_increase = isBetExists === 0 ? 1 : 0;

    // cargame_current_day_spend
    const [updSpend] = await bgConn.execute(
      `UPDATE cargame_current_day_spend
          SET total_bet = total_bet + ?,
              game_count = game_count + ?,
              updated_at = ?
        WHERE user_id = ? AND game_id = ?`,
      [bet_coin, game_count_increase, bet_date, user_id, gameId]
    );

    if (updSpend.affectedRows === 0) {
      await bgConn.execute(
        `INSERT INTO cargame_current_day_spend
           (total_bet, user_id, game_id, created_at, updated_at, game_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bet_coin, user_id, gameId, bet_date, bet_date, game_count_increase]
      );
    }

    // cargame_current_day_spend_standard
    const [updSpendStandard] = await bgConn.execute(
      `UPDATE cargame_current_day_spend_standard
          SET total_bet = total_bet + ?,
              game_count = game_count + ?,
              updated_at = ?
        WHERE user_id = ? AND game_id = ?`,
      [bet_coin, game_count_increase, bet_date, user_id, gameId]
    );

    if (updSpendStandard.affectedRows === 0) {
      await bgConn.execute(
        `INSERT INTO cargame_current_day_spend_standard
           (total_bet, user_id, game_id, created_at, updated_at, game_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bet_coin, user_id, gameId, bet_date, bet_date, game_count_increase]
      );
    }

    // cargame_current_day_spend_pro
    const [updSpendPro] = await bgConn.execute(
      `UPDATE cargame_current_day_spend_pro
          SET total_bet = total_bet + ?,
              game_count = game_count + ?,
              updated_at = ?
        WHERE user_id = ? AND game_id = ?`,
      [bet_coin, game_count_increase, bet_date, user_id, gameId]
    );

    if (updSpendPro.affectedRows === 0) {
      await bgConn.execute(
        `INSERT INTO cargame_current_day_spend_pro
           (total_bet, user_id, game_id, created_at, updated_at, game_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bet_coin, user_id, gameId, bet_date, bet_date, game_count_increase]
      );
    }

    // user_energies
    const [updEnergy] = await bgConn.execute(
      `UPDATE user_energies
          SET total_return = total_return - ?, updated_at = ?
        WHERE user_id = ?`,
      [bet_coin, bet_date, user_id]
    );

    if (updEnergy.affectedRows === 0) {
      await bgConn.execute(
        `INSERT INTO user_energies
           (total_return, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [-bet_coin, user_id, bet_date, bet_date]
      );
    }

    // cargame_played_users
    const [playedRows] = await bgConn.execute(
      `SELECT id
         FROM cargame_played_users
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [user_id]
    );

    if (playedRows.length === 0) {
      await bgConn.execute(
        `INSERT INTO cargame_played_users
           (user_id, status, created_at, updated_at)
         VALUES (?, '1', ?, ?)`,
        [user_id, bet_date, bet_date]
      );
    }
  } catch (e) {
    // IMPORTANT: never throw here (don’t crash request)
    fs.appendFile(
      LOG_FILE,
      `\n${nowStr()} ExtraStatsErr: ${JSON.stringify({
        user_id,
        err: e?.message || String(e),
      })}`,
      () => {}
    );
  } finally {
    if (bgConn) bgConn.release();
  }
}


export async function carGameBet(req, res) {
  res.set("Content-Type", "application/json");

  // ── 1) Get encryptedData from body or query (like $_REQUEST) ───────────
  const encryptedData = req.body?.encryptedData ?? req.query?.encryptedData ?? "";

  if (!encryptedData) {
    const data = {
      status: false,
      message: "encryptedData field is required!",
    };
    fs.appendFile(LOG_FILE, `\n${nowStr()} ReqErr: ${JSON.stringify(data)}`, () => {});
    return res.json(data);
  }

  // ── 2) Decrypt and parse request ───────────────────────────────────────
  const reqData = decryptRequest(encryptedData);

  if (!reqData || Object.keys(reqData).length === 0) {
    const data = {
      status: false,
      message: "invalid request data required!",
    };
    fs.appendFile(LOG_FILE, `\n${nowStr()} ReqErr: ${JSON.stringify(data)}`, () => {});
    return res.json(data);
  }

  const now = nowStrLocal();

  // ── 3) Extract fields (similar to PHP) ─────────────────────────────────
  const user_id = reqData.user_id ? String(reqData.user_id) : "";
  const room_id = reqData.room_id ? String(reqData.room_id).trim() : "";
  let car1 = toInt(reqData.car1, 0);
  let car2 = toInt(reqData.car2, 0);
  let car3 = toInt(reqData.car3, 0);
  const contest_id = reqData.contest_id ? String(reqData.contest_id) : "";
  let party_seat_users = reqData.party_seat_users ? String(reqData.party_seat_users) : "";
  let group_id = reqData.group_id ? String(reqData.group_id) : "";

  const data = {};

  if (!user_id || !contest_id || (car1 <= 0 && car2 <= 0 && car3 <= 0)) {
    data.status = false;
    data.message = "Please Fill All The Fields";
    // fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
    return res.json(data);
  }

  // Negative bet check
  if (car1 < 0 || car2 < 0 || car3 < 0) {
    data.status = false;
    data.message = "Negative value bet";
    // fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
    return res.json(data);
  }

  const contestIDCount = await getContestIDCount(contest_id);
  // console.log("contest_id:", contest_id);

  if (contestIDCount > 1) {
      data.status = false;
      data.message = "Invalid contest";
      fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: Repeated Bet}`, () => {});
      return res.json(data);
    }

  const bet_date = nowStrLocal();//nowStr();
  let conn;

  try {
    conn = await pool.getConnection();

    // ── 4) Check user wallet + login_type ────────────────────────────────
    const [userRows] = await conn.execute(
      `SELECT id, login_type, points, redeem_point
         FROM users
        WHERE id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [user_id]
    );
    const user = userRows[0] || null;
    let total_coin = user ? toInt(user.points) : 0;
    const login_type = user ? String(user.login_type || "") : "";

    // ── 5) Mic join feature deduction ───────────────────────────────────
    let mic_join_coin = 0;
    // const [micRows] = await conn.execute(
    //   `SELECT id, caller_id, start_time, end_time, duration, call_rate, created_at
    //      FROM mic_join_details
    //     WHERE caller_id = ?
    //     ORDER BY id DESC
    //     LIMIT 1`,
    //   [user_id]
    // );
    // const mic = micRows[0] || null;
    // if (mic && !mic.end_time) {
    //   const end_duration = Date.now(); // ms
    //   const cal_duration = (end_duration - Number(mic.start_time || 0)) / 1000 / 60;
    //   const duration = Math.ceil(cal_duration);
    //   mic_join_coin = Math.ceil(Number(mic.call_rate || 0) * duration);
    // }
    total_coin -= mic_join_coin;

    // ── 6) Compute bet_coin + bet_inner_qry (like PHP string) ───────────
    let bet_coin = 0;
    let bet_inner_qry = "";

    if (car1 > 0 || car2 > 0 || car3 > 0) {
      bet_coin += car1 + car2 + car3;

      // we don't need manual escape because we use bind params in real INSERT,
      // but to keep the same columns we just remember raw numbers
      bet_inner_qry += `, car1 = ${car1}, car2 = ${car2}, car3 = ${car3}`;
    }

    if (bet_coin <= 0) {
      data.status = false;
      data.message = "Bet coin too low";
      // fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
      return res.json(data);
    }

    if (total_coin < bet_coin) {
      data.status = false;
      data.message = "Balance too low 1";
      // fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
      return res.json(data);
    }

    if (room_id) {
      bet_inner_qry += `, room_id = ${conn.escape(room_id)}`;
    }

    // if (party_seat_users) {
    //   let partySeatArray = party_seat_users.split(",").map((x) => String(x).trim()).filter(Boolean);
    //   if (room_id) {
    //     partySeatArray = partySeatArray.filter((x) => x !== room_id);
    //   }
    //   if (partySeatArray.length) {
    //     party_seat_users = [...new Set(partySeatArray)].join(",");
    //     bet_inner_qry += `, party_seat_users = ${conn.escape(party_seat_users)}`;
    //   }
    // }
    // ✅ Ensure party_seat_users never contains room_id
    if (party_seat_users) {
      const cleanRoomId = room_id ? String(room_id).trim() : "";

      let partySeatArray = String(party_seat_users)
        .split(",")
        .map(x => String(x).trim())
        .filter(Boolean);

      // ✅ Remove room_id from list (even if duplicates)
      if (cleanRoomId) {
        partySeatArray = partySeatArray.filter(x => x !== cleanRoomId);
      }

      // ✅ Remove duplicates
      partySeatArray = [...new Set(partySeatArray)];

      // ✅ Final value (can become "")
      party_seat_users = partySeatArray.join(",");

      // ✅ Always update DB, even if empty
      bet_inner_qry += `, party_seat_users = ${conn.escape(party_seat_users)}`;
    }


    if (group_id) {
      const groupArray = group_id.split(",").map((x) => String(x).trim()).filter(Boolean);
      if (groupArray.length) {
        group_id = [...new Set(groupArray)].join(",");
        bet_inner_qry += `, group_id = ${conn.escape(group_id)}`;
      }
    }

    // ── 7) Firebase check main-contest status ───────────────────────────
    const fetchDataChk = await getMainContestConfig();
    if (
      !fetchDataChk ||
      fetchDataChk.status !== "open" ||
      String(fetchDataChk.contestid) !== contest_id
    ) {
      data.status = false;
      data.message = "No More bet";
      // data.contestid_db = contest_id;
      // data.contestid = fetchDataChk?.contestid ?? null;
      // data.fetchDataChk_status = fetchDataChk?.status ?? null;
    //   fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
      return res.json(data);
    }

    // ── 8) Insert/update cargame_bet ────────────────────────────────────
    let isBetExists = 0;
    const [betExistsRows] = await conn.execute(
      `SELECT id
         FROM cargame_bet
        WHERE user_id = ? AND contestid = ?
        ORDER BY id DESC
        LIMIT 1`,
      [user_id, contest_id]
    );

    if (betExistsRows.length > 0) {
      isBetExists = 1;
      const car1_coin = car1;
      const car2_coin = car2;
      const car3_coin = car3;

      const updateBetSql = `
        UPDATE cargame_bet
           SET car1 = car1 + ?,
               car2 = car2 + ?,
               car3 = car3 + ?,
               total_bet = total_bet + ?,
               updated_at = ?
         WHERE user_id = ? AND contestid = ?
      `;
      await conn.execute(updateBetSql, [
        car1_coin,
        car2_coin,
        car3_coin,
        bet_coin,
        bet_date,
        user_id,
        contest_id,
      ]);
    } else {
      const insertBetSql = `
        INSERT INTO cargame_bet
          (user_id, contestid, total_bet, created_at, updated_at${bet_inner_qry ? "," + bet_inner_qry.replace(/,\s*/g, ", ").replace(/=/g, " =") : ""})
        VALUES (?, ?, ?, ?, ? ${""})
      `;
      // Because bet_inner_qry already embeds values, cleaner is to build a proper param-based INSERT.
      // To keep close to PHP, we'll do dynamic SQL building:

      let columns = ["user_id", "contestid", "total_bet", "created_at", "updated_at"];
      let placeholders = ["?", "?", "?", "?", "?"];
      const params = [user_id, contest_id, bet_coin, bet_date, bet_date];

      if (car1 > 0 || car2 > 0 || car3 > 0) {
        columns.push("car1", "car2", "car3");
        placeholders.push("?", "?", "?");
        params.push(car1, car2, car3);
      }
      if (room_id) {
        columns.push("room_id");
        placeholders.push("?");
        params.push(room_id);
      }
      if (party_seat_users) {
        columns.push("party_seat_users");
        placeholders.push("?");
        params.push(party_seat_users);
      }
      if (group_id) {
        columns.push("group_id");
        placeholders.push("?");
        params.push(group_id);
      }

      const sqlInsertBet = `
        INSERT INTO cargame_bet
          (${columns.join(", ")})
        VALUES (${placeholders.join(", ")})
      `;

      await conn.execute(sqlInsertBet, params);
    }

    // ── 9) Wallet debit & stats (only if enough balance) ────────────────
    // Reload wallet (like PHP)
    const [userRows2] = await conn.execute(
      `SELECT id, points, redeem_point
         FROM users
        WHERE id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [user_id]
    );
    const user2 = userRows2[0] || null;
    let balpoints = user2 ? toInt(user2.points) : 0;
    let balredeem_point = user2 ? toInt(user2.redeem_point) : 0;

    if (balpoints < bet_coin) {
      data.status = false;
      data.message = "Balance too low";
      // fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
      return res.json(data);
    }

    const new_points = balpoints ? balpoints - bet_coin : bet_coin;

    // wallets insert
    await conn.execute(
      `INSERT INTO wallets
         (user_id, debit, points, redeem_point, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 54, ?, ?)`,
      [user_id, bet_coin, new_points, balredeem_point, bet_date, bet_date]
    );

    // users main update
    await conn.execute(
      `UPDATE users
          SET points = points - ?
        WHERE id = ?`,
      [bet_coin, user_id]
    );

    // Extra stats (if not cargamebot)
    if (login_type !== "cargamebot") {
      // ✅ Fire-and-forget background stats (no await)
      setImmediate(() => {
        runExtraStatsAsync({
          user_id,
          login_type,
          bet_coin,
          bet_date,
          isBetExists,
        });
      });

      // const gameId = 101;
      // const game_count_increase = isBetExists === 0 ? 1 : 0;

      // // cargame_current_day_spend upsert-ish
      // const updateSpendSql = `
      //   UPDATE cargame_current_day_spend
      //      SET total_bet = total_bet + ?,
      //          game_count = game_count + ?,
      //          updated_at = ?
      //    WHERE user_id = ? AND game_id = ?
      // `;
      // const [updSpend] = await conn.execute(updateSpendSql, [
      //   bet_coin,
      //   game_count_increase,
      //   bet_date,
      //   user_id,
      //   gameId,
      // ]);
      // if (updSpend.affectedRows === 0) {
      //   await conn.execute(
      //     `INSERT INTO cargame_current_day_spend
      //        (total_bet, user_id, game_id, created_at, updated_at, game_count)
      //      VALUES (?, ?, ?, ?, ?, ?)`,
      //     [bet_coin, user_id, gameId, bet_date, bet_date, game_count_increase]
      //   );
      // }

      // // cargame_current_day_spend_standard upsert-ish
      // const updateSpendSqlStandard = `
      //   UPDATE cargame_current_day_spend_standard
      //      SET total_bet = total_bet + ?,
      //          game_count = game_count + ?,
      //          updated_at = ?
      //    WHERE user_id = ? AND game_id = ?
      // `;
      // const [updSpendStandard] = await conn.execute(updateSpendSqlStandard, [
      //   bet_coin,
      //   game_count_increase,
      //   bet_date,
      //   user_id,
      //   gameId,
      // ]);
      // if (updSpendStandard.affectedRows === 0) {
      //   await conn.execute(
      //     `INSERT INTO cargame_current_day_spend_standard
      //        (total_bet, user_id, game_id, created_at, updated_at, game_count)
      //      VALUES (?, ?, ?, ?, ?, ?)`,
      //     [bet_coin, user_id, gameId, bet_date, bet_date, game_count_increase]
      //   );
      // }

      // // user_energies
      // const [updEnergy] = await conn.execute(
      //   `UPDATE user_energies
      //       SET total_return = total_return - ?, updated_at = ?
      //     WHERE user_id = ?`,
      //   [bet_coin, bet_date, user_id]
      // );
      // if (updEnergy.affectedRows === 0) {
      //   await conn.execute(
      //     `INSERT INTO user_energies
      //        (total_return, user_id, created_at, updated_at)
      //      VALUES (?, ?, ?, ?)`,
      //     [-bet_coin, user_id, bet_date, bet_date]
      //   );
      // }

      // // cargame_played_users
      // const [playedRows] = await conn.execute(
      //   `SELECT id FROM cargame_played_users WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      //   [user_id]
      // );
      // if (playedRows.length === 0) {
      //   await conn.execute(
      //     `INSERT INTO cargame_played_users
      //        (user_id, status, created_at, updated_at)
      //      VALUES (?, '1', ?, ?)`,
      //     [user_id, bet_date, bet_date]
      //   );
      // }
    }

    // ── 10) Final response ──────────────────────────────────────────────
    data.status = true;
    data.message = "Betting added successfully !!";
    data.new_points = new_points;
    if (String(user_id) === "34299024") {
      data.reqData = reqData;
      data.encryptedData = encryptedData;
      fs.appendFile(LOG_FILE, `\n${nowStr()} Resp: ${JSON.stringify(data)}`, () => {});
    }

    
    return res.json(data);
  } catch (err) {
    console.error("carGameBet error:", err);
    const out = {
      status: false,
      message: "Internal server error",
      error: err.message,
    };
    fs.appendFile(LOG_FILE, `\n${nowStr()} RespErr: ${JSON.stringify(out)}`, () => {});
    return res.json(out);
  } finally {
    if (conn) conn.release();
  }
}
