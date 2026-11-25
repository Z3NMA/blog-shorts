# 블로그 쇼츠

공개 네이버 블로그 링크로 원문 사진과 한국어 내레이션을 담은 세로 MP4를 만듭니다. 사진은 장면마다 한 번 잘라 고정합니다.

## 데스크톱 앱

Windows 10/11 x64에서는 **blog-shorts.zip**을 내려받아 압축을 풀고 **blog-shorts.exe**를 실행하세요. 첫 실행 때 앱이 사용자 폴더에 Node.js, FFmpeg, 글꼴과 WebView2를 풀고 다음 실행부터 재사용합니다. [Windows 배포 페이지](https://github.com/Z3NMA/blog-shorts/releases/latest)

Windows용 Tauri 앱에서 블로그 주소와 DeepSeek·Gemini API 키를 입력합니다. Rust가 로컬 렌더러를 실행합니다. 새 글의 기본 대본은 DeepSeek Flash를 세 번 호출해 만듭니다. 먼저 글 제목과 사진 주변 문장을 읽고 제목과 첫 사진 후보를 제안하면, 앱은 원문 인용이 확인된 첫 후보를 고릅니다. 두 번째 요청에서 장면별 대사를 씁니다. 세 번째 요청은 확정된 제목과 모든 장면의 대사·근거를 순서대로 읽고 시청자에게 건넬 추천 한마디를 작성합니다. 음성 합성에 보낸 대사를 화면에도 그대로 표시합니다. 긴 대사는 최대 두 줄씩 나누어 보여줍니다. 앱에서 영상을 만들 때 ChatGPT나 Codex 호출은 발생하지 않습니다.

앱 내 내레이션은 Gemini 3.8 Flash TTS의 Leda가 따뜻하고 차분하게 읽습니다. 음성 생성 시 평소 대화보다 약 10% 빠르게 말하고 뜻이 바뀔 때만 짧게 쉬며 어미를 간결하게 맺도록 지시합니다. 기본 음높이는 살짝 낮게 잡고 핵심 단어에서만 음을 조금 올립니다. CLI에서도 `SHORTS_VOICE=gemini`와 `GEMINI_API_KEY`를 설정하면 같은 내레이션을 렌더링합니다. [Google 음성 생성 문서](https://ai.google.dev/gemini-api/docs/speech-generation)

글 주소를 확인하면 DeepSeek가 대본을 생성하고 첫 장면을 일곱 가지 스타일로 미리 보여줍니다. 중앙 슬라이드나 **모두 보기**에서 고른 스타일로 제작하세요. 같은 글의 완성 화면에서 스타일을 다시 고르면 사진·대본·음성을 재사용합니다. 스타일마다 사진 영역, 제목, 자막 및 배경이 함께 바뀝니다. CLI의 `SHORTS_TEMPLATE` 값은 `white`, `paper`, `grid`, `browser`, `blue`, `contrast`, `full`입니다. 세로 MP4와 미리보기는 같은 렌더링 정의를 사용합니다.

패키지의 `fonts` 폴더에 프리텐다드, 고운바탕, 주아 글꼴과 각각의 배포 라이선스가 있습니다.

[데스크톱 실행 및 빌드 방법](desktop/README.md)

새 대본을 만들 때는 본문 사진 중 블로그 링크의 대표 이미지와 일치하는 사진이나 파일명에 썸네일 표시가 있는 표지를 거릅니다. 일반 사진 한 장만 올린 글은 그 사진을 사용합니다. 마지막 장면에서는 경험이나 팁을 전한 뒤, 이 장소나 메뉴가 어울리는 시청자에게 방문이나 시식을 자연스럽게 권합니다. 이 끝맺음까지 같은 장면의 내레이션과 자막에 담습니다.

스타일 선택 화면의 **사진 바꾸기**에서 첫 사진을 고를 수 있습니다. 마지막 멘트는 직접 고치거나 **AI로 다시 쓰기**로 대본 전체에 어울리는 제안을 받을 수 있습니다. 직접 편집한 멘트는 제작 버튼을 누르면 반영됩니다.

앱은 사진 번호·인용과 함께 가격 문장의 대상·금액·조건을 원문과 대조합니다. 가격 검증에 실패하면 본문 집필을 한 번 더 요청할 수 있고, AI로 마지막 멘트를 다시 쓰는 경우에도 별도 요청이 발생합니다. 음성 합성 전에는 선택한 사진 전체를 FFmpeg로 확인합니다.

### 비용과 비교 방법

2026년 11월 24일 가격 기준으로 입력 3,000토큰·출력 1,000토큰에 캐시 할인을 적용하지 않은 Flash 요청 한 번은 약 $0.00105~0.00210입니다. 새 대본의 비용은 기획, 본문 집필, 마무리 작성에 사용한 세 요청의 사용량을 합산합니다. 제천 예시 대본 327자에 DeepSeek 음성을 적용하면 할인 단가에서 약 $0.00736가 추가됩니다. 실제 비용은 토큰·글자 수와 청구 시점의 단가에 따릅니다. [대본·음성 요금표](https://api-docs.deepseek.com/quick_start/pricing/) · [음성 API 안내](https://api-docs.deepseek.com/guides/tts/)

같은 대본으로 음성을 비교하려면 아래 CLI의 세 번째 인수로 `jecheon.json` 또는 이전 실행에서 생성된 `plan.json`을 지정하세요. 대본 작성을 건너뛰고 동일한 문장을 읽으므로 가격·음식 이름의 발음, 문장 끝 억양, 장면 사이 호흡을 직접 비교할 수 있습니다.

```powershell
# DEEPSEEK_API_KEY 환경변수가 설정된 PowerShell에서 실행
$env:SHORTS_VOICE = 'deepseek'
$env:DEEPSEEK_VOICE = 'stella'
node shorts.mjs https://blog.naver.com/lumi6_6/224480520476 stella.mp4 jecheon.json
```

CLI에서 대본까지 새로 생성하려면 `SHORTS_PLANNER=deepseek`를 환경변수로 설정하고 대본 파일 인수를 생략하세요. 기본 CLI는 키 없이 기존 로컬 대본 추출 방식을 사용합니다.

## 준비

Windows 64비트, Node.js 22, FFmpeg가 필요합니다. FFmpeg는 libass, libx264, AAC를 지원하는 빌드를 사용하세요. ffmpeg.exe가 PATH에 없으면 PowerShell에서 `$env:FFMPEG = 'C:\도구\ffmpeg.exe'`로 위치를 지정하세요.

### 무료 로컬 AI 음성

Python 3.12가 설치된 PC에서 아래 명령을 레포 폴더에서 실행하세요. 모델과 라이브러리는 처음 한 번 받습니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install sherpa-onnx==2.0.3 numpy
curl.exe -fL https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 -o supertonic.tar.bz2
tar -xf supertonic.tar.bz2
```

PowerShell을 새로 열 때는 레포 폴더에서 다음 설정을 적용하고 아래 사용 예시를 실행하세요.

```powershell
$env:SHORTS_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
$env:SUPERTONIC_MODEL = (Resolve-Path sherpa-onnx-supertonic-3-tts-int8-2026-05-11).Path
$env:SHORTS_SPEAKER = '2'
```

화자 번호는 0~9입니다. SUPERTONIC_MODEL을 설정하면 한국어 Supertonic 3를 CPU에서 실행합니다. 해당 변수를 생략하면 Windows PowerShell 5.1과 설치된 한국어 데스크톱 음성을 사용합니다. [한국어 음성 샘플](https://k2-fsa.github.io/sherpa/onnx/tts/all/Korean/supertonic-3-ko.html) · [모델 카드](https://huggingface.co/Supertone/supertonic-3)

## 사용

이 폴더에서 실행하세요. 마지막 파일명은 새로 만들 영상의 경로입니다.

```powershell
node shorts.mjs https://blog.naver.com/lumi6_6/224480520476 my-shorts.mp4
```

자동 모드는 네이버 스마트에디터의 사진 순서와 뒤따르는 문단을 읽습니다. 사진별로 길이와 어미 조건에 맞는 문장을 찾아 최대 아홉 장면으로 구성합니다. 사진 내용을 시각적으로 판별하거나 새 대사를 쓰는 모델은 사용하지 않습니다. 이미지 뒤에 관련 설명이 적은 글은 직접 대본을 주는 편이 낫습니다.

## 대본을 다듬어 렌더링하기

```powershell
node shorts.mjs https://blog.naver.com/lumi6_6/224480520476 edited.mp4 jecheon.json
```

jecheon.json은 같은 글을 바탕으로 제목과 대사를 편집한 예시입니다. photo는 본문에 나오는 사진 번호이며 1부터 시작합니다. text가 음성과 자막에 함께 쓰입니다. 제목의 줄바꿈으로 두 줄 배치를 지정할 수 있습니다.

출력은 720×1280, 초당 30프레임의 H.264 영상입니다. 장면 전환은 합성 음성의 실제 길이에 맞추고, 한 장면 안의 긴 자막은 글자 수에 따라 나눠 표시합니다. 콘솔에 표시된 임시 작업 폴더에는 대본과 장면별 음성·영상이 남습니다. 렌더링 후 삭제해도 됩니다.
