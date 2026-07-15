const express = require("express");
const router = express.Router();
const fd = require("../controllers/fixedDepositController");
const rd = require("../controllers/recurringDepositController");

// ── Fixed Deposit ──
router.post("/fixed-deposit", fd.createFixedDeposit);
router.get("/fixed-deposits", fd.getAllFixedDeposits);
router.get("/fixed-deposits/:id", fd.getFixedDepositById);
router.put("/fixed-deposits/:id", fd.updateFixedDeposit);
router.put("/fixed-deposits/:id/cancel", fd.cancelFixedDeposit);
router.put("/fixed-deposits/:id/certificate", fd.saveCertificate);
router.get("/fixed-deposits/:id/certificate/download", fd.downloadCertificate);

// ── Recurring Deposit ──
router.post("/recurring-deposit", rd.createRecurringDeposit);
router.get("/recurring-deposits", rd.getAllRecurringDeposits);
router.get("/recurring-deposits/:id", rd.getRecurringDepositById);
router.put("/recurring-deposits/:id", rd.updateRecurringDeposit);
router.put("/recurring-deposits/:id/cancel", rd.cancelRecurringDeposit);

module.exports = router;