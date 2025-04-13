// server/controllers/authController.js
const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const asyncHandler = require("express-async-handler"); // Helper to handle async errors

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400); // Bad Request
    throw new Error("Please provide name, email, and password");
  }

  // Check if user already exists
  const userExists = await User.findOne({ email });

  if (userExists) {
    res.status(400);
    throw new Error("User already exists with this email");
  }

  // Create new user
  const user = await User.create({
    name,
    email,
    password, // Password will be hashed by mongoose pre-save hook
  });

  if (user) {
    // Generate token and send response (excluding password)
    res.status(201).json({
      // 201 Created
      _id: user._id,
      name: user.name,
      email: user.email,
      status: user.status,
      pic: user.pic,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

// @desc    Authenticate user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
exports.loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Please provide email and password");
  }

  // Find user by email, explicitly select password for comparison
  const user = await User.findOne({ email }).select("+password");

  // Check if user exists and password matches
  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      status: user.status,
      pic: user.pic,
      token: generateToken(user._id),
    });
  } else {
    res.status(401); // Unauthorized
    throw new Error("Invalid email or password");
  }
});

// @desc    Get user profile (Example protected route)
// @route   GET /api/auth/me
// @access  Private (Requires token)
exports.getMe = asyncHandler(async (req, res) => {
  // req.user is attached by the protect middleware
  // We fetch the user again in case data changed, or select specific fields
  const user = await User.findById(req.user.id).select("-password"); // Exclude password

  if (user) {
    res.json(user);
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

// @desc    Search for users based on name or email
// @route   GET /api/auth/user?search=keyword
// @access  Private (Requires token)
exports.searchUsers = asyncHandler(async (req, res) => {
  const keyword = req.query.search
    ? {
        $or: [
          // Case-insensitive regex search on name and email
          { name: { $regex: req.query.search, $options: "i" } },
          { email: { $regex: req.query.search, $options: "i" } },
        ],
      }
    : {}; // If no search query, return empty (or handle differently if needed)

  // Find users matching the keyword
  // Exclude the user making the request ($ne: Not Equal)
  // Use req.user._id which is added by the 'protect' middleware
  const users = await User.find(keyword)
    .find({ _id: { $ne: req.user._id } })
    .limit(10) // Limit results to prevent overload
    .select("name email pic _id"); // Select only the fields needed by the frontend

  res.json(users); // Send the array of found users
});

// @desc    Update user profile (name, email, status, profile pic)
// @route   PUT /api/auth/update-profile
// @access  Private (Requires token)
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, email, status } = req.body;
  const userId = req.user._id;
  
  // Log the request body for debugging
  console.log("Update Profile Request Body:", req.body);
  console.log("Status value received:", status);
  
  // Find the current user
  const user = await User.findById(userId);
  
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  
  // Check if the email is being changed and if it's already in use
  if (email && email !== user.email) {
    const emailExists = await User.findOne({ email, _id: { $ne: userId } });
    if (emailExists) {
      res.status(400);
      throw new Error("Email is already in use by another account");
    }
  }
  
  // Log current user status before update
  console.log("Current user status:", user.status);
  
  // Update basic fields
  user.name = name || user.name;
  user.email = email || user.email;
  // Fix the status update - checking explicit undefined doesn't work with FormData
  if (status) {
    user.status = status;
  }
  
  // Log user status after update
  console.log("Updated user status:", user.status);
  
  // If a file was uploaded, update the profile picture URL
  if (req.file && req.file.path) {
    user.pic = req.file.path; // Cloudinary returns the URL in req.file.path
  }
  
  // Save the updated user
  const updatedUser = await user.save();
  
  // Generate a new token with the updated info
  const token = generateToken(updatedUser._id);
  
  // Log response data
  console.log("Sending updated user data:", {
    status: updatedUser.status
  });
  
  // Return the updated user data (excluding password)
  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    status: updatedUser.status,
    pic: updatedUser.pic,
    token: token,
  });
});
