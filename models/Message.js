// server/models/Message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Reference to the User model
      required: true,
    },
    content: {
      type: String,
      trim: true,
      required: [true, "Message content cannot be empty"],
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat", // Reference to the Chat model
      required: true,
    },
    // readBy: [ // Optional: For read receipts later
    //   {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: 'User',
    //   },
    // ],
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Optional: Index on chat field for faster retrieval of messages for a specific chat
messageSchema.index({ chat: 1 });
// Optional: Compound index for chat and timestamp for efficient sorting/filtering
messageSchema.index({ chat: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
