// src/config/gameFbConfig.js
import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("./google-services.json");

// ---- helper: init or reuse named app ----
function getOrInitApp(name, databaseURL) {
  const existing = admin.apps.find((a) => a.name === name);
  if (existing) return existing;

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    },
    name
  );
}

// ---- Init 2 separate Firebase RTDB apps ----
const zeepliveApp = getOrInitApp(
  "timilive-car-game",
  "https://timilive-car-game.asia-southeast1.firebasedatabase.app/"
);

const globalApp = getOrInitApp(
  "car-race-game-global",
  "https://car-race-game-global.asia-southeast1.firebasedatabase.app/"
);

// ---- Separate DB instances ----
const cargame_db = admin.database(zeepliveApp);
const cargame_global_db = admin.database(globalApp);

// ---- Read helpers ----
export async function getMainContestConfig() {
  try {
    const ref = cargame_db.ref("main-contest");
    const snap = await ref.once("value");
    return snap.val();
  } catch (err) {
    console.error("Firebase getMainContestConfig error:", err);
    return null;
  }
}

export async function getGlobalContestConfig() {
  try {
    const ref_global = cargame_global_db.ref("main-contest");
    const snap_global = await ref_global.once("value");
    return snap_global.val();
  } catch (err) {
    console.error("Firebase getGlobalContestConfig error:", err);
    return null;
  }
}
