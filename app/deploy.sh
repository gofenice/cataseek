#!/bin/bash

# Cataseek Deployment Script
# This script rebuilds both backend and frontend and restarts PM2.

echo "🚀 Starting Cataseek Deployment..."

# 1. Update Backend
echo "📦 Installing backend dependencies..."
npm install

echo "📦 Building Backend..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Backend build failed. Aborting."
    exit 1
fi

# 2. Update Frontend
echo "🎨 Building Dashboard Frontend..."
cd dashboard
npm install
VITE_API_URL=/api npm run build
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed. Aborting."
    exit 1
fi
cd ..

# 3. Restart Services
echo "🔄 Restarting PM2 process..."
pm2 restart cataseek || pm2 start dist/server.js --name cataseek
pm2 save

echo "✨ Deployment Complete! Your changes are now live."
