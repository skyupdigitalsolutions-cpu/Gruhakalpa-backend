const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const upload = require('../multerConfig');
const authMiddleware = require('../middleware/authMiddleware');

// Cancel membership (mirrors POST /sitebooking/cancel in siteBookingRoutes.js)
router.post(
  '/member/cancel',
  authMiddleware,
  upload.single('cancellationPdf'),
  memberController.cancelMember,
);

router.put('/members/:id', memberController.updateMemberById);

// Add member
router.post('/add-members', upload.fields([
  { name: 'Image', maxCount: 1 },
  { name: 'PanCard', maxCount: 1 },
  { name: 'AadharCard', maxCount: 1 },
  { name: 'ApplicationDoc', maxCount: 1 },
]), memberController.addMember);

// Receive the browser-generated membership-receipt PDF, upload it, and fire
// the member-added WhatsApp (PDF attached) + email.
router.post('/member-receipt-pdf', memberController.sendMemberReceipt);

// Get all members
router.get('/members', memberController.getAllMembers);

// Update member
router.put('/update-member/:seniority_no', memberController.updateMember);

module.exports = router;