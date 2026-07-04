require("dotenv").config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://rathnabhoomidevelopers_db_user:Z9dzxSCfjlSYZNkL@rbdcrm.rk7usja.mongodb.net/');
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

// Admin Schema
const adminSchema = new mongoose.Schema({
  name: {
    type: String,
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

const Admin = mongoose.model('Admin', adminSchema);

async function hashExistingPasswords() {
  try {
    await connectDB();

    // Get all admins
    const admins = await Admin.find({});
    
    if (admins.length === 0) {
      console.log('⚠️  No admins found in database!');
      console.log('💡 Use create-admin.js to create a new admin.\n');
      process.exit(0);
    }

    console.log(`Found ${admins.length} admin(s) in database\n`);
    console.log('='.repeat(50));

    let hashedCount = 0;

    for (const admin of admins) {
      console.log(`\n👤 Admin: ${admin.name} (${admin.admin_id})`);
      console.log(`📧 Email: ${admin.mail}`);
      console.log(`📱 Mobile: ${admin.mobile}`);
      console.log(`🔐 Current password: ${admin.password}`);
      
      // Check if password is already hashed (bcrypt hashes start with $2a$ or $2b$)
      if (admin.password.startsWith('$2a$') || admin.password.startsWith('$2b$')) {
        console.log('✅ Password already hashed, skipping...');
        continue;
      }

      console.log('⚙️  Hashing password...');
      
      // Hash the plain text password
      const hashedPassword = await bcrypt.hash(admin.password, 10);
      console.log(`🔒 New hashed password: ${hashedPassword.substring(0, 30)}...`);

      // Update in database
      await Admin.updateOne(
        { _id: admin._id },
        { password: hashedPassword }
      );

      console.log(`✅ Password updated for ${admin.admin_id}`);
      hashedCount++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`\n🎉 SUCCESS! Hashed ${hashedCount} password(s)\n`);
    
    if (hashedCount > 0) {
      console.log('📝 You can now login with your original passwords:');
      admins.forEach(admin => {
        console.log(`\n   Username: ${admin.admin_id}`);
        console.log(`   Password: (use your original password)`);
      });
      console.log('\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
hashExistingPasswords();