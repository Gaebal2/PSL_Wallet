// Development only: translates public UI copy. Never runs in the wallet.
const fs = require('node:fs');
require('../pwa/i18n.js');
const {dictionary, templates, koreanLabels} = WalletI18n;
const source = Object.fromEntries([...dictionary, ...[...koreanLabels].map(([en, ko]) => [ko, en]), ...templates.map(({ko,en}) => [ko,en])]);
const output = 'pwa/locales.js';
const cache = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8').replace(/^globalThis.WalletLocales = /, '').replace(/;\s*$/, '')) : {};
const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort().join(',');
async function translateBatch(entries, lang) {
  const query = entries.map(([,text], i) => `ZXQ${i}ZXQ\n${text}`).join('\n');
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({client:'gtx',sl:'en',tl:lang,dt:'t',q:query});
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const translated = data[0].map(part=>part[0] || '').join('');
  const chunks = translated.split(/ZXQ\s*\d+\s*ZXQ\s*/i).slice(1);
  if(chunks.length !== entries.length) throw new Error('Batch boundary mismatch');
  return chunks.map((text, i) => {
    text = text.trim().replace(/\{\s*(\d+)\s*\}/g, '{$1}');
    if(placeholders(text) !== placeholders(entries[i][1])) throw new Error('Placeholder mismatch');
    return text;
  });
}
(async () => {
  for (const lang of ['zh-CN','zh-TW','vi','id','hi','fil','ja','de']) {
    cache[lang] ||= {};
    const pending = Object.entries(source).filter(([key])=>!cache[lang][key]);
    for (let offset=0; offset<pending.length; offset+=12) {
      const batch = pending.slice(offset,offset+12);
      let result;
      for(let attempt=0;attempt<3;attempt++) {
        try {result=await translateBatch(batch,lang);break;} catch(error) {if(attempt===2) throw error;}
      }
      batch.forEach(([key],i)=>cache[lang][key]=result[i]);
      for(let attempt=0;;attempt++) {
        try { fs.writeFileSync(output, 'globalThis.WalletLocales = '+JSON.stringify(cache,null,2)+';\n'); break; }
        catch(error) { if(attempt===4) throw error; await new Promise(resolve=>setTimeout(resolve,300)); }
      }
    }
    console.log(`${lang}: ${Object.keys(cache[lang]).length} strings`);
  }
  const confirmation = {
    'zh-CN':['输入“DELETE”以确认。','请准确输入“DELETE”。'],
    'zh-TW':['輸入「DELETE」以確認。','請準確輸入「DELETE」。'],
    vi:['Nhập “DELETE” để xác nhận.','Vui lòng nhập chính xác “DELETE”.'],
    id:['Ketik “DELETE” untuk mengonfirmasi.','Ketik “DELETE” dengan tepat.'],
    hi:['पुष्टि करने के लिए “DELETE” लिखें।','कृपया ठीक “DELETE” लिखें।'],
    fil:['I-type ang “DELETE” para kumpirmahin.','I-type nang eksakto ang “DELETE”.'],
    ja:['確認のため「DELETE」と入力してください。','「DELETE」と正確に入力してください。'],
    de:['Geben Sie zur Bestätigung „DELETE“ ein.','Bitte geben Sie genau „DELETE“ ein.']
  };
  for(const [lang, messages] of Object.entries(confirmation)) {
    cache[lang]['확인을 위해 “삭제”를 입력해 주세요.'] = messages[0];
    cache[lang]['“삭제”를 정확히 입력해 주세요.'] = messages[1];
  }
  fs.writeFileSync(output, 'globalThis.WalletLocales = '+JSON.stringify(cache,null,2)+';\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
