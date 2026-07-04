const express = require("express");
const router = express.Router();
const siteBookingController = require("../controllers/siteBookingController");
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  "/sitebooking/cancel",
  authMiddleware,
  upload.single("cancellationPdf"),
  siteBookingController.cancelSiteBooking,
);

router.put("/sitebookings/:id", siteBookingController.updateSiteBookingById);
// Create site booking
router.post("/site-booking", siteBookingController.createSiteBooking);

// Get all site bookings
router.get("/sitebookings", siteBookingController.getAllSiteBookings);

// Update site booking
router.put("/update-sitebooking/:id", siteBookingController.updateSiteBooking);

module.exports = router;
