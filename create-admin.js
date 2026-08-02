require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./models/Admin");

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected");

    // ── Change these values as you want ──
    const NAME = "Admin";
    const ADMIN_ID = "admin";
    const PASSWORD = "admin123";
    const MOBILE = 9999999999;
    const MAIL = "admin@gmail.com";

    // Don't create a duplicate if this admin_id already exists.
    const existing = await Admin.findOne({ admin_id: ADMIN_ID });
    if (existing) {
      console.log(`⚠️  An admin with admin_id "${ADMIN_ID}" already exists. Nothing created.`);
      return;
    }

    const hashedPassword = await bcrypt.hash(PASSWORD, 10);

    const admin = new Admin({
      name: NAME,
      admin_id: ADMIN_ID,
      password: hashedPassword,
      mobile: MOBILE,
      mail: MAIL,
    });

    await admin.save();
    console.log("✅ Admin created successfully!");
    console.log("Username:", ADMIN_ID);
    console.log("Password:", PASSWORD);
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    mongoose.disconnect();
  }
};

createAdmin();