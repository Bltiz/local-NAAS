#!/bin/bash

echo "=================================="
echo "Local NAS - Desktop App Builder"
echo "=================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

echo "✓ Node.js is installed"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "🔨 Building desktop app for your platform..."
echo ""

# Detect platform
if [[ "$OSTYPE" == "win32" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    echo "Detected: Windows"
    npm run electron-build-win
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected: macOS"
    npm run electron-build-mac
else
    echo "Detected: Linux"
    npm run electron-build-linux
fi

echo ""
echo "=================================="
echo "✅ Build complete!"
echo "=================================="
echo ""
echo "📁 Your app is in the 'dist' folder"
echo ""
echo "Next steps:"
echo "1. Go to the 'dist' folder"
echo "2. Run the installer/executable"
echo "3. Enjoy your Local NAS app!"
echo ""
