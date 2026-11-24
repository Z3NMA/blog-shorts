"""Synthesize each scene using one local Supertonic 3 session."""
import json
import os
from pathlib import Path
import sys

import sherpa_onnx as sherpa


def main():
    scenes_path, output, model = map(Path, sys.argv[1:])
    networks = {
        name: str(model / f"{name}.int8.onnx")
        for name in ("duration_predictor", "text_encoder", "vector_estimator", "vocoder")
    }
    assets = sherpa.OfflineTtsSupertonicModelConfig(
        **networks,
        tts_json=str(model / "tts.json"),
        unicode_indexer=str(model / "unicode_indexer.bin"),
        voice_style=str(model / "voice.bin"),
    )
    config = sherpa.OfflineTtsConfig(model=sherpa.OfflineTtsModelConfig(
        supertonic=assets, provider="cpu", num_threads=4
    ))
    if not config.validate():
        raise ValueError(f"Incomplete Supertonic 3 model in {model}")
    generation = sherpa.GenerationConfig()
    generation.sid = int(os.getenv("SHORTS_SPEAKER", "2"))
    if not 0 <= generation.sid <= 9:
        raise ValueError("SHORTS_SPEAKER must be between 0 and 9.")
    generation.speed = 1.05
    generation.num_steps = 8
    generation.extra = {"lang": "ko"}
    engine = sherpa.OfflineTts(config)
    for i, scene in enumerate(json.loads(scenes_path.read_text(encoding="utf-8"))):
        audio = engine.generate(scene["text"], generation)
        if not len(audio.samples) or not sherpa.write_wave(
            str(output / f"{i}.wav"), audio.samples, audio.sample_rate
        ):
            raise RuntimeError(f"Failed to synthesize scene {i + 1}")


if __name__ == "__main__":
    main()
