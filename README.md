# 문서함

한글 문서, Office 파일, 표, PDF와 코드를 한 브라우저 탭에서 작업하는 React·TypeScript 웹앱입니다. 편집한 파일은 사본으로 내려받습니다. 문서 변환과 Python 실행은 브라우저 안에서 처리합니다.

## 실행

```powershell
npm ci
npm run prepare:runtime
npm run dev
```

런타임 준비 단계에서 공식 rhwp 웹 자산을 가져오고, 설치된 Python·PDF 런타임을 정적 파일로 복사합니다. 한글 엔진이 사용하는 Studio와 글꼴도 앱과 같은 주소에서 제공됩니다. 준비한 뒤에는 `npm run build`로 `dist` 정적 사이트를 만들 수 있습니다.

## 현재 지원

- **한글** · HWPX 새 문서와 편집, HWP 및 호환 HWT·OWPML 열기와 HWPX 사본 저장. 본문, 글자·문단 모양, 표, 그림, 쪽과 머리말·꼬리말을 편집합니다. 한글 파일 버전과 포함된 개체에 따라 변환 결과가 달라질 수 있습니다.
- **Office** · DOCX 본문·정렬·기본 서식·표, XLSX 셀·배경색·기본 수식, PPTX 슬라이드 순서·텍스트·도형 배치·이미지 교체, CSV·TSV 편집. Office의 고급 조판·수식은 편집 화면에서 표시가 제한됩니다.
- **코드** · 텍스트 검색과 구문 강조, 인코딩 및 줄바꿈을 유지한 저장. Python 표준 라이브러리를 사용할 수 있으며 실행할 때마다 독립된 환경에서 시작합니다.
- **보기** · PDF 페이지 탐색과 텍스트 검색, 주요 이미지, ODF, 일부 구형 Office, DRM 없는 EPUB, SQLite, 이메일 등. 파일 형식 창에서 전체 후보 형식과 현재 열기 상태를 검색할 수 있습니다. Google Drive 바로가기와 일부 폐쇄 형식은 준비 중입니다.

## 검증

```powershell
npm run build
npm test
```

테스트는 설치된 Windows Chrome과 Edge에서 실행합니다. 브라우저 조합 이벤트를 사용한 한글 입력, HWPX 저장과 HWP 변환, Office 사본 재열기, PDF 검색, Python 격리와 중지를 검증합니다.

한글 편집은 [rhwp](https://github.com/edwardkim/rhwp)를 사용합니다. 이 프로젝트는 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고한 rhwp를 기반으로 한글 파일을 처리합니다.

