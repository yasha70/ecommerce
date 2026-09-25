'use strict';
// Generates stylised blouse illustrations as SVG so the catalog looks complete
// before real product photos are uploaded through the admin panel.

const HEX = /^[0-9a-fA-F]{6}$/;
const SLEEVES = ['sleeveless', 'cap', 'short', 'elbow', 'long', 'puff'];
const NECKS = ['round', 'v', 'boat', 'sweetheart', 'high', 'square'];
const PATTERNS = ['plain', 'dots', 'stripes', 'paisley', 'zari', 'floral', 'mirror'];
const VIEWS = ['front', 'back', 'detail'];

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function shade(hex, amt) {
  const n = parseInt(hex, 16);
  const c = (s) => Math.max(0, Math.min(255, ((n >> s) & 255) + amt));
  return ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}

function sleevePath(kind) {
  // Left sleeve; right sleeve is mirrored.
  switch (kind) {
    case 'sleeveless': return '';
    case 'cap': return 'M118 118 L86 150 L104 168 L128 146 Z';
    case 'short': return 'M118 116 L72 176 L100 196 L130 150 Z';
    case 'elbow': return 'M118 116 L58 236 L90 250 L132 156 Z';
    case 'long': return 'M118 116 L52 322 L84 330 L132 158 Z';
    case 'puff': return 'M120 112 C70 110 58 170 80 196 C96 212 120 196 132 156 Z';
    default: return '';
  }
}

function neckPath(kind, back) {
  if (back) {
    return {
      round: 'M150 96 Q200 190 250 96',
      v: 'M150 96 L200 210 L250 96',
      boat: 'M140 100 Q200 160 260 100',
      sweetheart: 'M150 96 Q200 230 250 96',
      high: 'M160 92 Q200 130 240 92',
      square: 'M150 96 L150 190 L250 190 L250 96',
    }[kind];
  }
  return {
    round: 'M160 94 Q200 150 240 94',
    v: 'M160 94 L200 170 L240 94',
    boat: 'M142 100 Q200 124 258 100',
    sweetheart: 'M160 94 Q170 160 200 150 Q230 160 240 94',
    high: 'M172 90 Q200 106 228 90',
    square: 'M160 94 L160 146 L240 146 L240 94',
  }[kind];
}

function patternDef(kind, accent, base) {
  const a = `#${accent}`;
  const dark = `#${shade(base, -30)}`;
  switch (kind) {
    case 'dots':
      return `<pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="3.2" fill="${a}"/></pattern>`;
    case 'stripes':
      return `<pattern id="p" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="18" fill="${a}" opacity=".7"/></pattern>`;
    case 'paisley':
      return `<pattern id="p" width="46" height="46" patternUnits="userSpaceOnUse"><path d="M14 30 C4 18 16 4 28 12 C36 18 30 32 20 30 C28 26 26 18 20 18" fill="none" stroke="${a}" stroke-width="2.2"/><circle cx="36" cy="36" r="2" fill="${a}"/></pattern>`;
    case 'zari':
      return `<pattern id="p" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M15 3 L27 15 L15 27 L3 15 Z" fill="none" stroke="${a}" stroke-width="1.4"/><circle cx="15" cy="15" r="2.2" fill="${a}"/></pattern>`;
    case 'floral':
      return `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><g fill="${a}" opacity=".85"><circle cx="20" cy="13" r="5"/><circle cx="27" cy="20" r="5"/><circle cx="20" cy="27" r="5"/><circle cx="13" cy="20" r="5"/></g><circle cx="20" cy="20" r="3.5" fill="${dark}"/></pattern>`;
    case 'mirror':
      return `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="7" fill="#e9eef2" stroke="${a}" stroke-width="2.5"/><circle cx="17" cy="17" r="3" fill="#ffffff" opacity=".8"/></pattern>`;
    default:
      return '';
  }
}

function blouseSvg(query = {}) {
  const base = HEX.test(query.c || '') ? query.c : 'a6432f';
  const accent = HEX.test(query.a || '') ? query.a : 'd9b35b';
  const sleeve = pick(query.s, SLEEVES, 'short');
  const neck = pick(query.n, NECKS, 'round');
  const pattern = pick(query.p, PATTERNS, 'plain');
  const view = pick(query.v, VIEWS, 'front');
  const bg = view === 'back' ? 'f3efe6' : view === 'detail' ? 'efe9df' : 'f7f3ea';
  const body = 'M150 96 L118 116 L130 158 L128 300 Q200 318 272 300 L270 158 L282 116 L250 96 Z';
  const sl = sleevePath(sleeve);
  const fillBase = `#${base}`;
  const hasPattern = pattern !== 'plain';
  const border = `#${accent}`;

  const garment = `
    <g stroke="#${shade(base, -55)}" stroke-width="2" stroke-linejoin="round">
      ${sl ? `<path d="${sl}" fill="${fillBase}"/><path d="${sl}" fill="url(#p)"/>
      <path d="${sl}" fill="${fillBase}" transform="translate(400 0) scale(-1 1)"/><path d="${sl}" fill="url(#p)" transform="translate(400 0) scale(-1 1)"/>` : ''}
      <path d="${body}" fill="${fillBase}"/>
      ${hasPattern ? `<path d="${body}" fill="url(#p)" stroke="none"/>` : ''}
      <path d="${body}" fill="url(#sheen)" stroke="none"/>
    </g>
    <path d="${neckPath(neck, view === 'back')}" fill="#${bg}" stroke="${border}" stroke-width="5"/>
    <path d="M130 292 Q200 310 270 292" fill="none" stroke="${border}" stroke-width="7"/>
    ${view === 'back' ? `<g fill="${border}"><circle cx="200" cy="232" r="4"/><circle cx="200" cy="252" r="4"/><circle cx="200" cy="272" r="4"/></g>
      <path d="M200 150 L200 300" stroke="#${shade(base, -40)}" stroke-width="1.5" stroke-dasharray="4 4"/>` : ''}
    ${view === 'front' ? `<path d="M168 190 Q200 210 232 190" fill="none" stroke="#${shade(base, -40)}" stroke-width="1.6" stroke-dasharray="3 5"/>` : ''}`;

  const content = view === 'detail'
    ? `<g transform="translate(-300 -260) scale(2.5)">${garment}</g>`
    : garment;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800">
  <defs>
    ${patternDef(pattern, accent, base) || '<pattern id="p" width="1" height="1"/>'}
    <linearGradient id="sheen" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".18"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="#${bg}"/>
  <ellipse cx="200" cy="360" rx="110" ry="10" fill="#000" opacity=".06"/>
  ${content}
</svg>`;
}

function blouseImageSet({ c, a, s, n, p }) {
  const q = (v) => `/img/blouse.svg?c=${c}&a=${a}&s=${s}&n=${n}&p=${p}&v=${v}`;
  return [q('front'), q('back'), q('detail')];
}

module.exports = { blouseSvg, blouseImageSet, SLEEVES, NECKS, PATTERNS };
