const express = require("express");
const router = express.Router();
const festival = require("../controllers/festivalController");

// List all festivals (seeds the catalog on first call)
router.get("/festivals", festival.listFestivals);

// Update a festival's template / date / enabled flag
router.put("/festivals/:key", festival.updateFestival);

// Upload this year's image for a festival (base64 in body)
router.post("/festivals/:key/image", festival.uploadFestivalImage);

// Send a festival greeting to one number for preview
router.post("/festivals/:key/test", festival.testFestival);

// Daily due-festival check (also called by the scheduler); use ?secret=CRON_SECRET
router.post("/festivals/run-due", (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ success: false, message: "Bad secret" });
  }
  return festival.runDueFestivalsEndpoint(req, res, next);
});

module.exports = router;