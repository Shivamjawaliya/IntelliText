const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const svgPath = path.join(__dirname, '../public/icon.svg');
const outputDir = path.join(__dirname, '../public');

// Read the SVG file
const svgBuffer = fs.readFileSync(svgPath);

// Generate PNG files for each size
sizes.forEach(size => {
  sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(path.join(outputDir, `icon${size}.png`))
    .then(() => console.log(`Generated icon${size}.png`))
    .catch(err => console.error(`Error generating icon${size}.png:`, err));
}); 