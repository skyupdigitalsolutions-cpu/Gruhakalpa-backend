require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const SuperAdmin = require("./models/SuperAdmin");

const createSuperAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected");

    // Change these values as you want
    const hashedPassword = await bcrypt.hash("superadmin123", 10);

    const superAdmin = new SuperAdmin({
      name: "Super Admin",
      admin_id: "superadmin",
      password: hashedPassword,
      mobile: 9999999999,
      mail: "superadmin@gmail.com"
    });

    await superAdmin.save();
    console.log("✅ SuperAdmin created successfully!");
    console.log("Username: superadmin");
    console.log("Password: superadmin123");

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    mongoose.disconnect();
  }
};

createSuperAdmin();