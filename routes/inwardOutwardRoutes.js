const express = require("express");
const router = express.Router();
const controller = require("../controllers/inwardOutwardController");
const authMiddleware = require("../middleware/authMiddleware");

// All register operations require an admin / superadmin token
router.post("/inwardoutward", authMiddleware, controller.createEntry);
router.get("/inwardoutward", authMiddleware, controller.getEntries);
router.put("/inwardoutward/:id", authMiddleware, controller.updateEntry);
router.delete("/inwardoutward/:id", authMiddleware, controller.deleteEntry);

module.exports = router;