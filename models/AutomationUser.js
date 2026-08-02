const mongoose = require("mongoose");

// A dedicated login for the festival-automation panel, separate from the main
// Admin/SuperAdmin. Only used to gate the automation routes.
const automationUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true }, // bcrypt hash
    name: { type: String, default: "Automation User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AutomationUser", automationUserSchema);