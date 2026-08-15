# PSL Wallet

SASEUL 네트워크의 PSL 토큰과 SL을 관리하는 오픈소스 셀프 커스터디 PWA 지갑입니다. 별도 앱스토어 없이 브라우저에서 설치할 수 있으며, 서버가 사용자의 개인키를 보관하지 않습니다.

## 주요 기능

- PSL 및 네이티브 SL 잔액 조회·전송·수신
- 모바일과 데스크톱에 설치 가능한 PWA
- PBKDF2-SHA256(310,000회) + AES-256-GCM 개인키 암호화
- 복호화 키의 메모리 내 보관 및 5분 미사용 자동 잠금
- Mainnet/Testnet 및 사용자 지정 HTTPS RPC 지원
- CSP, 클릭재킹 방지, 최소 권한 브라우저 정책

## 보안 모델

개인키는 사용자가 정한 비밀번호로 브라우저에서 암호화된 후 암호문만 `localStorage`에 저장됩니다. 비밀번호와 복호화된 개인키는 서버로 전송하지 않습니다. 블록체인 요청은 설정한 SASEUL RPC로 브라우저에서 직접 전송됩니다.

중요한 한계도 있습니다.

- 웹 지갑은 악성 브라우저 확장, 감염된 기기, 피싱 사이트, 공급망 공격으로부터 절대적인 안전을 보장하지 않습니다.
- 비밀번호와 개인키를 모두 잃으면 누구도 지갑을 복구할 수 없습니다.
- 큰 금액은 하드웨어 또는 오프라인 지갑 사용을 권장합니다.
- 배포 전 독립적인 보안 감사를 권장합니다. 취약점 제보는 [SECURITY.md](SECURITY.md)를 참고하세요.

## 로컬 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
npm test
npm start
```

브라우저에서 `http://localhost:4173`을 엽니다. 실제 PWA 설치와 Web Crypto 동작에는 HTTPS 또는 localhost 보안 컨텍스트가 필요합니다.

## GitHub Pages 배포

1. 저장소를 GitHub에 push합니다.
2. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
3. `main` 브랜치 변경 시 `.github/workflows/deploy-pages.yml`이 검증 후 `pwa/`를 배포합니다.
4. 배포 주소에서 RPC, PSL 발행자 주소/공간명 또는 CID를 설정하고 소액으로 먼저 검증합니다.

프로덕션에서는 고정된 배포 도메인, HTTPS, 브랜치 보호, Dependabot, 필수 리뷰, 서명된 릴리스를 함께 사용하는 것이 좋습니다. GitHub Pages는 사용자 지정 응답 헤더가 제한되므로 CSP는 HTML에도 포함되어 있습니다. 더 엄격한 헤더 제어가 필요하면 Cloudflare Pages 같은 정적 호스트를 사용하세요.

## 프로젝트 구조

- `pwa/`: 정적 웹 지갑과 서비스 워커
- `tools/`: SASEUL 개발 도구
- `example/`, `event/`, `system/`: 원본 SASEUL 샘플 컨트랙트
- `.github/workflows/`: 검증 및 GitHub Pages 배포 자동화

## 공개 전 체크리스트

- [ ] 실제 PSL CID와 신뢰할 수 있는 RPC를 검증
- [ ] 테스트넷과 소액 메인넷 전송 테스트
- [ ] 모바일 Safari/Chrome 및 데스크톱 브라우저 PWA 점검
- [ ] 독립 보안 감사와 의존성 검토
- [ ] 저장소의 GitHub Pages, 브랜치 보호, Dependabot 활성화
- [ ] 공식 도메인과 저장소 URL을 커뮤니티에 고정 공지
- [ ] 릴리스 태그와 배포 커밋 해시 공개

## 기여와 라이선스

[CONTRIBUTING.md](CONTRIBUTING.md)를 따라 이슈와 Pull Request를 보내주세요. MIT License로 배포됩니다. PSL Wallet은 Gaebal2가 관리하는 독립 프로젝트입니다. 포함된 SASEUL 샘플 코드의 출처와 저작권은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 명시합니다.
