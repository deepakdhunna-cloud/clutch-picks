/* eslint-env node */
/* global Buffer */
const sharp = require('sharp');
const path = require('path');

// Splash dimensions (2732x2732 for all devices)
const SIZE = 2732;
const CENTER = SIZE / 2;

// Brand colors - matching welcome screen exactly
const COLORS = {
  black: '#000000',
  white: '#FFFFFF',
  midBlue: '#7A9DB8', // Mid layer color
  badgeBg: 'rgba(90, 122, 138, 0.4)', // PICKS badge background
  badgeBorder: '#5A7A8A', // PICKS badge border
};

// Scale factor - larger for splash screen
const SCALE = 5;
const BASE_SIZE = 52 * SCALE; // 52pt text like welcome screen

// 3D layer offsets (matching welcome screen: shadow=4px, mid=2px)
const SHADOW_OFFSET = 4 * SCALE;
const MID_OFFSET = 2 * SCALE;

// Font settings
const FONT_SIZE = BASE_SIZE;
const LETTER_SPACING = 2 * SCALE;

// Field Goal U dimensions (from component: viewBox="0 0 26 40", width=size*0.65)
const FIELD_GOAL_WIDTH = BASE_SIZE * 0.65;
const FIELD_GOAL_HEIGHT = BASE_SIZE;

// Approximate letter widths (uppercase, 900 weight)
const LETTER_WIDTH = BASE_SIZE * 0.62;

// Total logo width calculation - just CLUTCH
const CL_WIDTH = LETTER_WIDTH * 2 + LETTER_SPACING;
const TCH_WIDTH = LETTER_WIDTH * 3 + LETTER_SPACING * 2;

const CLUTCH_WIDTH = CL_WIDTH + FIELD_GOAL_WIDTH + TCH_WIDTH;

// Positioning - centered
const START_X = CENTER - CLUTCH_WIDTH / 2;
const TEXT_Y = CENTER - 40 * SCALE; // Move up to make room for PICKS badge

// FieldGoalU positions
const CL_END_X = START_X + CL_WIDTH;
const FIELD_GOAL_X = CL_END_X - 1 * SCALE;
const TCH_START_X = FIELD_GOAL_X + FIELD_GOAL_WIDTH - 1 * SCALE;

// PICKS badge dimensions (matching welcome screen)
const PICKS_FONT_SIZE = 28 * SCALE;
const PICKS_LETTER_SPACING = 8 * SCALE;
const PICKS_PADDING_H = 24 * SCALE;
const PICKS_PADDING_V = 12 * SCALE;
const PICKS_BORDER_RADIUS = 12 * SCALE;
const PICKS_BORDER_WIDTH = 2 * SCALE;
const PICKS_TEXT_WIDTH = PICKS_FONT_SIZE * 0.6 * 5 + PICKS_LETTER_SPACING * 4;
const PICKS_BADGE_WIDTH = PICKS_TEXT_WIDTH + PICKS_PADDING_H * 2;
const PICKS_BADGE_HEIGHT = PICKS_FONT_SIZE + PICKS_PADDING_V * 2;
const PICKS_Y = TEXT_Y + 70 * SCALE; // Below CLUTCH

// Generate the Field Goal U SVG (matching welcome screen style)
function generateFieldGoalU(x, y, color, scale = SCALE) {
  const s = scale;
  const height = 40 * s;

  const offsetX = x;
  const offsetY = y - height / 2 + 5 * s;

  const isBlack = color === COLORS.black;
  const laceColor = isBlack ? COLORS.black : '#0D0D0D';

  return `
    <g transform="translate(${offsetX}, ${offsetY})">
      <!-- Left upright -->
      <line x1="${4 * s}" y1="0" x2="${4 * s}" y2="${30 * s}"
            stroke="${color}" stroke-width="${5 * s}" stroke-linecap="round"/>
      <!-- Right upright -->
      <line x1="${22 * s}" y1="0" x2="${22 * s}" y2="${30 * s}"
            stroke="${color}" stroke-width="${5 * s}" stroke-linecap="round"/>
      <!-- Crossbar -->
      <line x1="${4 * s}" y1="${30 * s}" x2="${22 * s}" y2="${30 * s}"
            stroke="${color}" stroke-width="${5 * s}" stroke-linecap="round"/>
      <!-- Center post -->
      <line x1="${13 * s}" y1="${30 * s}" x2="${13 * s}" y2="${40 * s}"
            stroke="${color}" stroke-width="${4 * s}" stroke-linecap="round"/>
      <!-- Football: pointed oval shape, rotated -35 degrees -->
      <g transform="translate(${13 * s}, ${15 * s}) rotate(-35)">
        <path d="M${-5 * s} 0 Q 0 ${-5 * s} ${5 * s} 0 Q 0 ${5 * s} ${-5 * s} 0" fill="${color}"/>
        <!-- Laces - vertical line -->
        <line x1="0" y1="${-2 * s}" x2="0" y2="${2 * s}"
              stroke="${laceColor}" stroke-width="${1.2 * s}" stroke-linecap="round"/>
        <!-- Laces - horizontal lines -->
        <line x1="${-1.5 * s}" y1="${-1 * s}" x2="${1.5 * s}" y2="${-1 * s}"
              stroke="${laceColor}" stroke-width="${0.8 * s}"/>
        <line x1="${-1.5 * s}" y1="${1 * s}" x2="${1.5 * s}" y2="${1 * s}"
              stroke="${laceColor}" stroke-width="${0.8 * s}"/>
      </g>
    </g>
  `;
}

