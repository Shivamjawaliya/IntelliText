const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
// Use provided PNG as the source image
const sourcePath = path.join(__dirname, '../src/popup/10337559.png');
const outputDir = path.join(__dirname, '../public');

if (!fs.existsSync(sourcePath)) {
  console.error('Source icon not found:', sourcePath);
  process.exit(1);
}

const inputBuffer = fs.readFileSync(sourcePath);

sizes.forEach(size => {
  sharp(inputBuffer)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(path.join(outputDir, `icon${size}.png`))
    .then(() => console.log(`Generated icon${size}.png`))
    .catch(err => console.error(`Error generating icon${size}.png:`, err));
}); 