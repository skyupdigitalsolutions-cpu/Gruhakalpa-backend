const express = require("express");
const router = express.Router();
const superAdminController = require("../controllers/Superadmincontroller");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/superadmin/login", superAdminController.loginSuperAdmin);
router.post("/superadmin/add", authMiddleware, superAdminController.addSuperAdmin);
router.get("/superadmins", authMiddleware, superAdminController.getAllSuperAdmins);
router.get("/superadmin/verify", superAdminController.verifyToken);

module.exports = router;