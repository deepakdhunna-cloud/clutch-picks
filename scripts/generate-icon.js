/* eslint-env node */
/* global Buffer */
const sharp = require('sharp');
const path = require('path');

// Icon dimensions
const SIZE = 1024;
const CENTER = SIZE / 2;

// Brand colors
const COLORS = {
  black: '#000000',
  white: '#FFFFFF',
  orange: '#E8936A',
  blueGray: '#5A7A8A',
  lightBlue: '#7A9DB8',
};

// Field goal post dimensions
const postWidth = 45;
const crossbarY = SIZE * 0.38;
const crossbarWidth = SIZE * 0.55;
const crossbarHeight = 40;
const uprightHeight = SIZE * 0.28;
const mainPostBottom = SIZE * 0.88;
const crossbarLeft = CENTER - crossbarWidth / 2;
const leftUprightX = crossbarLeft - postWidth / 2 + 10;
const rightUprightX = crossbarLeft + crossbarWidth - postWidth / 2 - 10;
const mainPostX = CENTER - postWidth / 2;
const mainPostTop = crossbarY + crossbarHeight / 2;

// Football dimensions
const footballCenterX = CENTER;
const footballCenterY = crossbarY - crossbarHeight / 2 - uprightHeight * 0.5;
const footballWidth = 140;
const footballHeight = 85;
const footballRotation = -30; // degrees

// Create SVG
const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background gradient for depth -->
    <radialGradient id="bgGradient" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="${COLORS.black}"/>
    </radialGradient>

    <!-- Football glow filter -->
    <filter id="footballGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="15" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Motion blur for trail -->
    <filter id="motionBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bgGradient)"/>

  <!-- Motion trail lines -->
  <g opacity="0.4" filter="url(#motionBlur)">
    <line x1="${footballCenterX - 60}" y1="${footballCenterY + 120}"
          x2="${footballCenterX - 75}" y2="${footballCenterY + 220}"
          stroke="${COLORS.lightBlue}" stroke-width="8" stroke-linecap="round"/>
    <line x1="${footballCenterX - 30}" y1="${footballCenterY + 110}"
          x2="${footballCenterX - 38}" y2="${footballCenterY + 210}"
          stroke="${COLORS.lightBlue}" stroke-width="8" stroke-linecap="round"/>
    <line x1="${footballCenterX}" y1="${footballCenterY + 100}"
          x2="${footballCenterX}" y2="${footballCenterY + 200}"
          stroke="${COLORS.lightBlue}" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    <line x1="${footballCenterX + 30}" y1="${footballCenterY + 110}"
          x2="${footballCenterX + 38}" y2="${footballCenterY + 210}"
          stroke="${COLORS.lightBlue}" stroke-width="8" stroke-linecap="round"/>
    <line x1="${footballCenterX + 60}" y1="${footballCenterY + 120}"
          x2="${footballCenterX + 75}" y2="${footballCenterY + 220}"
          stroke="${COLORS.lightBlue}" stroke-width="8" stroke-linecap="round"/>
  </g>

  <!-- Field Goal Post -->
  <!-- Main vertical post -->
  <rect x="${mainPostX}" y="${mainPostTop}"
        width="${postWidth}" height="${mainPostBottom - mainPostTop}"
        rx="8" fill="${COLORS.white}"/>

  <!-- Crossbar -->
  <rect x="${crossbarLeft}" y="${crossbarY - crossbarHeight / 2}"
        width="${crossbarWidth}" height="${crossbarHeight}"
        rx="10" fill="${COLORS.white}"/>

  <!-- Left upright -->
  <rect x="${leftUprightX}" y="${crossbarY - crossbarHeight / 2 - uprightHeight}"
        width="${postWidth}" height="${uprightHeight + crossbarHeight / 2}"
        rx="10" fill="${COLORS.white}"/>

  <!-- Right upright -->
  <rect x="${rightUprightX}" y="${crossbarY - crossbarHeight / 2 - uprightHeight}"
        width="${postWidth}" height="${uprightHeight + crossbarHeight / 2}"
        rx="10" fill="${COLORS.white}"/>

  <!-- Football -->
  <g transform="translate(${footballCenterX}, ${footballCenterY}) rotate(${footballRotation})" filter="url(#footballGlow)">
    <!-- Football body -->
    <ellipse cx="0" cy="0" rx="${footballWidth / 2}" ry="${footballHeight / 2}" fill="${COLORS.orange}"/>

    <!-- Laces - center line -->
    <line x1="${-footballWidth * 0.25}" y1="0" x2="${footballWidth * 0.25}" y2="0"
          stroke="${COLORS.white}" stroke-width="6" stroke-linecap="round"/>

    <!-- Lace stitches -->
    <line x1="${-footballWidth * 0.2}" y1="${-footballHeight * 0.25}"
          x2="${-footballWidth * 0.2}" y2="${footballHeight * 0.25}"
          stroke="${COLORS.white}" stroke-width="5" stroke-linecap="round"/>
    <line x1="${-footballWidth * 0.1}" y1="${-footballHeight * 0.25}"
          x2="${-footballWidth * 0.1}" y2="${footballHeight * 0.25}"
          stroke="${COLORS.white}" stroke-width="5" stroke-linecap="round"/>
    <line x1="0" y1="${-footballHeight * 0.25}"
          x2="0" y2="${footballHeight * 0.25}"
          stroke="${COLORS.white}" stroke-width="5" stroke-linecap="round"/>
    <line x1="${footballWidth * 0.1}" y1="${-footballHeight * 0.25}"
          x2="${footballWidth * 0.1}" y2="${footballHeight * 0.25}"
          stroke="${COLORS.white}" stroke-width="5" stroke-linecap="round"/>
    <line x1="${footballWidth * 0.2}" y1="${-footballHeight * 0.25}"
          x2="${footballWidth * 0.2}" y2="${footballHeight * 0.25}"
          stroke="${COLORS.white}" stroke-width="5" stroke-linecap="round"/>
  </g>
</svg>
`;

async function generateIcon() {
  const scriptDir = path.dirname(process.argv[1]);
  const outputPath = path.join(scriptDir, '..', 'icon.png');

  await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toFile(outputPath);

  console.log(`Icon generated successfully at: ${outputPath}`);
  console.log(`Size: ${SIZE}x${SIZE} pixels`);
}

generateIcon().catch(console.error);
