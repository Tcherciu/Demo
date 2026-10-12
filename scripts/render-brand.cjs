// Renders assets/brand/mark.svg into the app's icon files (uses Playwright's Chromium).
// node scripts/render-brand.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const svg = fs.readFileSync(path.join(__dirname, '../assets/brand/mark.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const BG = '#0F1C17';
const variants = {
  // iOS / store icon: full-bleed, no transparency.
  'icon.png': { size: 1024, bg: `<defs><radialGradient id="bgg" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="#1A3026"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#bgg)"/>`, scale: 1 },
  // Android adaptive: the foreground must sit inside the central ~66% safe zone.
  'android-icon-foreground.png': { size: 1024, bg: '', scale: 0.64 },
  'android-icon-background.png': { size: 1024, bg: `<defs><radialGradient id="bgg" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="#1A3026"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#bgg)"/>`, scale: 0, },
  'android-icon-monochrome.png': { size: 1024, bg: '', scale: 0.64, mono: true },
  'splash-icon.png': { size: 1024, bg: '', scale: 1 },
  // Android status-bar notification icon: white on transparent, simplified by the OS to its alpha.
  'notification-icon.png': { size: 96, bg: '', scale: 1, mono: true },
  'favicon.png': { size: 196, bg: `<rect width="1024" height="1024" rx="230" fill="${BG}"/>`, scale: 1.08 },
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [file, v] of Object.entries(variants)) {
    let body = v.scale ? `<g transform="translate(512 512) scale(${v.scale}) translate(-512 -512)">${inner}</g>` : '';
    if (v.mono) body = body.replace(/url\(#loop\)|#F6F1E7|#FF6A1F/g, '#FFFFFF');
    const html = `<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${v.size}" height="${v.size}">${v.bg}${body}</svg></body></html>`;
    await p.setViewportSize({ width: v.size, height: v.size });
    await p.setContent(html);
    await p.locator('svg').screenshot({ path: path.join(__dirname, '../assets', file), omitBackground: true });
    console.log('wrote', file);
  }
  await b.close();
})();
