"""Precompute image/text cosine similarities on CPU. Only the small score table ships."""
import argparse
import hashlib
import json
from pathlib import Path
from shutil import copyfileobj
from urllib.request import urlopen

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[2]
REPO = "Xenova/siglip-base-patch16-224"
REV = "4649052661e53c7000355844105f8a1792088239"
FILE_HASHES = {
    "vision_model_quantized.onnx": "ef14a954f3d57e1806666432bd9785004c1dc27100aa260eee0cb0f10a5de058",
    "text_model_quantized.onnx": "ad0329b1f35acc66d8953ff2559ce358da8eb0a7011794cf951523d63a4dbce2",
    "tokenizer.json": "4a17c975210be5ab4c36b47d8dae4eefb866dbfb1e676e394aad85dc30a3ae08",
}
PROMPTS = {
    "chambers": "an anatomical illustration of the four chambers inside the human heart",
    "valves": "an anatomical illustration of four heart valves seen from above",
    "flow": "a diagram showing the direction of blood flow through the human heart",
}
FIGURES = ["m46676-fig-ch20_01_08", "m46676-fig-ch20_01_11"]


def model_file(cache, name):
    target = cache / Path(name).name
    if not target.exists():
        url = f"https://huggingface.co/{REPO}/resolve/{REV}/{name}"
        partial = target.with_suffix(".partial")
        with urlopen(url, timeout=120) as response, partial.open("wb") as out:
            copyfileobj(response, out)
        partial.replace(target)
    with target.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != FILE_HASHES[target.name]:
            raise ValueError(f"Unexpected file contents: {target}. Clear this cache file and retry.")
    return target


def embeddings(cache, name, inputs):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_file(cache, f"onnx/{name}_model_quantized.onnx")),
                                   options, providers=["CPUExecutionProvider"])
    values = session.run(["pooler_output"], {session.get_inputs()[0].name: inputs})[0]
    return values / np.linalg.norm(values, axis=1, keepdims=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    tokenizer = Tokenizer.from_file(str(model_file(args.cache, "tokenizer.json")))
    tokenizer.enable_padding(length=64, pad_id=1, pad_token="</s>")
    tokenizer.enable_truncation(max_length=64)
    tokens = np.array([row.ids for row in tokenizer.encode_batch(list(PROMPTS.values()))], dtype=np.int64)
    text = embeddings(args.cache, "text", tokens)
    images, hashes = [], {}
    for figure in FIGURES:
        file = ROOT / "dist" / (figure + ".jpg")
        hashes[figure] = hashlib.sha256(file.read_bytes()).hexdigest()
        with Image.open(file) as raw:
            resized = raw.convert("RGB").resize((224, 224), Image.Resampling.BICUBIC)
            images.append((np.asarray(resized, dtype=np.float32).transpose(2, 0, 1) / 127.5) - 1)
    vision = embeddings(args.cache, "vision", np.stack(images))
    scores = text @ vision.T
    index = {"model": REPO, "revision": REV, "prompts": PROMPTS, "sha256": hashes,
             "scores": {topic: {fid: round(float(scores[i,j]), 6) for j,fid in enumerate(FIGURES)}
                        for i,topic in enumerate(PROMPTS)}}
    (ROOT / "dist/cardio-figure-index.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    main()
