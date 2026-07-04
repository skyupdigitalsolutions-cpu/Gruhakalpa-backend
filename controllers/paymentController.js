const Payment = require('../models/Payment');

// Add new payment
exports.addPayment = async (req, res) => {
  try {
    const payment = new Payment({
      membershipid: req.body.membershipid,
      receipt_no: req.body.receipt_no,
      date: new Date(req.body.date),
      name: req.body.name,
      projectname: req.body.projectname,
      paymentmode: req.body.paymentmode,
      paymenttype: req.body.paymenttype,
      amountpaid: parseInt(req.body.amountpaid)
    });

    await payment.save();
    res.send('Added Payment Successfully!..');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error adding payment');
  }
};

// Get all payments
exports.getAllPayments = async (req, res) => {
  try {
    const payments = await Payment.find({});
    res.send(payments);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching payments');
  }
};