// Create the SVG - matching welcome screen gradient background with CLUTCH logo and PICKS badge
const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background gradient matching welcome screen -->
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0D0D0D"/>
      <stop offset="33%" stop-color="#1A1A2E"/>
      <stop offset="66%" stop-color="#16213E"/>
      <stop offset="100%" stop-color="#0D0D0D"/>
    </linearGradient>

    <style>
      .logo-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
        font-weight: 900;
        font-size: ${FONT_SIZE}px;
        letter-spacing: ${LETTER_SPACING}px;
        text-transform: uppercase;
      }
      .picks-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
        font-weight: 800;
        font-size: ${PICKS_FONT_SIZE}px;
        letter-spacing: ${PICKS_LETTER_SPACING}px;
        text-transform: uppercase;
      }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bgGradient)"/>

  <!-- ============ SHADOW LAYER (offset 4px down-right, black) ============ -->
  <g transform="translate(${SHADOW_OFFSET}, ${SHADOW_OFFSET})">
    <!-- CL text -->
    <text x="${START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.black}"
          dominant-baseline="middle" text-anchor="start">CL</text>

    <!-- Field Goal U -->
    ${generateFieldGoalU(FIELD_GOAL_X, TEXT_Y, COLORS.black)}

    <!-- TCH text -->
    <text x="${TCH_START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.black}"
          dominant-baseline="middle" text-anchor="start">TCH</text>
  </g>

  <!-- ============ MID LAYER (offset 2px down-right, #7A9DB8) ============ -->
  <g transform="translate(${MID_OFFSET}, ${MID_OFFSET})">
    <!-- CL text -->
    <text x="${START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.midBlue}"
          dominant-baseline="middle" text-anchor="start">CL</text>

    <!-- Field Goal U -->
    ${generateFieldGoalU(FIELD_GOAL_X, TEXT_Y, COLORS.midBlue)}

    <!-- TCH text -->
    <text x="${TCH_START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.midBlue}"
          dominant-baseline="middle" text-anchor="start">TCH</text>
  </g>

  <!-- ============ MAIN LAYER (white) ============ -->
  <g>
    <!-- CL text -->
    <text x="${START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.white}"
          dominant-baseline="middle" text-anchor="start">CL</text>

    <!-- Field Goal U -->
    ${generateFieldGoalU(FIELD_GOAL_X, TEXT_Y, COLORS.white)}

    <!-- TCH text -->
    <text x="${TCH_START_X}" y="${TEXT_Y}" class="logo-text" fill="${COLORS.white}"
          dominant-baseline="middle" text-anchor="start">TCH</text>
  </g>

  <!-- ============ PICKS BADGE ============ -->
  <!-- Badge background with border -->
  <rect x="${CENTER - PICKS_BADGE_WIDTH / 2}" y="${PICKS_Y - PICKS_BADGE_HEIGHT / 2}"
        width="${PICKS_BADGE_WIDTH}" height="${PICKS_BADGE_HEIGHT}"
        rx="${PICKS_BORDER_RADIUS}" ry="${PICKS_BORDER_RADIUS}"
        fill="${COLORS.badgeBorder}" fill-opacity="0.4"
        stroke="${COLORS.badgeBorder}" stroke-width="${PICKS_BORDER_WIDTH}"/>

  <!-- PICKS text -->
  <text x="${CENTER}" y="${PICKS_Y}"
        class="picks-text" fill="${COLORS.white}"
        dominant-baseline="middle" text-anchor="middle">PICKS</text>
</svg>
`;

async function generateSplash() {
  const scriptDir = path.dirname(process.argv[1]);
  const outputPath = path.join(scriptDir, '..', 'splash.png');

  await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toFile(outputPath);

  console.log(`Splash screen generated successfully at: ${outputPath}`);
  console.log(`Size: ${SIZE}x${SIZE} pixels`);
}

generateSplash().catch(console.error);
