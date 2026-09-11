/* UI-only localization. Wallet data, keys and input values are never translated. */
globalThis.WalletI18n = (() => {
  const pairs = `
본문으로 건너뛰기|Skip to content
PSL 토큰 잔액|PSL token balance
SL 메인넷 잔액|SL mainnet balance
↓ 아래로 당겼다 놓으면 모든 지갑의 잔액이 새로고침됩니다.|↓ Pull down and release to refresh all wallet balances.
로컬 암호화 보관|Encrypted local storage
개인키는 AES-GCM으로 암호화되어 이 기기에만 저장됩니다.|Your private key is encrypted with AES-GCM and stored only on this device.
SL · PSL 거래 이력|SL · PSL transaction history
활성 지갑 작업|Active wallet actions
PSL Token Wallet 홈|PSL Token Wallet home
연결 확인 중|Connecting
지갑 잠그기|Lock wallet
설정 열기|Open settings
설정|Settings
내 자산의 열쇠를|The key to your assets,
내 손 안에.|in your hands.
개인키는 서버로 전송되지 않으며, 이 기기에서 비밀번호로 암호화됩니다.|Your private key is encrypted with your password on this device and is never sent to a server.
새 지갑 만들기|Create a wallet
기존 지갑 가져오기|Import a wallet
지갑 보호 비밀번호|Wallet password
12자 이상을 권장합니다. 비밀번호는 복구할 수 없습니다.|We recommend at least 12 characters. Your password cannot be recovered.
비밀번호|Password
비밀번호 확인|Confirm password
비밀번호 표시|Show password
비밀번호 숨기기|Hide password
개인키 표시|Show private key
개인키 숨기기|Hide private key
비밀번호와 개인키를 잃으면 자산을 복구할 수 없음을 이해했습니다.|I understand that losing my password and private key means I cannot recover my assets.
안전하게 생성|Create securely
지갑 이름|Wallet name
SASEUL에서 사용하던 지갑 이름|Your SASEUL wallet name
개인키 (64자리)|Private key (64 hex characters)
새 보호 비밀번호|New wallet password
암호화하여 가져오기|Encrypt and import
지갑 잠금 해제|Unlock wallet
보호 비밀번호는 이 기기 안에서만 확인됩니다.|Your password is verified only on this device.
잠금 해제|Unlock
이 기기에서 지갑 삭제|Delete wallet from this device
지갑 편집|Manage wallets
복사|Copy
PSL 보내기|Send PSL
PSL 받기|Receive PSL
SL 보내기|Send SL
SL 받기|Receive SL
거래 이력|Transaction history
이전|Previous
다음|Next
Wallet을 설치할까요?|Install Wallet?
홈 화면이나 바탕화면에서 앱처럼 빠르게 열 수 있습니다.|Open Wallet quickly from your home screen or desktop.
Safari 하단의|At the bottom of Safari, tap
공유|Share
버튼을 누른 뒤|and then select
홈 화면에 추가|Add to Home Screen
를 선택하세요.|.
폰·바탕화면에 설치|Install on device
나중에|Later
네트워크 설정|Network settings
닫기|Close
RPC 엔드포인트|RPC endpoint
토큰 발행자 주소|Token issuer address
CID 입력 시 비워도 됩니다|Optional when a CID is provided
컨트랙트 공간명|Contract space name
토큰 CID (선택)|Token CID (optional)
64자리 CID|64-character CID
신뢰하는 HTTPS RPC만 사용하세요. CID가 있으면 발행자와 공간명보다 우선합니다.|Use a trusted HTTPS RPC. A CID takes priority over the issuer and space name.
저장하고 연결|Save and connect
앱 제거 · 저장소 안내|App removal and storage
개인키 기기에 백업하기|Back up private key to device
백업된 개인키 불러오기|Import private key backup
개인키 백업 보기|View private key backup
이 기기에서 모든 지갑 삭제|Delete all wallets from this device
앱을 제거하기 전에 확인해 주세요|Before removing the app
사이트 저장소 유지|Keep site data
암호화된 개인키가 브라우저 저장소에 남아 있으면 나중에 Wallet을 다시 설치한 뒤 기존 잠금 해제 비밀번호로 지갑을 사용할 수 있습니다.|If your encrypted key remains in browser storage, you can reinstall Wallet and unlock it with your existing password.
사이트 저장소 삭제|Delete site data
암호화된 개인키도 함께 삭제됩니다. 개인키를 백업하지 않았다면 지갑을 복구할 수 없습니다.|Your encrypted private key will also be deleted. Without a private key backup, you cannot recover your wallet.
Android 또는 브라우저가 앱 제거 시 사이트 저장소를 함께 삭제할 수도 있으므로, 앱을 제거하기 전에 개인키를 반드시 백업해 주세요.|Android or your browser may delete site data when removing the app. Back up your private key first.
개인키 백업|Private key backup
지갑 데이터 삭제|Delete wallet data
개인키로 지갑 추가|Add wallet using a private key
예: 거래용 지갑|e.g. Trading wallet
암호화하여 추가|Encrypt and add
내 지갑|My wallets
등록된 지갑|Registered wallets
+ 개인키로 지갑 추가|+ Add wallet using a private key
+ 새 지갑 생성|+ Create a new wallet
새 지갑을 생성하시겠습니까?|Create a new wallet?
새 개인키가 이 기기에서 안전하게 생성되고 현재 비밀번호로 암호화됩니다. 생성 후 개인키를 반드시 백업해 주세요.|A new private key will be generated securely on this device and encrypted with your current password. Back it up after creation.
예: 새 지갑|e.g. New wallet
취소|Cancel
생성|Create
받는 주소|Recipient address
보낸 주소|Sender address
44자리 SASEUL 주소|44-character SASEUL address
수량|Amount
최대|Max
검토 후 전송|Review and send
지갑 주소 QR 코드|Wallet address QR code
아래 SASEUL 주소를 보내는 사람에게 공유하세요.|Share the SASEUL address below with the sender.
주소 복사|Copy address
전송 정보를 확인해 주세요|Review your transfer
보낼 수량|Amount to send
네트워크 수수료|Network fee
주소와 수량이 정확한지 다시 확인해 주세요.|Check that the address and amount are correct.
전송하기|Send
보내기(처리중...)|Sending (processing…)
보내기(성공)|Transfer successful
보내기(실패)|Transfer failed
확인|OK
확인해 주세요|Please check
지갑을 삭제할까요?|Delete this wallet?
확인을 위해 “삭제”를 입력해 주세요.|Type “DELETE” to confirm.
삭제|Delete
“삭제”를 정확히 입력해 주세요.|Please type “DELETE” exactly.
지갑 이름 변경|Rename wallet
새 지갑 이름|New wallet name
변경|Change
개인키를 확인할까요?|View your private key?
화면을 볼 수 있는 사람은 개인키로 자산을 가져갈 수 있습니다. 혼자 있는 안전한 장소에서만 확인해 주세요.|Anyone who can see your private key can take your assets. View it only in a safe, private place.
개인키 보기|View private key
아래 개인키를 오프라인의 안전한 장소에 보관하세요.|Keep this private key in a safe offline location.
개인키를 별도로 백업해 주세요|Keep a separate private key backup
PSL Wallet 사용자들에게…|To PSL Wallet users…
현재 지갑의 개인키는 암호화되어 이 브라우저 또는 PWA의 저장소에 보관됩니다. 방문 기록만 지우는 경우에는 보통 유지되지만, 쿠키 및 사이트 데이터 등 지갑이 저장된 데이터를 삭제하면 개인키도 삭제될 수 있습니다.|Your private key is encrypted in this browser or PWA storage. Clearing browsing history alone usually keeps it, but deleting cookies and site data may also delete your private key.
‘개인키 기기에 백업하기’를 누르면 개인키를 암호화된 파일로 기기에 별도 저장합니다. 이 파일은 브라우저의 사이트 데이터를 삭제해도 남습니다. 새 지갑을 만들거나 다른 개인키를 추가할 때마다 각각 백업해 주세요.|Select “Back up private key to device” to save a separate encrypted file. This file remains when browser site data is cleared. Back up each new or imported wallet separately.
개인키를 별도로 보관하는 것이 중요합니다. 기기 분실이나 고장에 대비해 백업 파일의 사본을 다른 안전한 장소에도 보관하세요.|Keeping a separate private key backup is essential. Store another copy in a safe place in case your device is lost or damaged.
다른 브라우저나 새 기기에서는 파일을 먼저 준비하고 ‘백업된 개인키 불러오기’를 누르세요. 백업 당시 비밀번호가 반드시 필요하며, 잊으면 이 파일로 복원할 수 없습니다. 지갑 잠금 비밀번호를 변경해도 파일의 비밀번호는 바뀌지 않습니다.|To restore in another browser or device, transfer the file and select “Import private key backup”. You need the original backup password; without it, you cannot restore this file. Changing your wallet password does not change the file password.
백업용 비밀번호 (10자 이상, 12자 이상 권장)|Backup password (10+ characters; 12+ recommended)
백업용 비밀번호 확인|Confirm backup password
지갑을 사용하려면 저장한 파일을 다시 선택하고 비밀번호를 입력하여 백업을 확인해 주세요. 이미 백업한 파일도 확인할 수 있습니다.|To use your wallet, select the saved file and enter its password to verify your backup. You may also verify an existing backup file.
저장한 백업 파일 확인하기|Verify saved backup file
다른 지갑 선택|Select another wallet
암호화된 백업 파일|Encrypted backup file
백업 당시 비밀번호|Original backup password
새 지갑 잠금 비밀번호 (10자 이상)|New wallet password (10+ characters)
새 지갑 잠금 비밀번호 확인|Confirm new wallet password
이 브라우저는 안전한 암호화 저장소를 지원하지 않습니다.|This browser does not support secure encrypted storage.
지원하지 않는 지갑 데이터입니다.|Unsupported wallet data.
지갑 데이터가 손상되었습니다.|Wallet data is damaged.
지갑 잠금을 먼저 해제해 주세요.|Unlock your wallet first.
설정에서 토큰 CID 또는 올바른 발행자 주소를 입력해 주세요.|Enter a token CID or valid issuer address in settings.
처리 중…|Processing…
이 브라우저는 안전한 지갑 생성을 지원하지 않습니다.|This browser does not support secure wallet creation.
수량을 숫자로 입력해 주세요.|Enter a numeric amount.
보유 수량이 부족합니다.|Insufficient balance.
네트워크 요청에 실패했습니다.|Network request failed.
토큰 잔액 형식이 올바르지 않습니다.|Invalid token balance format.
토큰 소수 자릿수가 설정과 일치하지 않습니다.|Token decimals do not match the settings.
지갑 이름을 입력해 주세요.|Enter a wallet name.
PSL 토큰 CID 또는 발행자 주소를 네트워크 설정에서 먼저 입력해 주세요.|Enter a PSL token CID or issuer address in network settings first.
지갑을 잠갔습니다.|Wallet locked.
조회 중|Loading
선택|Select
이름 변경|Rename
마지막 지갑은 여기서 삭제할 수 없습니다. 설정의 “이 기기에서 지갑 삭제”를 이용해 주세요.|You cannot delete the last wallet here. Use the delete-wallet option in settings.
백업하지 않은 개인키는 복구할 수 없습니다.|Private keys without a backup cannot be recovered.
연결 오류|Connection error
온라인|Online
연결 안 됨|Disconnected
오프라인|Offline
거래 조회 노드에 연결할 수 없습니다.|Cannot connect to a transaction lookup node.
만료된 거래는 다시 체결되지 않습니다. 내용을 확인한 뒤 새 거래를 전송하세요.|Expired transactions cannot be executed again. Review the details before sending a new transaction.
저장된 거래 정보가 올바르지 않아 다시 전파할 수 없습니다.|The saved transaction is invalid and cannot be rebroadcast.
거래 확인|Check transaction
다시 전파 중…|Rebroadcasting…
동일 해시 다시 전파|Rebroadcast same hash
전송 만료됨|Transfer expired
전송 확인 중|Transfer pending
유효시간 만료 · 체결 불가|Expired · cannot execute
네트워크 확인 대기 중|Awaiting network confirmation
새 거래 작성|Create new transaction
표시할 SL · PSL 송수신 이력이 없습니다.|No SL or PSL transfers to display.
보냄 ↗|Sent ↗
받음 ↙|Received ↙
알 수 없음|Unknown
수수료 계산 중…|Calculating fee…
수수료 확인 불가|Fee unavailable
거래 이력을 불러오는 중입니다.|Loading transaction history.
거래 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.|Could not load transaction history. Try again later.
아래로 당겨 새로고침|Pull down to refresh
놓아서 잔액 새로고침|Release to refresh balances
SL · PSL 잔액 갱신 중|Refreshing SL · PSL balances
잔액을 새로고침했습니다|Balances refreshed
개인키는 64자리 16진수여야 합니다.|The private key must contain 64 hexadecimal characters.
QR 코드를 생성할 수 없습니다.|Cannot generate a QR code.
주소를 복사했습니다.|Address copied.
복사할 수 없습니다. 주소를 길게 눌러 복사해 주세요.|Could not copy. Press and hold the address to copy it.
Safari에서 홈 화면 아이콘을 만들어 앱처럼 사용할 수 있습니다.|Add a home screen icon in Safari to use Wallet as an app.
설치 방법 확인|Installation instructions
브라우저 메뉴에서 앱 설치 또는 바로가기 만들기를 선택할 수 있습니다.|Select Install app or Create shortcut from your browser menu.
Wallet을 설치했습니다.|Wallet installed.
브라우저 메뉴의 “앱 설치” 또는 “바로가기 만들기”를 선택하세요.|Select “Install app” or “Create shortcut” in your browser menu.
비밀번호가 일치하지 않습니다.|Passwords do not match.
비밀번호를 10자 이상 입력해 주세요.|Enter a password of at least 10 characters.
지갑을 만들었습니다. 지금 개인키를 백업하세요.|Wallet created. Back up your private key now.
지갑을 안전하게 가져왔습니다.|Wallet imported securely.
비밀번호가 올바르지 않거나 지갑 데이터가 손상되었습니다.|Incorrect password or damaged wallet data.
먼저 지갑 잠금을 해제해 주세요.|Unlock your wallet first.
지갑 이름은 24자 이하로 입력해 주세요.|Wallet names must be 24 characters or fewer.
지갑 이름을 변경했습니다.|Wallet renamed.
이미 추가된 지갑입니다.|This wallet is already registered.
배포 환경에서는 HTTPS RPC만 사용할 수 있습니다.|Only HTTPS RPC endpoints are allowed on the deployed app.
CID는 64자리 16진수여야 합니다.|The CID must contain 64 hexadecimal characters.
발행자 주소를 확인해 주세요.|Check the issuer address.
설정을 저장했습니다.|Settings saved.
이 기기에서 모든 지갑을 삭제할까요?|Delete all wallets from this device?
백업하지 않은 지갑과 개인키는 복구할 수 없습니다.|Wallets and private keys without backups cannot be recovered.
이 기기에서 지갑을 삭제했습니다.|Wallet data deleted from this device.
수수료를 제외한 전송 가능 SL이 없습니다.|No SL is available to send after fees.
SL 최대 전송 금액을 계산하지 못했습니다.|Could not calculate the maximum SL transfer amount.
PSL은 소수점 이하 단위로 전송할 수 없습니다. 최소 송금 가능 금액은 1 PSL입니다.|PSL transfers must use whole units. The minimum transfer is 1 PSL.
PSL 송금 수량 확인|Check PSL transfer amount
받는 주소가 올바르지 않습니다.|Invalid recipient address.
내 주소로는 전송할 수 없습니다.|You cannot send to your own address.
0보다 큰 수량을 입력해 주세요.|Enter an amount greater than zero.
SL 수량과 네트워크 수수료를 합한 금액이 잔액을 초과합니다.|The SL amount plus network fee exceeds your balance.
기존 지갑을 보호하기 위해 먼저 잠금을 해제한 후 백업을 불러와 주세요.|Unlock your existing wallet before importing a backup to protect its data.
백업 비밀번호가 일치하지 않습니다.|Backup passwords do not match.
파일 저장을 요청했습니다. 다운로드 또는 내 파일에서 저장 위치를 확인한 뒤, 아래 버튼으로 해당 파일을 다시 열어 주세요.|File download requested. Find the file in Downloads or My Files, then reopen it using the button below.
백업 파일을 만들지 못했습니다. 비밀번호는 10자 이상이어야 합니다. 다시 시도해 주세요.|Could not create a backup. The password must be at least 10 characters. Please try again.
16KB 이하의 지갑 백업 파일을 선택해 주세요.|Choose a wallet backup file no larger than 16 KB.
새 잠금 비밀번호를 10자 이상 입력하고 동일하게 확인해 주세요.|Enter and confirm a new wallet password of at least 10 characters.
선택한 지갑의 백업 파일이 아닙니다.|This backup belongs to a different wallet.
백업 확인을 완료했습니다. 지갑을 사용할 수 있습니다.|Backup verified. You can now use your wallet.
이미 등록된 지갑의 백업을 확인했습니다.|Backup verified for an existing wallet.
백업 파일에서 지갑을 복원했습니다.|Wallet restored from backup.
비밀번호가 잘못되었거나 파일이 손상되었거나 저장 공간이 부족합니다. 기존 지갑은 유지됩니다.|Incorrect password, damaged file, or insufficient storage. Your existing wallets are preserved.
보안을 위해 기존 평문 키를 제거했습니다. 백업 키를 다시 가져와 주세요.|The old unencrypted key was removed for security. Import your backup key again.
`.trim().split('\n').map(line => line.split('|'));
  const dictionary = new Map(pairs);
  const koreanLabels = new Map([
    ['OPEN SOURCE · SELF CUSTODY', '오픈소스 · 개인키 직접 관리'], ['WELCOME BACK', '다시 오신 것을 환영합니다'],
    ['ACTIVE WALLET', '현재 지갑'], ['MAINNET', '메인넷'], ['TESTNET', '테스트넷'], ['QUICK ACCESS', '빠른 실행'], ['HISTORY', '거래 이력'],
    ['PREFERENCES', '설정'], ['APP REMOVAL & STORAGE', '앱 제거 및 저장소'], ['ADD WALLET', '지갑 추가'],
    ['WALLETS', '지갑 목록'], ['CREATE WALLET', '지갑 생성'], ['TRANSFER', '전송'], ['RECEIVE', '받기'],
    ['CONFIRM TRANSFER', '전송 확인'], ['TRANSFER STATUS', '전송 상태'], ['NOTICE', '안내'],
    ['SECURITY CHECK', '보안 확인'], ['EDIT WALLET', '지갑 편집'], ['PRIVATE KEY BACKUP', '개인키 백업'],
    ['PRIVATE KEY', '개인키'], ['TRANSFER PENDING', '전송 확인 대기'], ['TRANSFER EXPIRED', '전송 만료'],
    ['CHECKING TRANSACTION', '거래 확인 중'], ['TRANSFER COMPLETE', '전송 완료'], ['TRANSFER FAILED', '전송 실패']
  ]);
  const templates = [
    ['소수점은 최대 {0}자리까지 입력할 수 있습니다.', 'Use no more than {0} decimal places.'],
    ['PSL 컨트랙트를 확인할 수 없습니다: {0}', 'Cannot verify the PSL contract: {0}'],
    ['PSL 잔액을 확인할 수 없습니다: {0}', 'Cannot check the PSL balance: {0}'],
    ['{0} 지갑을 삭제할까요?', 'Delete wallet {0}?'],
    ['{0} 지갑을 삭제했습니다.', 'Wallet {0} deleted.'],
    ['{0}을 추가했습니다.', 'Added {0}.'],
    ['{0}을 생성했습니다. 개인키를 꼭 백업하세요.', 'Created {0}. Remember to back up its private key.'],
    ['기존 거래를 동일한 해시로 다시 전파하고 있습니다. 거래 해시: {0}', 'Rebroadcasting the existing transaction with the same hash: {0}'],
    ['기존 거래가 확인되었습니다. 거래 해시: {0}', 'Existing transaction confirmed. Hash: {0}'],
    ['기존 거래를 다시 전파했지만 아직 확인 중입니다. 새 거래는 생성되지 않았습니다. 거래 해시: {0}', 'Existing transaction rebroadcast; awaiting confirmation. No new transaction was created. Hash: {0}'],
    ['기존 거래의 유효 시간이 지나 노드가 거절했습니다. 이 해시는 더 이상 다시 전파하거나 체결할 수 없습니다. 거래 해시: {0}', 'The node rejected this expired transaction. It can no longer be rebroadcast or executed. Hash: {0}'],
    ['{0} 기존 해시는 보존되며 새 거래는 생성되지 않았습니다. 거래 해시: {1}', '{0} The existing hash is preserved; no new transaction was created. Hash: {1}'],
    ['{0} 전송 만료됨', '{0} transfer expired'], ['{0} 전송 확인 중', '{0} transfer pending'],
    ['받는 주소: {0}', 'Recipient: {0}'], ['보낸 주소: {0}', 'Sender: {0}'],
    ['{0} 아이콘', '{0} icon'], ['{0} 보냄 ↗', '{0} sent ↗'], ['{0} 받음 ↙', '{0} received ↙'],
    ['수수료 {0}', 'Fee {0}'], ['{0} 보내기', 'Send {0}'], ['{0} 받기', 'Receive {0}'],
    ['{0}을 받을 수 있는 SASEUL 주소입니다.', 'This SASEUL address can receive {0}.'],
    ['이미 접수된 동일 전송이 확인되었습니다. 거래 해시: {0}', 'The previously submitted matching transfer is confirmed. Hash: {0}'],
    ['동일한 전송이 이미 네트워크에 접수되어 확인 중입니다. 중복 전송을 막기 위해 다시 보내지 않았습니다. 거래 해시: {0}', 'A matching transfer is already awaiting confirmation. It was not sent again to avoid duplication. Hash: {0}'],
    ['PSL 전송 수수료 {0}를 낼 SL 잔액이 부족합니다.', 'Insufficient SL to pay the PSL transfer fee of {0}.'],
    ['{0} {1} 전송 요청을 처리하고 익스플로러에서 거래 해시를 확인하고 있습니다.', 'Processing the transfer of {0} {1} and checking its hash in the explorer.'],
    ['네트워크가 전송을 접수했지만 탐색기 반영을 기다리고 있습니다. 중복 전송하지 마세요. 거래 해시: {0}', 'The network accepted the transfer; awaiting explorer confirmation. Do not send it again. Hash: {0}'],
    ['{0} {1} 전송이 확인되었습니다. 거래 해시: {2}', 'Transfer of {0} {1} confirmed. Hash: {2}'],
    ['거래 유효 시간이 지나 노드가 거절했습니다. 이 거래는 체결되지 않으며 이력에서 새 거래를 작성할 수 있습니다. 거래 해시: {0}', 'The node rejected the expired transaction. It cannot execute. Create a new transaction from history. Hash: {0}'],
    ['{0} 중복 전송을 피하려면 이력 또는 익스플로러를 먼저 확인해 주세요.', '{0} Check history or the explorer first to avoid a duplicate transfer.']
  ].map(([ko, en]) => ({ ko, en, pattern: new RegExp('^' + ko.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$') }));
  let language = 'ko';
  try { if (localStorage.getItem('psl-wallet-language') === 'en') language = 'en'; } catch {}
  function translate(value) {
    if (language === 'ko') return koreanLabels.get(value) || value;
    if (dictionary.has(value)) return dictionary.get(value);
    for (const { pattern, ko, en } of templates) {
      const match = value.match(pattern);
      if (match) return en.replace(/\{(\d+)\}/g, (_, i) => {
        const argument = match[Number(i) + 1];
        if (argument === '알 수 없음') return 'Unknown';
        const errorArgument = Number(i) === 0 && (ko.startsWith('PSL 컨트랙트를') || ko.startsWith('PSL 잔액을') || ko.startsWith('{0} 기존 해시') || ko.startsWith('{0} 중복 전송'));
        return errorArgument && argument !== value ? translate(argument) : argument;
      });
    }
    return value;
  }
  const records = new WeakMap();
  const excluded = 'script, style, textarea, [translate="no"], #activeWalletName, .wallet-meta strong, .wallet-avatar, #privateKeyValue';
  const attributes = ['placeholder', 'aria-label', 'title', 'alt'];
  function applyValue(node, key, current, write) {
    const entries = records.get(node) || {};
    let entry = entries[key];
    if (!entry || current !== entry.output) entry = { source: current };
    const whitespace = entry.source.match(/^(\s*)([\s\S]*?)(\s*)$/);
    entry.output = whitespace[1] + translate(whitespace[2]) + whitespace[3];
    entries[key] = entry;
    records.set(node, entries);
    if (current !== entry.output) write(entry.output);
  }
  function render(root = document.body) {
    if (root.nodeType === 3) {
      if (root.parentElement && !root.parentElement.closest(excluded)) applyValue(root, 'text', root.nodeValue, value => { root.nodeValue = value; });
      return;
    }
    if (root.nodeType !== 1 || root.closest(excluded)) return;
    for (const attr of attributes) if (root.hasAttribute(attr)) applyValue(root, attr, root.getAttribute(attr), value => root.setAttribute(attr, value));
    for (const child of root.childNodes) render(child);
  }
  function update() {
    document.documentElement.lang = language;
    render();
    const button = document.getElementById('languageToggle');
    button.textContent = language === 'ko' ? 'ENG' : 'KOR';
    button.setAttribute('aria-label', language === 'ko' ? '언어: 한국어. 영어로 전환' : 'Language: English. Switch to Korean');
    document.getElementById('dangerConfirmPhrase').placeholder = language === 'ko' ? '삭제' : 'DELETE';
  }
  function setLanguage(value) {
    language = value === 'en' ? 'en' : 'ko';
    try { localStorage.setItem('psl-wallet-language', language); } catch {}
    if (typeof document !== 'undefined') {
      update();
      document.querySelectorAll('[data-timestamp]').forEach(element => {
        if (element.dataset.timestamp) element.textContent = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(element.dataset.timestamp)));
      });
      document.dispatchEvent(new Event('walletlanguagechange'));
    }
  }
  if (typeof document !== 'undefined') {
    document.getElementById('languageToggle').onclick = () => setLanguage(language === 'ko' ? 'en' : 'ko');
    update();
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') mutation.addedNodes.forEach(render);
        else render(mutation.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  }
  return { translate, setLanguage, get language() { return language; }, dictionary, templates };
})();
