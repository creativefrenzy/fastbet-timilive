// services/contestService.js
import pool from "../db.js";

export async function getContestIDCount(contestid) {
  const sql = `
    SELECT COUNT(*) AS total
    FROM cargame_contest_record
    WHERE contestid = ?
  `;
  const [rows] = await pool.query(sql, [contestid]);

  return rows[0].total;
}
