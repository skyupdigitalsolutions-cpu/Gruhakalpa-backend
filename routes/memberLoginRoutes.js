const express = require("express");
const router = express.Router();
const memberLoginController = require("../controllers/memberLoginController");

// Public — member login (username = seniority_no, password = mobile)
router.post("/member/login", memberLoginController.loginMember);

module.exports = router;