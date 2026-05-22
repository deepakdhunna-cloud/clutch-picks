/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 1024;
const RENDER_SIZE = SIZE * 2;
const SS = RENDER_SIZE / SIZE;

const COLORS = {
  bg: [4, 6, 8],
  white: [244, 247, 249],
  teal: [122, 157, 184],
  maroon: [139, 10, 31],
  shadow: [0, 0, 0],
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function px(value) {
  return value * SS;
}

function idx(png, x, y) {
  return (y * png.width + x) * 4;
}

function blendPixel(png, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || alpha <= 0) return;
  const i = idx(png, x, y);
  const inv = 1 - alpha;
  png.data[i] = Math.round(rgb[0] * alpha + png.data[i] * inv);
  png.data[i + 1] = Math.round(rgb[1] * alpha + png.data[i + 1] * inv);
  png.data[i + 2] = Math.round(rgb[2] * alpha + png.data[i + 2] * inv);
  png.data[i + 3] = 255;
}

function fillBackground(png) {
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const nx = x / png.width;
      const ny = y / png.height;
      const centerGlow = 1 - clamp(Math.hypot(nx - 0.5, ny - 0.46) / 0.72);
      const tealGlow = 1 - clamp(Math.hypot(nx - 0.78, ny - 0.78) / 0.48);
      const maroonGlow = 1 - clamp(Math.hypot(nx - 0.22, ny - 0.18) / 0.42);
      const vignette = smoothstep(0.92, 0.22, Math.hypot(nx - 0.5, ny - 0.5));
      const texture = (((x * 17 + y * 31) % 97) / 97 - 0.5) * 3;
      const line = Math.abs(((nx * 1.7 + ny * 2.1) % 0.24) - 0.12) < 0.003 ? 8 : 0;

      const rgb = [
        COLORS.bg[0] + centerGlow * 12 + maroonGlow * 18 + tealGlow * 5 + line + texture,
        COLORS.bg[1] + centerGlow * 13 + maroonGlow * 2 + tealGlow * 18 + line + texture,
        COLORS.bg[2] + centerGlow * 16 + maroonGlow * 5 + tealGlow * 26 + line + texture,
      ].map((channel) => clamp(channel / 255, 0, 1) * 255 * vignette);

      const i = idx(png, x, y);
      png.data[i] = Math.round(rgb[0]);
      png.data[i + 1] = Math.round(rgb[1]);
      png.data[i + 2] = Math.round(rgb[2]);
      png.data[i + 3] = 255;
    }
  }
}

function roundRectDistance(pxValue, pyValue, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(pxValue - cx) - (w / 2 - r);
  const qy = Math.abs(pyValue - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawRoundedRect(png, x, y, w, h, r, rgb, alpha = 1) {
  const sx = Math.max(0, Math.floor(x - 3));
  const sy = Math.max(0, Math.floor(y - 3));
  const ex = Math.min(png.width - 1, Math.ceil(x + w + 3));
  const ey = Math.min(png.height - 1, Math.ceil(y + h + 3));

  for (let pyValue = sy; pyValue <= ey; pyValue += 1) {
    for (let pxValue = sx; pxValue <= ex; pxValue += 1) {
      const d = roundRectDistance(pxValue + 0.5, pyValue + 0.5, x, y, w, h, r);
      const coverage = clamp(0.5 - d);
      blendPixel(png, pxValue, pyValue, rgb, coverage * alpha);
    }
  }
}

function drawRotatedEllipse(png, cx, cy, rx, ry, angle, rgb, alpha = 1) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pad = Math.max(rx, ry) + 4;
  const sx = Math.max(0, Math.floor(cx - pad));
  const sy = Math.max(0, Math.floor(cy - pad));
  const ex = Math.min(png.width - 1, Math.ceil(cx + pad));
  const ey = Math.min(png.height - 1, Math.ceil(cy + pad));

  for (let y = sy; y <= ey; y += 1) {
    for (let x = sx; x <= ex; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const dist = Math.hypot(lx / rx, ly / ry) - 1;
      const coverage = clamp(0.5 - dist * Math.min(rx, ry));
      blendPixel(png, x, y, rgb, coverage * alpha);
    }
  }
}

function drawLine(png, x1, y1, x2, y2, width, rgb, alpha = 1) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width - 2));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width - 2));
  const maxX = Math.min(png.width - 1, Math.ceil(Math.max(x1, x2) + width + 2));
  const maxY = Math.min(png.height - 1, Math.ceil(Math.max(y1, y2) + width + 2));
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = clamp(((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / len2);
      const pxValue = x1 + t * vx;
      const pyValue = y1 + t * vy;
      const d = Math.hypot(x + 0.5 - pxValue, y + 0.5 - pyValue) - width / 2;
      const coverage = clamp(0.5 - d);
      blendPixel(png, x, y, rgb, coverage * alpha);
    }
  }
}

