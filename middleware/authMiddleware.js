// server/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/User");

const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header (Bearer token)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Get token from header (Bearer <token>)
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from the token payload (id)
      // Attach user to the request object, excluding the password
      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        // If user associated with token no longer exists
        res.status(401);
        throw new Error("Not authorized, user not found");
      }

      next(); // Proceed to the next middleware/route handler
    } catch (error) {
      console.error("Token verification failed:", error.message);
      res.status(401); // Unauthorized
      throw new Error("Not authorized, token failed");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token provided");
  }
});

module.exports = { protect };
