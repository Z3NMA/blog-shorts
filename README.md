# 블로그 쇼츠

공개 네이버 블로그 글 한 편을 한국어 음성, 자막, 원문 사진으로 구성한 세로 MP4로 만듭니다. 사진은 장면마다 한 번 잘라 고정합니다. 모델과 실행 패키지 설치 후에는 글과 사진을 받는 단계만 인터넷을 사용합니다.

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
