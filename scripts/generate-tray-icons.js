#!/usr/bin/env node
/**
 * Generate macOS tray icons as PNG files
 * macOS expects template images: monochrome with alpha channel, named with "Template" suffix
 * The OS will automatically invert colors for dark/light modes
 */

const fs = require('fs');
const path = require('path');

// Simple base64-encoded PNG for a microphone icon (22x22 monochrome template)
// This is a placeholder - ideally convert your SVG to proper template PNG
const iconBase64Template22 = 'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAD8SURBVDiN7ZQ9DsIwDIXfpwqJE8AJOAGcgBNwAk7ACTgBR2CqxMSWgYGBjhVSBzbE/1Q6IKF2QIgn/Uq/5+TZiYgAYA1gC+AE4NWtAZwBHAAcAfwAyAGQnPCzbpDkGQAkXwHcuruS3JFMSe4BXACM3X0L4NapPADnBcBr+Q/ApfsQXfhIcgJg6O5DMgVQkPQAngA8SR4WwJFkCqBw90KS3T0t3bI6vCc57exPQGqSW0lVyAlAF8AAwB7ABkAdwAjACEAfwBBAr+P4+EdwXQLzD3hdAoN3eLgssKzCw2UVHi7/0eGyCg+/gYfLAvgLfO/wb1oZ/O0AAAAASUVORK5CYII=';

const iconBase64Template44 = 'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHaSURBVFhH7ZixTsMwEIZ/p0JiYoEJJiYeACaegAmegAlegCdgggmJiYkHYGCDiYmJBQaYkBiRWiGBQEJqqVJbOztO7MTJ2Q2f9KlK7PN9d3a+c5IYAHgAcATgBuDd3R8AXgC4AngFQFqSZJdxgiQvAJDkHcCtd18k+YtklySPAK4BjN09AfDsVe4BTEqA1+4/dB+iH15JTgCM3X1IpiQLkg7AE4AnyeMc8EiyAFC4eyFJkuQkqcKrXuFd5+xPQDpJbkuqQk4AugAGAPYANgDqAEYARgD6AIYAeh3H+z+Ch0tg9g4PlwX6b/BwWaDvhofLAn03PFz+o8NlgY7wf2i4LNCR/g0Ol/8BX53/7W+G//MPAAAA==';

const outputDir = path.join(__dirname, '..', 'src', 'renderer');

// Create template icons for automatic theme adaptation
const icons = [
  { name: 'tray-iconTemplate.png', data: iconBase64Template22 },
  { name: 'tray-iconTemplate@2x.png', data: iconBase64Template44 }
];

console.log('Generating macOS tray template icons...\n');

icons.forEach(icon => {
  const outputPath = path.join(outputDir, icon.name);
  const buffer = Buffer.from(icon.data, 'base64');
  fs.writeFileSync(outputPath, buffer);
  console.log(`✓ Created: ${icon.name}`);
});

console.log('\n✓ Template icons created successfully!');
console.log('\nNote: These icons will auto-adapt to light/dark mode on macOS.');
console.log('The "Template" suffix tells macOS to invert colors automatically.');
console.log('\nFor production: Replace with your custom triangle icon design.');
console.log('Use a white/black monochrome PNG with alpha transparency.');
