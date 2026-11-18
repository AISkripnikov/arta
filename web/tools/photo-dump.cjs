// Выгрузить аэрофотоснимки планшета в PNG: node tools/photo-dump.cjs <mission> <outPrefix>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [mission, out] = [process.argv[2] || '0', process.argv[3] || '/tmp/photo'];
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  p.setDefaultTimeout(300000);
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + path.resolve(__dirname, '../.dev/st-plot/index.html'));
  await p.waitForFunction(() => window.__dev);
  const js = fs.readFileSync(process.argv[4], 'utf8').replace('MISSION', mission);
  console.log(JSON.stringify(await p.evaluate('(async()=>{' + js + '})()')));
  await p.waitForTimeout(3000);
  const urls = await p.evaluate(() => {
    const g = window.__dev.engine.scene.getObjectByName('aerialPhotos');
    return g ? g.children.map((m) => m.material.map.image.toDataURL('image/png')) : [];
  });
  urls.forEach((u, i) => fs.writeFileSync(`${out}-${i + 1}.png`, Buffer.from(u.split(',')[1], 'base64')));
  console.log('photos', urls.length);
  await b.close();
})();
