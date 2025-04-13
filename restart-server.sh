#!/bin/bash

echo "===================== QuickTalk Server Restart ====================="
echo "Make sure to update your Cloudinary credentials in server/.env:"
echo "CLOUDINARY_CLOUD_NAME=your_cloud_name"
echo "CLOUDINARY_API_KEY=your_api_key"
echo "CLOUDINARY_API_SECRET=your_api_secret"
echo "You can get these from your Cloudinary dashboard (https://cloudinary.com)"
echo "======================================================================"

echo "Stopping any running server instances..."
pkill -f "node server.js" || true

echo "Starting server..."
npm run dev 