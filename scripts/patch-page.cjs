const fs = require('fs');
const p = 'src/app/page.tsx';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('primaryPosition: "ST" as Position,', 'primaryPosition: "CF" as Position,');
s = s.replace('setDedicatedGks([]);', 'setDedicatedGks(result.dedicatedGks);');
fs.writeFileSync(p, s);
