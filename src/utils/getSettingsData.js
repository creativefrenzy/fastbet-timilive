import pool from "../db.js";

/**
 * Fetch DAILY_CONTEST related settings from DB
 * @returns {Promise<{
 *  cargame_minbet_dailycontest: number,
 *  cargame_minbet_standard_dailycontest: number,
 *  cargame_maxbet_standard_dailycontest: number
 * }>}
 */
export async function getSettingsData() {
  let conn;

  try {
    conn = await pool.getConnection();

    const [rows] = await conn.execute(
      `
      SELECT setting_key, setting_value
        FROM settings
       WHERE setting_key IN (?, ?, ?, ?, ?)
      `,
      [
        "CARGAME_MINBET_DAILY_CONTEST",
        "CARGAME_MINBET_DAILY_STANDARD_CONTEST",
        "CARGAME_MAXBET_DAILY_STANDARD_CONTEST",
        "CARGAME_MINBET_DAILY_PRO_CONTEST",
        "CARGAME_MAXBET_DAILY_PRO_CONTEST"
      ]
    );

    // Defaults
    let cargame_minbet_dailycontest = 1;
    let cargame_minbet_standard_dailycontest = 1;
    let cargame_maxbet_standard_dailycontest = 1;
    let cargame_minbet_pro_dailycontest = 1;
    let cargame_maxbet_pro_dailycontest = 1;

    for (const r of rows) {
      const key = String(r.setting_key || "").trim();
      const val = parseInt(r.setting_value, 10);
      if (key === "CARGAME_MINBET_DAILY_CONTEST") {
        cargame_minbet_dailycontest = Number.isFinite(val) ? val : cargame_minbet_dailycontest;
      }
      if (key === "CARGAME_MINBET_DAILY_STANDARD_CONTEST") {
        cargame_minbet_standard_dailycontest = Number.isFinite(val) ? val : cargame_minbet_standard_dailycontest;
      }
      if (key === "CARGAME_MAXBET_DAILY_STANDARD_CONTEST") {
        cargame_maxbet_standard_dailycontest = Number.isFinite(val) ? val : cargame_maxbet_standard_dailycontest;
      }

      if (key === "CARGAME_MINBET_DAILY_PRO_CONTEST") {
        cargame_minbet_pro_dailycontest = Number.isFinite(val) ? val : cargame_minbet_pro_dailycontest;
      }
      if (key === "CARGAME_MAXBET_DAILY_PRO_CONTEST") {
        cargame_maxbet_pro_dailycontest = Number.isFinite(val) ? val : cargame_maxbet_pro_dailycontest;
      }
    }

    return {
      cargame_minbet_dailycontest,
      cargame_minbet_standard_dailycontest,
      cargame_maxbet_standard_dailycontest,
      cargame_minbet_pro_dailycontest,
      cargame_maxbet_pro_dailycontest,
    };
  } catch (err) {
    console.error("getSettingsData error:", err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}


export async function getSettingsEnabledData() {
  let conn;

  try {
    conn = await pool.getConnection();

    const [rows] = await conn.execute(
      `
      SELECT setting_key, setting_value
        FROM settings
       WHERE setting_key IN (?, ?, ?)
      `,
      [
        "cargame_global_domain_id",
        "cargame_global_enabled",
        "enabled_ai_speech_cargame_global",
      ]
    );

    // Defaults
    let cargame_global_domain_id = 3;
    let cargame_global_enabled = 1;
    let enabled_ai_speech_cargame_global = 0;

    for (const r of rows) {
      const key = String(r.setting_key || "").trim();
      const val = parseInt(r.setting_value, 10);
      if (key === "cargame_global_domain_id") {
        cargame_global_domain_id = Number.isFinite(val) ? val : cargame_global_domain_id;
      }
      if (key === "cargame_global_enabled") {
        cargame_global_enabled = Number.isFinite(val) ? val : cargame_global_enabled;
      }
      if (key === "enabled_ai_speech_cargame_global") {
        enabled_ai_speech_cargame_global = Number.isFinite(val) ? val : enabled_ai_speech_cargame_global;
      }
    }

    return {
      cargame_global_domain_id,
      cargame_global_enabled,
      enabled_ai_speech_cargame_global,
    };
  } catch (err) {
    console.error("getSettingsEnabledData error:", err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}
