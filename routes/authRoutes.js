// server/routes/authRoutes.js
const express = require("express");
const {
  registerUser,
  loginUser,
  getMe,
  searchUsers,
  updateProfile,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const { uploadProfilePic } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
// Example of a protected route:

// User search route - Protected
// Note: It's common to put user-related routes in a separate file (e.g., userRoutes.js)
// and mount it like app.use('/api/users', userRoutes), but for now, keeping it here.
// The route will be GET /api/auth/user?search=...
router.route("/user").get(protect, searchUsers);

// Update profile route - Protected and uses upload middleware
router.route("/update-profile").put(protect, uploadProfilePic, updateProfile);

// router.get('/me', protect, getMe); // Add this line later when testing middleware

module.exports = router;
