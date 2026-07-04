const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Add payment
router.post('/add-payment', paymentController.addPayment);

// Get all payments
router.get('/payments', paymentController.getAllPayments);

module.exports = router;
