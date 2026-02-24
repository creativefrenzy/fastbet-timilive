import { Router } from 'express';
import { handlePost } from '../controllers/handler.js';
import { getSSToken } from "../controllers/getSSToken.js";
import { updateSSToken } from "../controllers/updateSSToken.js";
import { updateBalance } from "../controllers/updateBalance.js";
import { getJoyUserInfo } from '../controllers/getJoyUserInfo.js';
import { joyUpdateBalance } from '../controllers/joyUpdateBalance.js';
import { carGameBet } from '../controllers/carGameBet.js';
import { carGameBetGlobal } from '../controllers/carGameBetGlobal.js';
import { handleWebhookWinner } from '../controllers/handleWebhookWinner.js';
import { handleAIAdvisorNotify } from '../controllers/handleAIAdvisorNotify.js';
import { handleCargameNotify } from '../controllers/handleCargameNotify.js';

const router = Router();

// // Baishun Game
// router.post('/getuserinfo', handlePost);
// router.post("/getsstoken", getSSToken);
// router.post("/updatesstoken", updateSSToken);
// router.post("/updatebalance", updateBalance);

// // Joy Game
// router.get('/joy/game/getUserInfo', getJoyUserInfo);
// router.post('/joy/game/submitFlow', joyUpdateBalance);

//cargame
router.get('/cargame/bet', carGameBet);
//cargame bet global
router.get('/cargame/bet-global', carGameBetGlobal);
router.post('/cargame/handle-webhook-winner', handleWebhookWinner);
router.post('/cargame/handle-ai-advisor-notify', handleAIAdvisorNotify);
router.post('/cargame/handle-win-notify', handleCargameNotify);

// Invalid JSON handler
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    res.set('Content-Type', 'application/json');
    return res.status(200).json({ code: 1, message: 'Invalid JSON data' });
  }
  next(err);
});

export default router;
