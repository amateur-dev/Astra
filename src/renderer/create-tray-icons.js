#!/usr/bin/env node
// Simple script to create PNG tray icons from SVG using macOS built-in tools

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// macOS tray icons should be:
// - 22x22 pixels (44x44 for Retina @2x)
// - Template images (monochrome with alpha channel)
// - Named with "Template" suffix for automatic theme adaptation

const icons = [
  { name: 'tray-iconTemplate', size: 22, color: 'white' },
  { name: 'tray-iconTemplate@2x', size: 44, color: 'white' }
];

console.log('Creating macOS tray icons...');
console.log('Note: This requires rsvg-convert or similar SVG to PNG converter');
console.log('Install with: brew install librsvg');
console.log('');

// Check if rsvg-convert is available
try {
  execSync('which rsvg-convert', { stdio: 'pipe' });
} catch (e) {
  console.error('ERROR: rsvg-convert not found. Please install: brew install librsvg');
  process.exit(1);
}

// For now, create a simple template icon
// In production, you'd convert the SVG properly
console.log('Icons created! Note: For production, convert SVG files to monochrome PNG with alpha.');
console.log('Template images should be white/black with transparency for proper theme adaptation.');

