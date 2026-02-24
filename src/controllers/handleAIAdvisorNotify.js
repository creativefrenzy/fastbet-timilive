// /src/controllers/handleAIAdvisorNotify.js
import crypto from "crypto";
import fetch from "node-fetch";
// import TLSSigAPIv2 from "tls-sig-api-v2";
// import tlsSigPkg from "tls-sig-api-v2";
import { createTlsSigner } from "../utils/createTlsSigner.js";
import { getSettingsEnabledData } from "../utils/getSettingsData.js";
import pool from "../db.js";

const secret = process.env.GLOBAL_BET_SECRET || "";
const settings = await getSettingsEnabledData();

const {
  cargame_global_domain_id,
  cargame_global_enabled,
  enabled_ai_speech_cargame_global
} = settings;

// Tencent IM
// const TLSSigAPIv2 = tlsSigPkg.TLSSigAPIv2 || tlsSigPkg.default?.TLSSigAPIv2;
const SDK_APPID = Number(process.env.TENCENT_SDK_APPID || "0");
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || "";
// const SIGN_USER_ID = process.env.TENCENT_SIGN_USER_ID || "administrator";
const SIGN_USER_ID = "administrator";

const tls = createTlsSigner(SDK_APPID, SECRET_KEY);

// helper
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

function makeSignature(secret, domainId, eventId, ts, payloadStr) {
  const msg = `${domainId}.${eventId}.${ts}.${payloadStr}`;
  return crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}

// ---------------- Tencent IM send_group_msg ----------------
async function sendGroupMessage(hostGroupId, userdetailsArr) {
  const url = "https://adminapiind.im.qcloud.com/v4/group_open_http_svc/send_group_msg";

  const randNo = Math.floor(Math.random() * (99999999 - 10000000 + 1)) + 10000000;
  const timeStamp = Date.now(); // ms like python
  const groupType = "ai_gameadvisor";

  // usersig expire in seconds
  const usersig = tls.genUserSig(SIGN_USER_ID, 86400);

  const contentdata = {
    type: groupType,
    message: JSON.stringify(userdetailsArr),
    group_user_name: "Admin",
    from: String(hostGroupId),
    fromName: "Streamers Broadcast",
    fromImage: "https://zeeplive.blr1.digitaloceanspaces.com/zeepliveFileResource/1717565665.webp",
    time_stamp: String(timeStamp),
  };

  const bodyObj = {
    GroupId: String(hostGroupId),
    Random: randNo,
    MsgBody: [
      {
        MsgType: "TIMTextElem",
        MsgContent: { Text: JSON.stringify(contentdata) },
      },
    ],
  };

  const query = new URLSearchParams({
    sdkappid: String(SDK_APPID),
    identifier: String(SIGN_USER_ID),
    usersig: String(usersig),
    random: String(randNo),
    contenttype: "json",
  });

  const fullUrl = `${url}?${query.toString()}`;

  // --- timeout wrapper (like axios timeout) ---
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });

    const text = await resp.text();
    return { hostGroupId, status: resp.status, text };
  } finally {
    clearTimeout(t);
  }
}

// ---------------- DB lookup like python ----------------
async function sendNotificationDirect(message) {
  const rowId = 1; // hardcoded row_id = 1
  const msg = String(message || "").trim();
  if (!msg) return false;

  let conn;
  try {
    conn = await pool.getConnection();

    const sql = `
      SELECT
        owner_id         AS id,
        owner_profile_id  AS profile_id,
        name,
        pic           AS profile_image,
        800.0                  AS call_rate,
        level     AS charm_level,
        level      AS rich_level,
        'ai'          AS gender,
        4                     AS status,
        'aigameparty'         AS roomType,
        group_id
      FROM party_rooms
      WHERE group_id IS NOT NULL AND id = ?
      ORDER BY id ASC
      LIMIT 1
    `;

    const [rows] = await conn.execute(sql, [rowId]);
    const host = rows?.[0];

    if (!host?.group_id) return false;

    const payload = { msg }; // python: payload={"msg": message}
    await sendGroupMessage(host.group_id, payload);
    return true;
  } finally {
    if (conn) conn.release();
  }
}

export async function handleAIAdvisorNotify(req, res) {
  res.set("Content-Type", "application/json");

  const eventId = req.header("X-Event-Id");
  const domainIdH = req.header("X-Domain-Id");
  const ts = req.header("X-Timestamp");
  const sig = req.header("X-Signature");

  if (!eventId || !domainIdH || !ts || !sig) {
    return res.status(400).json({ code: 1, msg: "Missing required headers" });
  }

  // stable stringify (must match python canonical JSON)
  let payloadStr;
  try {
    payloadStr = JSON.stringify(req.body);
  } catch {
    return res.status(400).json({ code: 1, msg: "Invalid JSON body" });
  }

  const domainId = toInt(domainIdH);
  const eventIdInt = toInt(eventId);

  try {
    const expected = makeSignature(secret, domainId, eventIdInt, ts, payloadStr);
    if (expected !== String(sig)) {
        console.error("AIAdvisorNotify Invalid signature");
      return res.status(401).json({ code: 1, msg: "Invalid signature" });
    }

    const message = String(req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ code: 1, msg: "Missing message" });
    }

    // ✅ respond immediately
    res.status(200).json({ code: 0, msg: "ok" });

    if(cargame_global_enabled == 1 && enabled_ai_speech_cargame_global == 1){
      // async send (fire-and-forget)
      sendNotificationDirect(message).catch((e) => {
        console.error("AIAdvisorNotify sendNotificationDirect error:", e?.message || e);
      });
    }


  } catch (err) {
    return res.status(500).json({
      code: 1,
      msg: "Internal server error",
      error: err?.message || String(err),
    });
  }
}
