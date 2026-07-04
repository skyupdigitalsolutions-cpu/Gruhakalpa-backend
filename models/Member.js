const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    membership_id: {
      type: String,
      required: true,
      unique: true,
    },
    aadharnumber: {
      type: Number,
      required: true,
    },
    applicationno: {
      type: Number,
      required: true,
    },
    membershiptype: {
      type: String,
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    dob: {
      type: Date,
      required: true,
    },
    membershipday: String,
    membershipfees: {
      type: Number,
      required: true,
    },
    father: String,
    birthplace: String,
    mobile: {
      type: Number,
      required: true,
    },
    alternatemobile: Number,
    email: String,
    alternateemail: String,
    permanentaddress: String,
    correspondenceaddress: String,
    nomineename: String,
    nomineenumber: Number,
    nomineeage: String,
    nomineerelationship: String,
    nomineeaddress: String,
    agreetermsconditions: {
      type: Boolean,
      default: false,
    },
    agreecommunication: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
      default: null,
    },
    pancard: {
      type: String,
      default: null,
    },
    aadharcard: {
      type: String,
      default: null,
    },
    applicationdoc: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Member", memberSchema, "membership");