const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  membershipid: {
    type: String,
    required: true
  },
  receipt_no: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  projectname: String,
  paymentmode: String,
  paymenttype: String,
  amountpaid: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema);
