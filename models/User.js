// server/models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please provide your email"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email address",
      ],
    },
    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Do not send password back in queries by default
    },
    // Uncomment and modify these fields for profile settings
    pic: {
      type: String,
      default: 'https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg',
    },
    status: { 
      type: String, 
      default: 'Hey there! I am using NeumoChat.',
      trim: true,
      maxlength: [150, "Status cannot be more than 150 characters"]
    },
    // isOnline: { type: Boolean, default: false },
    // lastSeen: { type: Date },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields automatically
  }
);

// Middleware: Hash password before saving the user document
userSchema.pre("save", async function (next) {
  // Only run this function if password was actually modified
  if (!this.isModified("password")) return next();

  // Hash the password with cost of 12
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

// Instance method: Compare candidate password with the hashed password in DB
userSchema.methods.matchPassword = async function (candidatePassword) {
  // 'this.password' refers to the password field in the user document (which is selected if needed)
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;
