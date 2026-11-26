<p align="center">
  <img src="desktop/src-tauri/icons/icon.png" width="72" height="72" alt="">
</p>

<h1 align="center">Blog Shorts</h1>

<p align="center">
  공개 네이버 블로그 글을 한국어 내레이션과 자막이 있는 세로 영상으로 만듭니다.<br>
  원문 사진과 대사를 장면마다 편집하고, 목소리와 스타일을 골라 MP4로 저장하세요.
</p>

<p align="center">
  <strong><a href="https://github.com/Z3NMA/blog-shorts/releases/latest/download/blog-shorts.zip">Windows용 다운로드 (.zip)</a></strong> ·
  <a href="https://github.com/Z3NMA/blog-shorts/releases/latest">릴리스 노트</a> ·
  <a href="#cli-quickstart">API 키 없이 CLI로 시작하기</a>
</p>

## 첫 영상 만들기

**준비물**은 Windows 10/11 x64 PC, 사진이 담긴 공개 네이버 블로그 글, 본인의 DeepSeek·타입캐스트 API 키입니다. DeepSeek는 원문을 바탕으로 대본을 쓰고, 타입캐스트는 편집한 대사를 읽습니다. 두 서비스 모두 사용량에 따라 비용이 발생할 수 있습니다. [DeepSeek 키 발급](https://platform.deepseek.com/api_keys) · [타입캐스트 키 발급](https://studio.typecast.ai/developers/api/api-key)

1. **앱 열기** — `blog-shorts.zip`의 압축을 풀고 `blog-shorts.exe`를 실행하세요. 필요한 도구는 배포 파일에 들어 있으며, 첫 실행 때 사용자 폴더에 자동으로 준비됩니다.
2. **글 불러오기** — **API 키 및 저장 폴더**에 두 키를 입력하세요. 블로그 글 주소를 붙여 넣고 **확인**을 누르면 이야기 후보가 최대 세 개 나타납니다. 첫 사진과 원문 인용을 비교한 뒤 **이 이야기로 대본 만들기**를 누르세요.
3. **장면 편집하기** — **장면 검토**에서 사진을 바꾸거나 대사를 고치세요. **원문 확인**을 펼치면 선택한 사진 주변의 글을 읽을 수 있습니다. 여기서 고친 문장이 내레이션과 자막에 함께 쓰입니다.
4. **스타일과 목소리 고르기** — **편집 반영하고 스타일 선택**을 눌러 첫 장면을 일곱 가지 스타일로 비교하세요. **목소리 고르기**에서 **내 대사로 듣기**로 발음과 억양을 확인한 뒤 **이 목소리 사용**을 누르세요.
5. **영상 저장하기** — **이 스타일로 제작**을 누르세요. 완성된 영상은 앱에서 바로 재생할 수 있습니다. **저장 폴더 열기**를 누르면 MP4와 다시 편집할 수 있는 대본 파일(`.plan.json`)이 함께 있습니다.

기본 저장 위치는 사용자 **동영상** 폴더의 `Blog Shorts`입니다. 영상은 **720 × 1280 (9:16), 30 fps, H.264/AAC**로 저장됩니다. 장면 길이는 실제 내레이션에 맞춰 정해지고, 긴 대사는 최대 두 줄씩 나뉘어 표시됩니다.

<details>
<summary>API 키 보관과 사용량</summary>

앱에 직접 입력한 키는 앱을 닫을 때까지 메모리에만 보관합니다. PC에 `DEEPSEEK_API_KEY`와 `TYPECAST_API_KEY` 환경 변수를 설정해 두면 앱을 열 때마다 입력할 필요가 없습니다.

새 이야기의 대본을 만들거나 마지막 멘트를 **AI로 다시 쓰기** 하면 DeepSeek를 호출합니다. 사진 교체와 직접 편집은 로컬에서 처리합니다. **내 대사로 듣기**로 새 음성을 합성하면 타입캐스트 크레딧을 사용하며, 같은 실행 중에는 대사·목소리·모델이 같은 음성을 영상 제작에도 재사용합니다.

</details>

<a name="cli-quickstart"></a>

## CLI로 만들기

Windows에서 **Node.js 22 LTS 이상**과 **FFmpeg**(libass, libx264, AAC 지원)를 준비하세요. 기본 모드는 본문에서 대사를 추출해 PC에 설치된 한국어 데스크톱 음성으로 읽습니다. 이 음성은 Windows PowerShell 5.1에서 사용할 수 있어야 합니다. FFmpeg가 PATH에 없다면 PowerShell에서 `$env:FFMPEG = 'C:\도구\ffmpeg.exe'`처럼 실행 파일의 위치를 지정하세요.

PowerShell에서 다음 명령을 실행하면 저장소를 내려받고, 제천 바비큐 방문기를 예시 대본으로 읽은 `jecheon.mp4`를 만듭니다.

```powershell
git clone https://github.com/Z3NMA/blog-shorts.git
cd blog-shorts

$post = 'https://blog.naver.com/lumi6_6/224480520476'
node .\shorts.mjs $post .\jecheon.mp4 .\examples\jecheon.json
```

예시 대본의 첫 장면은 본문의 19번째 사진에 “제천 산골에서 이런 바비큐를 먹을 수 있다고요?”라는 대사를 붙입니다. `photo`는 1부터 시작하는 본문 사진 번호이고, `text`는 음성과 자막에 쓰이는 문장입니다. 장면 순서나 문장을 바꾸면 같은 글로 다른 영상을 만들 수 있습니다. [예시 대본 전체 보기](examples/jecheon.json)

**내 글로 만들 때**는 `$post`를 내 글 주소로 바꾸고 대본 인수를 생략하세요. 사진 뒤에 나오는 문장에서 최대 아홉 장면을 구성합니다. 사진 설명이 짧거나 원하는 대사가 따로 있다면 예시 형식으로 대본을 작성해 세 번째 인수로 전달하세요. 출력 파일명은 실행할 때마다 새 이름을 사용하세요.

```powershell
node .\shorts.mjs $post .\my-shorts.mp4
```

<details>
<summary>영상 스타일과 AI 음성 설정</summary>

| 바꾸고 싶은 항목 | PowerShell 환경 변수 |
| --- | --- |
| 영상 스타일 | `SHORTS_TEMPLATE`에 `white`(기본), `paper`, `grid`, `browser`, `blue`, `contrast`, `full` 중 하나를 지정 |
| AI 대본 | `SHORTS_PLANNER=deepseek`와 `DEEPSEEK_API_KEY` 설정 후 대본 파일 인수 생략 |
| 타입캐스트 음성 | `SHORTS_VOICE=typecast`, `TYPECAST_API_KEY`, `TYPECAST_VOICE_ID`, `TYPECAST_MODEL` 설정 |
| DeepSeek 음성 | `SHORTS_VOICE=deepseek`와 `DEEPSEEK_API_KEY` 설정. `DEEPSEEK_VOICE`는 `stella`(기본) 또는 `tide` |
| Gemini 음성 | `SHORTS_VOICE=gemini`와 `GEMINI_API_KEY` 설정 |

예를 들어 아래 명령은 제천 방문기를 ‘종이 매거진’ 스타일로 렌더링합니다.

```powershell
$env:SHORTS_TEMPLATE = 'paper'
node .\shorts.mjs https://blog.naver.com/lumi6_6/224480520476 .\jecheon-paper.mp4 .\examples\jecheon.json
```

앱의 설정을 그대로 쓰려면 새 PowerShell에서 `TYPECAST_API_KEY`를 설정하고 원래 글 주소와 함께 앱이 저장한 `.plan.json`을 세 번째 인수로 전달하세요. 파일에 선택한 스타일과 목소리 설정이 들어 있습니다.

</details>

<details>
<summary>로컬 AI 음성 사용하기 (Supertonic 3)</summary>

Python 3.12가 설치된 PC에서 아래 명령으로 라이브러리와 한국어 음성 모델을 한 번 내려받으세요.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install sherpa-onnx==2.0.3 numpy
curl.exe -fL https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 -o supertonic.tar.bz2
tar -xf supertonic.tar.bz2
```

새 PowerShell을 열 때마다 저장소 폴더에서 아래 환경 변수를 설정하세요. 음성은 CPU에서 합성하며, `SHORTS_SPEAKER`로 0~9번 화자를 선택할 수 있습니다. [한국어 음성 샘플](https://k2-fsa.github.io/sherpa/onnx/tts/all/Korean/supertonic-3-ko.html) · [모델 카드](https://huggingface.co/Supertone/supertonic-3)

```powershell
$env:SHORTS_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
$env:SUPERTONIC_MODEL = (Resolve-Path sherpa-onnx-supertonic-3-tts-int8-2026-05-11).Path
$env:SHORTS_SPEAKER = '2'
```

</details>

## 개발 및 리소스

- 영상 제작 코드는 [engine/](engine/), 예시 대본은 [examples/](examples/)에 있습니다. 저장소 루트에서 `node --test test/*.test.mjs`를 실행하면 회귀 테스트를 돌릴 수 있습니다. FFmpeg를 설정하면 사진 교체와 스타일 미리보기도 함께 검증합니다.
- 앱을 소스에서 실행하거나 Windows 배포 파일을 빌드하는 방법은 [데스크톱 개발 가이드](desktop/README.md)에 정리되어 있습니다.
- 영상에는 프리텐다드·고운바탕·주아 글꼴을 사용합니다. [글꼴 파일 및 배포 라이선스](engine/fonts/)
