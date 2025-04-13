// server/middleware/errorMiddleware.js

const asyncHandler = require("express-async-handler"); // You might not strictly need asyncHandler here, but it's okay

// General Error Handler (Catches errors passed via next(err) or thrown by asyncHandler)
const errorHandler = (err, req, res, next) => {
  // Determine status code: use error's statusCode if set, otherwise use response's status code if set (and not 200), otherwise default to 500
  let statusCode =
    err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode) || 500;

  // Mongoose Bad ObjectId Error
  if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 404; // Treat invalid ID format as Not Found
    err.message = "Resource not found (Invalid ID)";
  }

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 400; // Bad Request
    const field = Object.keys(err.keyValue)[0];
    err.message = `Duplicate field value entered for ${field}. Please use another value.`;
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    statusCode = 400; // Bad Request
    // Combine multiple validation error messages if they exist
    const messages = Object.values(err.errors).map((val) => val.message);
    err.message = messages.join(". ");
  }

  res.status(statusCode);

  res.json({
    message: err.message,
    // Only include stack trace in development environment
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack, // Use undefined instead of null for cleaner JSON
  });
};

// Handler for Routes Not Found (404)
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.method} ${req.originalUrl}`);
  res.status(404);
  next(error); // Pass the error to the general 'errorHandler'
};

module.exports = { errorHandler, notFound };
