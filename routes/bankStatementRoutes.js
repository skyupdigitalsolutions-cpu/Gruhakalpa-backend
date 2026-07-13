const express = require("express");
const router = express.Router();
const controller = require("../controllers/bankStatementController");
const authMiddleware = require("../middleware/authMiddleware");

// All bank statement operations require an admin / superadmin token.
// (Members never hit these routes — the page is hidden from them on the frontend.)

// Opening balance (singleton). Defined BEFORE the "/:id" routes so that the
// literal path "opening" is never mistaken for a record id.
router.get("/bankstatement/opening", authMiddleware, controller.getOpeningBalance);
router.put("/bankstatement/opening", authMiddleware, controller.saveOpeningBalance);

router.post("/bankstatement", authMiddleware, controller.createEntry);
router.get("/bankstatement", authMiddleware, controller.getEntries);
router.put("/bankstatement/:id", authMiddleware, controller.updateEntry);
router.delete("/bankstatement/:id", authMiddleware, controller.deleteEntry);

module.exports = router;