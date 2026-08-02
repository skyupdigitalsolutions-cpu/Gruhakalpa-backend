require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const AutomationUser = require("./models/AutomationUser");

const createAutomationUser = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected");

    // ── Change these to whatever you want ──
    const USERNAME = "automation";
    const PASSWORD = "automation123";
    const NAME = "Automation Panel";

    const existing = await AutomationUser.findOne({ username: USERNAME });
    if (existing) {
      console.log(`⚠️  Automation user "${USERNAME}" already exists. Nothing created.`);
      return;
    }
    const hashed = await bcrypt.hash(PASSWORD, 10);
    await AutomationUser.create({ username: USERNAME, password: hashed, name: NAME });
    console.log("✅ Automation user created!");
    console.log("Username:", USERNAME);
    console.log("Password:", PASSWORD);
  } catch (e) {
    console.error("❌ Error:", e.message);
  } finally {
    mongoose.disconnect();
  }
};

createAutomationUser();