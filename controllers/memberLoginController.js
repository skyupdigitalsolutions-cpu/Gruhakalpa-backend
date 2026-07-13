const Member = require("../models/Member");
const jwt = require("jsonwebtoken");

// Member Login — username = membership_id, password = mobile number
exports.loginMember = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // Find member by membership_id
    const member = await Member.findOne({ membership_id: username.trim() });

    if (!member) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Password = mobile number (as string comparison)
    if (String(member.mobile) !== String(password).trim()) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: member._id,
        membership_id: member.membership_id,
        name: member.name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      member: {
        id: member._id,
        name: member.name,
        membership_id: member.membership_id,
        mobile: member.mobile,
        email: member.email,
        image: member.image || null,
      },
    });
  } catch (error) {
    console.error("Member login error:", error);
    res.status(500).json({ success: false, message: "Error during login" });
  }
};