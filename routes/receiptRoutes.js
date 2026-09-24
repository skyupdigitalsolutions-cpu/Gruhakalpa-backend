const express = require("express");
const router = express.Router();
const receiptController = require("../controllers/receiptController");
const authMiddleware = require("../middleware/authMiddleware");

router.put("/receipts/:id", receiptController.updateReceipt);
router.post("/receipt", receiptController.createReceipt);
router.get("/receipts", receiptController.getAllReceipts);
router.get("/receipts/:id/download", receiptController.downloadReceiptPDF); // ✅ PDF download via Cloudinary
router.get("/receipts/:id", receiptController.getReceiptById); // ✅ Get single receipt
router.delete("/receipts/:id", authMiddleware, receiptController.deleteReceipt); // 🗑️ Superadmin only (checked in controller)
router.put("/backfill-receipts", receiptController.backfillReceipts);

module.exports = router;