function localPoint(cx, cy, angle, x, y) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + x * cos - y * sin, cy + x * sin + y * cos];
}

function drawFieldGoal(png, offsetX, offsetY, rgb, alpha) {
  const shapes = [
    [px(306) + offsetX, px(228) + offsetY, px(58), px(376), px(18)],
    [px(660) + offsetX, px(228) + offsetY, px(58), px(376), px(18)],
    [px(306) + offsetX, px(552) + offsetY, px(412), px(64), px(19)],
    [px(483) + offsetX, px(552) + offsetY, px(58), px(294), px(18)],
  ];
  for (const shape of shapes) drawRoundedRect(png, ...shape, rgb, alpha);
}

function drawIcon() {
  const high = new PNG({ width: RENDER_SIZE, height: RENDER_SIZE });
  fillBackground(high);

  drawRoundedRect(high, px(70), px(70), px(884), px(884), px(174), COLORS.shadow, 0.20);
  drawRoundedRect(high, px(82), px(82), px(860), px(860), px(164), COLORS.teal, 0.20);
  drawRoundedRect(high, px(100), px(100), px(824), px(824), px(148), COLORS.shadow, 0.72);
  drawRoundedRect(high, px(112), px(112), px(800), px(800), px(138), [10, 14, 18], 0.96);

  drawFieldGoal(high, px(18), px(22), COLORS.shadow, 0.35);
  drawFieldGoal(high, px(-7), px(-8), COLORS.teal, 0.20);
  drawFieldGoal(high, px(5), px(5), [180, 190, 197], 0.30);
  drawFieldGoal(high, 0, 0, COLORS.white, 0.98);

  const footballAngle = -0.55;
  const ballCx = px(512);
  const ballCy = px(430);
  drawRotatedEllipse(high, ballCx + px(8), ballCy + px(10), px(78), px(47), footballAngle, COLORS.shadow, 0.32);
  drawRotatedEllipse(high, ballCx, ballCy, px(72), px(43), footballAngle, COLORS.maroon, 0.98);
  drawRotatedEllipse(high, ballCx - px(13), ballCy - px(10), px(28), px(13), footballAngle, [222, 129, 145], 0.18);

  const laceStart = localPoint(ballCx, ballCy, footballAngle, px(-34), 0);
  const laceEnd = localPoint(ballCx, ballCy, footballAngle, px(34), 0);
  drawLine(high, laceStart[0], laceStart[1], laceEnd[0], laceEnd[1], px(7), COLORS.white, 0.88);
  for (const x of [-22, -11, 0, 11, 22]) {
    const p1 = localPoint(ballCx, ballCy, footballAngle, px(x), px(-16));
    const p2 = localPoint(ballCx, ballCy, footballAngle, px(x), px(16));
    drawLine(high, p1[0], p1[1], p2[0], p2[1], px(5), COLORS.white, 0.86);
  }

  drawRoundedRect(high, px(132), px(132), px(760), px(760), px(120), COLORS.white, 0.045);
  drawRoundedRect(high, px(146), px(146), px(732), px(732), px(106), COLORS.maroon, 0.08);

  const icon = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const source = idx(high, x * SS + sx, y * SS + sy);
          totals[0] += high.data[source];
          totals[1] += high.data[source + 1];
          totals[2] += high.data[source + 2];
          totals[3] += high.data[source + 3];
        }
      }
      const out = idx(icon, x, y);
      icon.data[out] = Math.round(totals[0] / (SS * SS));
      icon.data[out + 1] = Math.round(totals[1] / (SS * SS));
      icon.data[out + 2] = Math.round(totals[2] / (SS * SS));
      icon.data[out + 3] = Math.round(totals[3] / (SS * SS));
    }
  }

  return icon;
}

const outputPath = path.join(__dirname, '..', 'icon.png');
drawIcon().pack().pipe(fs.createWriteStream(outputPath)).on('finish', () => {
  console.log(`Icon generated at ${outputPath}`);
});
