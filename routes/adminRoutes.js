const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes (no authentication required)
router.post('/admin/login', adminController.loginAdmin);

// Protected routes (authentication required)
router.post('/add-admin', authMiddleware, adminController.addAdmin);
router.get('/admins', authMiddleware, adminController.getAllAdmins);
router.put('/edit-admin/:id', authMiddleware, adminController.updateAdmin);
router.get('/admin/verify', adminController.verifyToken);

module.exports = router;