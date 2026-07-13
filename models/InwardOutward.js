const mongoose = require("mongoose");

// Inward / Outward register — tracks documents received by and sent from
// the society (letters, invoices, notices etc. via courier / by hand / post)
const inwardOutwardSchema = new mongoose.Schema(
  {
    // "inward"  = received by the society
    // "outward" = sent out by the society
    type: {
      type: String,
      enum: ["inward", "outward"],
      required: true,
      index: true,
    },
    // Auto-generated register number e.g. IN/2026/0001 or OUT/2026/0001
    ref_no: {
      type: String,
      required: true,
      unique: true,
    },
    // Date the document was received / dispatched
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    document_type: {
      type: String,
      enum: [
        "Letter",
        "Invoice",
        "Notice",
        "Application",
        "Agreement",
        "Cheque/DD",
        "Legal Document",
        "Other",
      ],
      default: "Letter",
    },
    // How it came in / went out
    mode: {
      type: String,
      enum: ["Courier", "By Hand", "Post Office", "Registered Post/RPAD", "Email", "Other"],
      default: "By Hand",
    },
    // Inward: who sent it to us. Outward: who we sent it to.
    party_name: {
      type: String,
      required: true,
      trim: true,
    },
    party_address: {
      type: String,
      trim: true,
      default: "",
    },
    // Contact mobile number of the sender / recipient
    mobile_no: {
      type: String,
      trim: true,
      default: "",
    },
    // Courier consignment no. / RPAD no. / cheque no. etc.
    tracking_no: {
      type: String,
      trim: true,
      default: "",
    },
    // Staff member who received / dispatched it
    handled_by: {
      type: String,
      trim: true,
      default: "",
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    // Uploaded document scans (Cloudinary) — multiple allowed
    attachments: [
      {
        url: { type: String, required: true },
        public_id: { type: String, default: "" },
        filename: { type: String, default: "" },
        resource_type: { type: String, default: "image" },
      },
    ],
    created_by: {
      type: String,
      default: "Admin",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("InwardOutward", inwardOutwardSchema);