const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const upload = require('../multerConfig');


router.put('/members/:id', memberController.updateMemberById);

// Add member
router.post('/add-members', upload.fields([
  { name: 'Image', maxCount: 1 },
  { name: 'PanCard', maxCount: 1 },
  { name: 'AadharCard', maxCount: 1 },
  { name: 'ApplicationDoc', maxCount: 1 },
]), memberController.addMember);

// Get all members
router.get('/members', memberController.getAllMembers);

// Update member
router.put('/update-member/:seniority_no', memberController.updateMember);

module.exports = router;