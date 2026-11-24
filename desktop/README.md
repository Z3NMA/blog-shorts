# Blog Shorts 데스크톱

Windows에서 네이버 블로그 글 주소를 받아 한국어 세로 MP4를 만듭니다. Tauri 화면에서 Rust가 기존 Node.js 엔진을 실행합니다. 대본 작성과 사진 순서 결정에는 DeepSeek API를 사용합니다.

## 영상 만들기

1. [Windows x64용 blog-shorts.exe](https://github.com/Z3NMA/blog-shorts/releases/latest/download/blog-shorts.exe)를 내려받아 실행하세요. 첫 실행 때 필요한 파일을 자동으로 준비합니다. **API 키 및 저장 폴더**에서 본인 키를 입력하거나 `DEEPSEEK_API_KEY`와 `GEMINI_API_KEY` 환경 변수를 사용하세요.
2. 공개 네이버 블로그 글 주소를 넣고 **확인**을 누르세요. 여기서 DeepSeek가 대본을 한 번 생성합니다. 첫 장면의 실제 사진, 제목, 대사로 일곱 가지 미리보기를 만듭니다.
3. 좌우로 밀거나 화살표 키·버튼으로 넘기세요. 가운데 카드가 선택됩니다. **모두 보기**에서 카드를 눌러도 됩니다.
4. **이 스타일로 제작**을 누르면 Gemini 3.8 Flash TTS의 Leda가 쇼호스트 톤으로 읽고 FFmpeg가 MP4를 만듭니다. 앱에서 완성 영상을 재생하거나 저장 폴더를 여세요. 기본 위치는 사용자 동영상 폴더의 `Blog Shorts`입니다. 설정의 **폴더 선택**을 누르면 Windows 탐색기에서 저장 위치를 바꿀 수 있습니다.

현재 글을 열어 둔 동안 **스타일 다시 고르기**로 새 파일을 만들면 기존 사진·대본·음성을 재사용합니다. 다른 글을 확인하거나 앱을 닫으면 임시 작업을 정리합니다. 대본과 선택한 스타일은 완성 파일 옆의 `.plan.json`에도 저장됩니다.

화면은 Windows의 밝기 설정을 따릅니다. 앱은 마지막으로 선택한 스타일과 저장 폴더를 기억하며 직접 입력한 키는 세션 메모리에서만 사용합니다.

## 실행 환경

Windows 10/11 x64용 단일 EXE에는 앱, Node.js, FFmpeg, Microsoft WebView2 고정 버전, 템플릿, 글꼴과 배포 고지가 들어 있습니다. 첫 실행 때 현재 사용자 계정의 `%LOCALAPPDATA%\Blog Shorts\runtime`에 파일을 준비합니다. 다음 실행부터 같은 버전의 파일을 재사용합니다. 캐시를 정리하려면 앱을 종료한 뒤 이 폴더를 삭제하세요. 블로그 조회와 AI 대본·음성 생성에는 인터넷이 필요합니다.

## 개발 및 빌드

일반적인 Windows Tauri 빌드 환경에는 Rust, MSVC C++ 빌드 도구 및 Windows SDK가 필요합니다. [Tauri 빌드 환경](https://v2.tauri.app/start/prerequisites/)

`desktop` 폴더에서 다음 명령을 실행합니다.

```powershell
npm exec --yes --package=@tauri-apps/cli@2 -- tauri dev
```

설치 프로그램을 만들 때는 같은 폴더에서 다음 명령을 실행합니다.

```powershell
npm exec --yes --package=@tauri-apps/cli@2 -- tauri build
```

단일 파일을 패키징할 때는 Windows x64 릴리즈 빌드, 기존 포터블 런타임 폴더(`node.exe`, `ffmpeg.exe`, `WebView2Loader.dll`, `notices`), Microsoft의 x64 Fixed Version Runtime CAB를 푼 폴더(`msedgewebview2.exe` 포함)를 준비하세요. 배포를 갱신할 때 고정 런타임 버전도 함께 갱신하세요. [Microsoft 배포 가이드](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

```powershell
.\package-portable.ps1 -Executable .\src-tauri\target\release\blog-shorts.exe -RuntimeDirectory .\release-tools -FixedRuntimeDirectory .\webview-x64 -StageDirectory .\stage -OutputExe .\blog-shorts.exe
```

v0.2.0 사용자용 설치본은 추가 설정 `src-tauri/release.windows.json`으로 패키징합니다. `src-tauri/release-runtime`에 Windows x64용 Node.js 24.22.3의 node.exe, FFmpeg 9.0.2 essentials의 ffmpeg.exe, WebView2Loader.dll 및 notices 폴더의 배포 고지를 준비한 다음 위 빌드 명령에 `--config src-tauri/release.windows.json`을 추가하세요. 앱과 필수 실행 파일을 현재 사용자용으로 설치합니다.
