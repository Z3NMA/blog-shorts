# Blog Shorts 데스크톱

Windows에서 네이버 블로그 글 주소를 받아 한국어 세로 MP4를 만듭니다. Tauri 화면에서 Rust가 기존 Node.js 엔진을 실행합니다. 대본 작성과 사진 순서 결정에는 DeepSeek API를 사용합니다.

## 영상 만들기

1. Windows x64용 `blog-shorts.zip`을 내려받아 압축을 풀고 `blog-shorts.exe`를 실행하세요. 첫 실행 때 필요한 파일을 자동으로 준비합니다. **API 키 및 저장 폴더**에서 본인 키를 입력하거나 `DEEPSEEK_API_KEY`와 `TYPECAST_API_KEY` 환경 변수를 사용하세요. [배포 페이지](https://github.com/Z3NMA/blog-shorts/releases/latest)
2. 공개 네이버 블로그 글 주소를 넣고 **확인**을 누르세요. 제목·첫 사진·원문 인용을 비교하고 **이 이야기로 대본 만들기**를 눌러 선택한 관점으로 장면별 본문과 마무리 멘트를 작성합니다.
3. **장면 검토**에서 모든 사진과 내레이션·자막을 순서대로 봅니다. **사진 바꾸기**에서 본문 사진을 고르고, 대사를 누르면 처음 인용한 구절과 현재 사진 주변의 원문을 읽으며 수정할 수 있습니다. 마지막 장면에는 이어서 읽을 추천 멘트가 있습니다. 직접 고치거나 **AI로 다시 쓰기**로 편집 중인 대본에 맞는 제안을 받으세요.
4. **편집 반영하고 스타일 선택**을 누르면 편집한 첫 장면으로 일곱 가지 미리보기를 만듭니다. 가운데 슬라이드나 **모두 보기**에서 스타일을 고르세요. **장면 다시 편집**으로 돌아가 추가로 고칠 수 있습니다.
5. **내레이션 목소리 → 목소리 고르기**에서 인기 24개를 보거나 **전체 보기**에서 계정에 있는 목소리를 이름으로 검색하세요. 카드의 별을 눌러 **즐겨찾기**에 저장하거나 해제할 수 있습니다. **공식 샘플 듣기**로 음색을 비교하거나, **내 대사로 듣기**로 첫 장면이나 입력한 문장을 들어보세요. 새 대사 합성에는 타입캐스트 API 크레딧이 쓰입니다. **이 목소리 사용**을 눌러 영상에 적용합니다. 시작 화면에서도 블로그 주소 없이 목소리를 비교할 수 있습니다.
6. **이 스타일로 제작**을 누르면 선택한 타입캐스트 목소리로 MP4를 만듭니다. 앱에서 완성 영상을 재생하거나 저장 폴더를 여세요. 기본 위치는 사용자 동영상 폴더의 `Blog Shorts`입니다.

같은 글을 열어 둔 동안 **이야기 다시 고르기**로 다른 후보를 비교할 수 있습니다. 새 후보의 대본 작성과 AI 마무리 다시 쓰기는 DeepSeek를 호출합니다. 앱을 열어 둔 동안에는 문장·목소리·모델이 같으면 미리 듣기와 영상 제작에서 같은 음성을 재사용합니다. 앱을 닫으면 임시 음성을 정리합니다. 편집한 대본과 선택한 스타일, 목소리 ID와 모델은 완성 파일 옆의 `.plan.json`에 저장됩니다.

제작을 시작하면 모든 장면의 사진을 먼저 읽어 확인합니다. 대본의 가격은 원문에 나온 대상·금액·조건과 대조합니다. 일시적인 HTTP 429는 서버의 대기 시간에 따라 최대 세 번 재시도하며 이미 완성된 장면 음성은 재사용합니다.

화면은 Windows의 밝기 설정을 따릅니다. 앱은 마지막으로 적용한 목소리와 스타일, 저장 폴더를 기억하며 직접 입력한 키는 세션 메모리에서만 사용합니다.

### 목소리 목록과 즐겨찾기

**인기**에서 캐릭터의 얼굴과 용도를 보고 카드를 선택하세요. **이 목소리 사용**을 누르면 카드에 **적용됨**이 표시됩니다. 공식 썸네일은 24개 목소리의 캐릭터 ID에 맞춰 원본 WebP 파일을 그대로 포함했습니다. 캐릭터 이미지 저작권은 네오사피엔스에 있으며 이 앱의 타입캐스트 콘텐츠 제작 화면에 사용됩니다. [타입캐스트 캐릭터 배포 안내](https://typecast.ai/kr/character/)

박창수·소진·필재 등 24개는 타입캐스트가 수상작, 인기 캐릭터 또는 쇼츠에서 주목받는 목소리로 소개한 캐릭터에서 골랐습니다. **전체 보기**는 앱을 연 뒤 처음 선택할 때 계정의 호환 목소리를 조회합니다. 이후 검색과 페이지 이동에는 저장된 목록을 사용하며, API 키를 바꾸면 다시 조회합니다. 전체 목록의 캐릭터 사진은 보이는 카드부터 표시합니다. 즐겨찾기는 이 기기에 저장되며 API 키 없이도 열어 볼 수 있습니다. 이전 버전에서 적용한 목소리도 해당 계정에서 계속 지원하면 그대로 제작에 쓸 수 있습니다. [2025 타입캐스트 어워즈](https://typecast.ai/kr/learn/2025_typecast_awards/) · [새 에디터 인기 캐릭터](https://typecast.ai/kr/learn/typecast-new-editor-characters/) · [유튜버가 고른 목소리](https://typecast.ai/kr/learn/most-popular-characters-of-typecast-in-2023/) · [쇼츠에서 주목받은 목소리](https://typecast.ai/kr/learn/typecast-ai-voice-growth-story/)

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

포터블 배포 파일은 `blog-shorts.exe` 한 개를 담은 `blog-shorts.zip`입니다. `desktop/release-tools/`에 `node.exe`, `ffmpeg.exe`, `WebView2Loader.dll`과 `notices/`를 두세요. `desktop/webview-x64/`에는 Microsoft의 x64 Fixed Version Runtime CAB를 풀어 `msedgewebview2.exe`가 바로 아래에 오도록 합니다. [Microsoft 배포 가이드](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

`desktop` 폴더에서 아래 명령을 실행하면 ZIP이 `dist/`에 생깁니다. `stage/`에는 패키징 중간 파일이 남습니다. ZIP을 확인한 뒤 다음 빌드 전에 이 폴더를 정리하세요.

```powershell
$null = New-Item -ItemType Directory -Path .\dist -Force
.\package-portable.ps1 -Executable .\src-tauri\target\release\blog-shorts.exe -RuntimeDirectory .\release-tools -FixedRuntimeDirectory .\webview-x64 -StageDirectory .\stage -OutputZip .\dist\blog-shorts.zip
```

현재 사용자용 설치본에 런타임을 포함하려면 `desktop/src-tauri/release-runtime/`에 Windows x64용 `node.exe`, `ffmpeg.exe`, `WebView2Loader.dll`과 `notices/`를 두고, Tauri 빌드 명령에 `--config src-tauri/release.windows.json`을 추가하세요.
