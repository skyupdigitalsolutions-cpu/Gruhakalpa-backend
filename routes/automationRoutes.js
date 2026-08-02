const express = require("express");
const router = express.Router();
const c = require("../controllers/festivalController");

// Public: separate automation login
router.post("/automation/login", c.automationLogin);

// Protected below — require the automation token
router.get("/automation/templates", c.requireAutomationAuth, c.getTemplates);
router.get("/automation/staff", c.requireAutomationAuth, c.getStaffTemplate);
router.get("/automation/master", c.requireAutomationAuth, c.getMaster);
router.put("/automation/master", c.requireAutomationAuth, c.setMaster);
router.get("/automation/upcoming", c.requireAutomationAuth, c.getUpcoming);
router.post("/automation/test-staff", c.requireAutomationAuth, c.testStaffReminder);
router.post("/automation/templates/:templateName/image", c.requireAutomationAuth, c.uploadImage);
router.put("/automation/templates-toggle-all", c.requireAutomationAuth, c.toggleAllTemplates);
router.put("/automation/templates/:templateName", c.requireAutomationAuth, c.updateTemplate);
router.post("/automation/templates/:templateName/test", c.requireAutomationAuth, c.testSend);

// Daily due-check (scheduler / external cron). Secret-gated, no login needed.
router.post("/automation/run-due", (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret)
    return res.status(403).json({ success: false, message: "Bad secret" });
  return c.runDueEndpoint(req, res, next);
});

module.exports = router;