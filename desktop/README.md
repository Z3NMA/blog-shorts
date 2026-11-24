# Blog Shorts 데스크톱

Windows에서 네이버 블로그 글 주소를 받아 한국어 세로 MP4를 만듭니다. Tauri 화면에서 Rust가 기존 Node.js 엔진을 실행합니다. 대본 작성과 사진 순서 결정에는 DeepSeek API를 사용합니다.

## 영상 만들기

1. 앱에서 네이버 글 주소와 DeepSeek API 키를 입력합니다. 앱을 실행하기 전에 `DEEPSEEK_API_KEY` 환경 변수를 설정했다면 키 칸을 비울 수 있습니다.
2. 내레이션을 고릅니다. Stella와 Tide는 DeepSeek의 유료 음성입니다. Supertonic 3와 Windows 한국어 음성은 로컬에서 합성하며 대본 작성에만 API 요금이 듭니다.
3. **숏츠 만들기**를 누릅니다. 완성된 MP4는 기본적으로 사용자 동영상 폴더의 `Blog Shorts`에 저장됩니다. **저장 위치와 실행 설정**에서 변경할 수 있습니다.

앱에 입력한 API 키는 세션 메모리에서만 사용합니다. 음성 선택, 출력 폴더 및 도구 경로는 다음 실행을 위해 저장됩니다.

저장 폴더의 같은 이름을 가진 `.plan.json`에는 장면 순서와 대본이 들어 있습니다. 같은 대본으로 CLI에서 음성만 바꾸어 비교할 수 있습니다.

## 실행 환경

- Windows 10/11 x64 및 Microsoft Edge WebView2 런타임
- Node.js 22 이상, libass와 libx264가 포함된 FFmpeg
- Supertonic 선택 시 모델 폴더와 Python 환경을 먼저 준비합니다. [모델 설치 방법](../README.md)
- Windows 음성 선택 시 한국어 데스크톱 합성 음성이 필요합니다.

실행 파일과 같은 폴더에 `node.exe` 또는 `ffmpeg.exe`가 있으면 우선 사용합니다. 도구가 PATH에 있으면 파일 이름만으로도 실행할 수 있습니다. FFmpeg 경로는 화면에서 지정할 수 있습니다. Node.js 경로를 직접 지정할 때는 `SHORTS_NODE` 환경 변수를 사용합니다.

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

정적 화면은 실행 파일에 포함됩니다. 배포용 리소스는 레포 최상위의 엔진 모듈과 음성 스크립트를 `engine` 폴더에 담습니다. 수동으로 실행 파일을 복사할 때는 대상 폴더에 `engine`도 함께 복사하세요.

v0.2.0 사용자용 설치본은 추가 설정 `src-tauri/release.windows.json`으로 패키징합니다. `src-tauri/release-runtime`에 Windows x64용 Node.js 24.22.3의 node.exe, FFmpeg 9.0.2 essentials의 ffmpeg.exe, WebView2Loader.dll 및 notices 폴더의 배포 고지를 준비한 다음 위 빌드 명령에 `--config src-tauri/release.windows.json`을 추가하세요. 앱과 필수 실행 파일을 현재 사용자용으로 설치합니다.
