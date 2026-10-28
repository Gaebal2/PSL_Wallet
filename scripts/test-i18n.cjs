const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../pwa/locales.js');
require('../pwa/i18n.js');
const i18n = WalletI18n;
i18n.setLanguage('en');
assert.equal(i18n.translate(''), '', 'Whitespace must not become undefined');
assert.equal(i18n.translate('(양호O) 개인키 기기에 백업 완료'), '(Good O) Private keys backed up on device');
assert.equal(i18n.translate('백업된 개인키 불러오기'), 'Import private key backup');
assert.equal(i18n.translate('소수점은 최대 18자리까지 입력할 수 있습니다.'), 'Use no more than 18 decimal places.');
assert.equal(i18n.translate('PSL_HODler 지갑을 삭제할까요?'), 'Delete wallet PSL_HODler?');
assert.equal(i18n.translate('10 PSL 전송이 확인되었습니다. 거래 해시: abc123'), 'Transfer of 10 PSL confirmed. Hash: abc123');
assert.equal(i18n.translate('받는 주소: 알 수 없음'), 'Recipient: Unknown');
assert.equal(i18n.translate('PSL 잔액을 확인할 수 없습니다: 보유 수량이 부족합니다.'), 'Cannot check the PSL balance: Insufficient balance.');
assert.equal(i18n.translate('내가 정한 이름'), '내가 정한 이름');
const html = fs.readFileSync(require.resolve('../pwa/index.html'), 'utf8');
const visibleText = [...html.matchAll(/>([^<>]+)</g)].map(match => match[1].trim().replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
const attributes = [...html.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]+)"/g)].map(match => match[1]);
const exceptions = new Set(['지갑 1', '언어: 한국어. 영어로 전환']);
const missing = [...new Set([...visibleText, ...attributes].filter(text => /[가-힣]/.test(text) && !exceptions.has(text) && i18n.translate(text) === text))];
assert.deepEqual(missing, [], 'All static Korean UI strings must have English translations');
assert(!html.includes('????'), 'No broken Korean labels');
i18n.setLanguage('ko');
assert.equal(i18n.translate('백업된 개인키 불러오기'), '백업된 개인키 불러오기');
assert.equal(i18n.translate('ACTIVE WALLET'), '현재 지갑');
console.log('✓ Localization coverage, dynamic messages, preserved user text and Korean/English switching passed');

const source = fs.readFileSync(require.resolve('../pwa/i18n.js'), 'utf8');
function boot(device, saved, blocked = false) {
  const storage = new Map(saved ? [['psl-wallet-language', saved]] : []);
  const context = vm.createContext({navigator:{languages:[device]}, localStorage:{
    getItem(key) { if(blocked) throw Error('blocked'); return storage.get(key); },
    setItem(key,value) { if(blocked) throw Error('blocked'); storage.set(key,value); }
  }});
  vm.runInContext(source,context);
  return {api:context.WalletI18n,storage};
}
for(const [device,expected] of Object.entries({'fr-FR':'ko','':'ko','en-GB':'en','ko-KR':'ko','zh-Hant-HK':'zh-TW','zh-Hans':'zh-CN','zh-HK':'zh-TW','vi-VN':'vi','in-ID':'id','hi-IN':'hi','tl-PH':'fil','ja-JP':'ja','de-DE':'de'})) {
  assert.equal(boot(device).api.language,expected,device);
}
assert.equal(boot('ja-JP','de').api.language,'de');
assert.equal(boot('fr-FR','invalid').api.language,'ko');
const persisted = boot('en-US');
persisted.api.setLanguage('ja');
assert.equal(persisted.storage.get('psl-wallet-language'),'ja');
assert.equal(boot('en-US',persisted.storage.get('psl-wallet-language')).api.language,'ja');
persisted.api.setLanguage('invalid');
assert.equal(persisted.api.language,'ja');
assert.doesNotThrow(()=>boot('fr-FR',null,true).api.setLanguage('de'));
const keys = new Set([...i18n.dictionary.keys(), ...i18n.koreanLabels.values(), ...i18n.templates.map(item=>item.ko)]);
const slots = text => [...text.matchAll(/\{\d+\}/g)].map(item=>item[0]).sort();
for(const {code} of i18n.supportedLanguages.filter(item=>!['ko','en'].includes(item.code))) {
  const catalog = WalletLocales[code];
  assert(catalog, `Missing ${code}`);
  i18n.setLanguage(code);
  for(const key of keys) {
    assert.equal(typeof catalog[key],'string', `${code}: ${key}`);
    assert(catalog[key].trim(),`${code}: empty translation`);
    assert.deepEqual(slots(catalog[key]),slots(key),`${code}: changed placeholders`);
  }
  assert.equal(i18n.translate('언어 선택'),catalog['언어 선택']);
  assert.equal(i18n.translate('ACTIVE WALLET'),catalog['현재 지갑']);
  assert(i18n.translate('확인을 위해 “삭제”를 입력해 주세요.').includes('DELETE'));
  assert(i18n.translate('“삭제”를 정확히 입력해 주세요.').includes('DELETE'));
  assert(i18n.translate('PSL_HODler 지갑을 삭제할까요?').includes('PSL_HODler'));
  assert(i18n.translate('10 PSL 전송이 확인되었습니다. 거래 해시: abc123').includes('abc123'));
  assert.equal(i18n.translate('내가 정한 이름'),'내가 정한 이름');
}
const worker = fs.readFileSync(require.resolve('../pwa/sw.js'),'utf8');
assert(html.indexOf('locales.js?') < html.indexOf('i18n.js?'));
assert(worker.includes('./locales.js?v=102'));
assert.equal((html.match(/aria-controls="languageDialog"/g)||[]).length,2);
console.log('✓ All 10 languages, complete catalogs, placeholders, device defaults, persistence and offline assets passed');
