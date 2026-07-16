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
    membership_receipt_no: {
      type: String,
      default: null,
    },
    // Aadhaar is a 12-digit identifier, not a quantity. Stored as String so
    // the exact digits are preserved — a Number type mangles values with
    // spaces ("6890 5011 5053" → NaN), leading zeros, or 12-digit lengths
    // (which get exported as scientific notation e.g. 9.68581E+11).
    aadharnumber: {
      type: String,
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
    // Phone numbers are identifiers too — String preserves leading zeros and
    // any country-code / formatting the admin entered.
    mobile: {
      type: String,
      required: true,
    },
    alternatemobile: String,
    email: String,
    alternateemail: String,
    permanentaddress: String,
    correspondenceaddress: String,
    nomineename: String,
    nomineenumber: String,
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

// Enforce uniqueness of membership_receipt_no at the DB level.
// partialFilterExpression limits the unique constraint to documents where the
// field is an actual string, so members without a receipt number (null / absent)
// are excluded and never collide with one another.
memberSchema.index(
  { membership_receipt_no: 1 },
  {
    unique: true,
    partialFilterExpression: { membership_receipt_no: { $type: "string" } },
  },
);

module.exports = mongoose.model("Member", memberSchema, "membership");