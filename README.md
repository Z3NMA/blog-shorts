# 블로그 쇼츠

공개 네이버 블로그 링크로 원문 사진과 한국어 내레이션을 담은 세로 MP4를 만듭니다. 사진은 장면마다 한 번 잘라 고정합니다.

## 데스크톱 앱

Windows 10/11 64비트 사용자는 [Releases](https://github.com/Z3NMA/blog-shorts/releases)에서 `Blog-Shorts-Setup-x64.exe`를 받아 설치한 뒤 시작 메뉴에서 **Blog Shorts**를 실행하세요. 설치본에 Node.js와 FFmpeg가 들어 있습니다. DeepSeek 음성은 본인의 API 키와 사용 가능 잔액이 필요합니다. Supertonic으로 새 음성을 합성할 때는 아래의 모델 설치 단계를 따르세요. 제천 비교 화면의 기존 Supertonic 샘플은 바로 재생됩니다.

Windows용 Tauri 앱에서 블로그 주소와 DeepSeek API 키를 입력하고 음성을 선택합니다. Rust가 로컬 렌더러를 실행합니다. DeepSeek Flash에는 글 제목, 사진 번호와 주변 문장을 보내 제목·사진 순서·대사·자막을 한 번에 요청합니다. 앱에서 영상을 만들 때 ChatGPT나 Codex 호출은 발생하지 않습니다.

음성까지 DeepSeek로 만들면 각 장면의 대사를 음성 API에 보냅니다. Stella와 Tide 중에서 선택할 수 있습니다. 무료 음성은 로컬 Supertonic 3 또는 Windows 한국어 음성을 사용합니다. MP4 합성은 모든 모드에서 로컬 FFmpeg가 수행합니다.

[데스크톱 실행 및 빌드 방법](desktop/README.md)

현재 대본 모델은 사진 앞뒤의 글을 읽어 사진을 고릅니다. 모델이 고른 사진 번호와 인용 문구를 입력 자료와 대조합니다. 인용 문구가 일치해도 장면 설명이나 가격에 오류가 있을 수 있습니다.

### 비용과 비교 방법

2026년 11월 24일 가격 기준으로 입력 3,000토큰·출력 1,000토큰에 캐시 할인을 적용하지 않은 Flash 대본 한 번은 약 $0.00105~0.00210입니다. 제천 예시 대본 327자에 DeepSeek 음성을 적용하면 할인 단가에서 약 $0.00736가 추가됩니다. 실제 비용은 토큰·글자 수와 청구 시점의 단가에 따릅니다. [대본·음성 요금표](https://api-docs.deepseek.com/quick_start/pricing/) · [음성 API 안내](https://api-docs.deepseek.com/guides/tts/)

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
