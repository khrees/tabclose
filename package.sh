#!/bin/bash

# TabClose Packaging Script
# Creates a clean ZIP file ready for distribution

echo "📦 Packaging TabClose extension..."

# Get version from manifest
VERSION=$(grep -o '"version": "[^"]*' manifest.json | cut -d'"' -f4)
echo "Version: $VERSION"

# Output filename
OUTPUT="tabclose-v${VERSION}.zip"

# Remove old package if it exists
if [ -f "$OUTPUT" ]; then
    echo "Removing old package..."
    rm "$OUTPUT"
fi

# Create the ZIP file with only necessary files
echo "Creating package..."
zip -r "$OUTPUT" \
    manifest.json \
    background.js \
    popup.html \
    popup.js \
    style.css \
    welcome.html \
    favicon_io/favicon-16x16.png \
    favicon_io/favicon-32x32.png \
    favicon_io/android-chrome-192x192.png \
    favicon_io/android-chrome-512x512.png \
    favicon_io/logo.svg \
    favicon_io/logo.png \
    -q

if [ $? -eq 0 ]; then
    SIZE=$(du -h "$OUTPUT" | cut -f1)
    echo "✅ Package created successfully!"
    echo "📄 File: $OUTPUT"
    echo "📊 Size: $SIZE"
    echo ""
    echo "🚀 Ready to release!"
    echo "   Upload this file to GitHub Releases"
else
    echo "❌ Error creating package"
    exit 1
fi
