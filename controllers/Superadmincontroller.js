const SuperAdmin = require('../models/SuperAdmin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.loginSuperAdmin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    const superAdmin = await SuperAdmin.findOne({ admin_id: username });
    if (!superAdmin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const isPasswordValid = await bcrypt.compare(password, superAdmin.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: superAdmin._id, admin_id: superAdmin.admin_id, name: superAdmin.name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      superAdmin: {
        id: superAdmin._id,
        name: superAdmin.name,
        admin_id: superAdmin.admin_id,
        email: superAdmin.mail,
        mobile: superAdmin.mobile
      }
    });
  } catch (error) {
    console.error('SuperAdmin login error:', error);
    res.status(500).json({ success: false, message: 'Error during login' });
  }
};

exports.addSuperAdmin = async (req, res) => {
  try {
    const existing = await SuperAdmin.findOne({ admin_id: req.body.admin_id });
    if (existing) {
      return res.status(400).json({ success: false, message: 'SuperAdmin ID already exists' });
    }
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const superAdmin = new SuperAdmin({
      name: req.body.name,
      admin_id: req.body.admin_id,
      password: hashedPassword,
      mobile: req.body.mobile,
      mail: req.body.mail
    });
    await superAdmin.save();
    res.status(201).json({ success: true, message: 'SuperAdmin added successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error adding superAdmin' });
  }
};

exports.getAllSuperAdmins = async (req, res) => {
  try {
    const superAdmins = await SuperAdmin.find({}).select('-password');
    res.status(200).json({ success: true, data: superAdmins });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching superAdmins' });
  }
};

exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const superAdmin = await SuperAdmin.findById(decoded.id).select('-password');
    if (!superAdmin) {
      return res.status(404).json({ success: false, message: 'SuperAdmin not found' });
    }
    res.status(200).json({ success: true, superAdmin });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};