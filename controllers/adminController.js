const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Login admin with JWT
exports.loginAdmin = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Find admin by admin_id (username)
    const admin = await Admin.findOne({ admin_id: username });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: admin._id, 
        admin_id: admin.admin_id,
        name: admin.name 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' } // Token expires in 24 hours
    );

    // Send response with token
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        admin_id: admin.admin_id,
        email: admin.mail,
        mobile: admin.mobile
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login'
    });
  }
};

// Add new admin (with password hashing)
exports.addAdmin = async (req, res) => {
  try {
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ admin_id: req.body.admin_id });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin ID already exists'
      });
    }

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const admin = new Admin({
      name: req.body.name,
      admin_id: req.body.admin_id,
      password: hashedPassword, // Store hashed password
      mobile: req.body.mobile,
      mail: req.body.mail
    });

    await admin.save();
    
    res.status(201).json({
      success: true,
      message: 'Admin added successfully',
      admin: {
        name: admin.name,
        admin_id: admin.admin_id,
        mobile: admin.mobile,
        mail: admin.mail
      }
    });
  } catch (error) {
    console.error('Add admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding admin'
    });
  }
};

// Get all admins
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find({}).select('-password'); // Exclude password
    res.status(200).json({
      success: true,
      data: admins
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admins'
    });
  }
};

// Update admin
exports.updateAdmin = async (req, res) => {
  try {
    const updateData = {
      admin_id: req.body.admin_id,
      mobile: req.body.mobile,
      mail: req.body.mail
    };

    // If password is being updated, hash it
    if (req.body.password) {
      updateData.password = await bcrypt.hash(req.body.password, 10);
    }

    const updatedAdmin = await Admin.updateOne(
      { admin_id: req.params.id }, 
      { $set: updateData }
    );

    if (updatedAdmin.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin updated successfully'
    });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating admin'
    });
  }
};

// Verify token (for protected routes)
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      admin: {
        id: admin._id,
        name: admin.name,
        admin_id: admin.admin_id,
        email: admin.mail,
        mobile: admin.mobile
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};