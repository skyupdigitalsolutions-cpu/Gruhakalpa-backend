const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  
    name : {
     type : String,
     required: true,
    },
  admin_id: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  mobile: {
    type: Number,
    required: true
  },
  mail: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Admin', adminSchema);
