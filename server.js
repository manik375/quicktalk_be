// server/server.js
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const path = require("path"); // If serving static files later
const { Server } = require("socket.io");
const connectDB = require("./config/db");

// Load Env Vars
dotenv.config(); // Ensure this is near the top

// Connect to Database
connectDB();

// Route Files
const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const messageRoutes = require("./routes/messageRoutes");

// Middleware Files
const { protect } = require("./middleware/authMiddleware");
const { errorHandler, notFound } = require("./middleware/errorMiddleware");

const app = express();
const server = http.createServer(app); // Create HTTP server for Socket.IO

// --- Socket.IO Setup ---
const io = new Server(server, {
  pingTimeout: 60000, // 60 seconds timeout
  cors: {
    // Ensure this matches your frontend URL from .env or default
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // Allow cookies/auth headers if needed later
  },
});

// --- Online User Tracking (In-Memory) ---
let onlineUsers = {}; // { userId: socketId }
const getUserIdFromSocketId = (socketId) => {
  return Object.keys(onlineUsers).find(
    (userId) => onlineUsers[userId] === socketId
  );
};

// --- Core Express Middleware ---
// Enable CORS using the same origin as Socket.IO for consistency
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
// Body Parsers for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Middleware to attach io instance and onlineUsers map to request objects
// This makes them accessible in controllers if needed (e.g., for direct emits)
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  next();
});

// --- API Routes ---
// Mount routers for specific API paths
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
// Note: GET /api/auth/user?search=... is typically handled within authRoutes

// --- Simple Root Route for API health check ---
app.get("/api", (req, res) => {
  // Changed from "/" to "/api"
  res.send("NeumoChat API is running...");
});

// --- Frontend Static Build (Optional - Uncomment if deploying together) ---
/*
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, '/client/dist'))); // Adjust path to your frontend build folder

  app.get('*', (req, res) =>
    res.sendFile(path.resolve(__dirname, 'client', 'dist', 'index.html'))
  );
} else {
   // Keep API root route for development testing
   app.get("/", (req, res) => { res.send("API running in dev mode...") });
}
*/

// --- Error Handling Middleware (AFTER all routes) ---
app.use(notFound); // Handle 404 errors for routes not found
app.use(errorHandler); // Global error handler

// --- Socket.IO Connection Logic ---
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 1. User Setup (when frontend connects after login)
  socket.on("setup", (userData) => {
    if (!userData || !userData._id) {
      console.warn(
        `[Socket Setup] Received invalid userData from ${socket.id}`
      );
      return;
    }
    socket.join(userData._id); // User joins room based on their own ID
    socket.userData = userData; // Attach user data to the socket object
    onlineUsers[userData._id] = socket.id; // Store mapping
    console.log(
      `[Socket Setup] User ${userData.name} (${userData._id}) connected, joined room ${userData._id}. Online: ${Object.keys(onlineUsers).length}`
    );
    // Emit updated list of online user IDs to ALL connected clients
    io.emit("get online users", Object.keys(onlineUsers));
    socket.emit("connected"); // Acknowledge successful setup to the client
  });

  // 2. Joining Chat Rooms (when user opens a specific chat)
  socket.on("join chat", (chatId) => {
    if (!chatId) {
      console.warn(
        `[Socket Join Chat] Received invalid chatId from ${socket.id}`
      );
      return;
    }
    socket.join(chatId); // Socket joins room identified by the chatId
    console.log(
      `[Socket Join Chat] User ${socket.userData?.name || socket.id} joined chat room: ${chatId}`
    );
  });

  // 3. Typing Indicators Relay
  socket.on("typing", (chatId) => {
    if (!chatId || !socket.userData?._id) return; // Need room and user ID
    // Emit to everyone else in the specific chat room
    socket
      .to(chatId)
      .emit("typing", { userId: socket.userData._id, chatId: chatId });
  });

  socket.on("stop typing", (chatId) => {
    if (!chatId || !socket.userData?._id) return;
    // Emit to everyone else in the specific chat room
    socket
      .to(chatId)
      .emit("stop typing", { userId: socket.userData._id, chatId: chatId });
  });

  // 4. Handling New Messages (Emitted from messageController after saving to DB)
  // No listener needed here; emission happens in the controller.

  // --- WebRTC Signaling Handlers ---
  socket.on("call-user", ({ userToCall, signalData, from, name, callType }) => {
    const recipientSocketId = onlineUsers[userToCall];
    if (recipientSocketId) {
      console.log(`[Socket Call] Relaying call from ${from} (${name}) to ${userToCall}`);
      io.to(recipientSocketId).emit("call-incoming", {
        signal: signalData,
        from,
        name,
        callType,
      });
    } else {
      console.warn(`[Socket Call] User ${userToCall} not found or offline.`);
      // Optionally emit back to caller that user is unavailable
      // socket.emit("call-user-unavailable", { userToCall });
    }
  });

  socket.on("call-accepted", ({ to, signal }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) {
      console.log(`[Socket Call] Relaying acceptance from ${socket.userData?._id} to ${to}`);
      io.to(callerSocketId).emit("call-accepted", { signal, from: socket.userData?._id });
    } else {
      console.warn(`[Socket Call] Original caller ${to} not found for acceptance.`);
    }
  });

  socket.on("signal", ({ to, signal }) => {
    const recipientSocketId = onlineUsers[to];
    if (recipientSocketId) {
      // console.log(`[Socket Signal] Relaying signal from ${socket.userData?._id} to ${to}`);
      // Avoid excessive logging for frequent signal events
      io.to(recipientSocketId).emit("signal", { signal, from: socket.userData?._id });
    } else {
      // console.warn(`[Socket Signal] Recipient ${to} not found.`);
    }
  });

  socket.on("call-ended", ({ to }) => {
    const recipientSocketId = onlineUsers[to];
    if (recipientSocketId) {
      console.log(`[Socket Call End] Relaying call end from ${socket.userData?._id} to ${to}`);
      io.to(recipientSocketId).emit("call-ended", { from: socket.userData?._id });
    }
  });
  // --- End WebRTC Signaling Handlers ---

  // 5. Disconnection Logic
  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
    const disconnectedUserId = getUserIdFromSocketId(socket.id);
    if (disconnectedUserId) {
      const userName = socket.userData?.name || disconnectedUserId;
      delete onlineUsers[disconnectedUserId]; // Remove user from tracking
      console.log(
        `[Socket Disconnect] User ${userName} (${disconnectedUserId}) disconnected. Online: ${Object.keys(onlineUsers).length}`
      );
      // Broadcast the updated online list
      io.emit("get online users", Object.keys(onlineUsers));
    } else {
      // This might happen if setup wasn't called before disconnect
      console.log(
        `[Socket Disconnect] User for socket ${socket.id} was not tracked.`
      );
    }
    socket.userData = null; // Clean up user data on socket instance
  });

  // Optional: Basic error handler for socket events
  socket.on("error", (error) => {
    console.error(`[Socket Error] Socket ${socket.id} reported error:`, error);
  });
}); // End io.on('connection')

// --- Start Server ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
  console.log(
    `Frontend expected at: ${process.env.CORS_ORIGIN || "http://localhost:5173"}`
  );
});
