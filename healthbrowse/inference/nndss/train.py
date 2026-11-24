"""Fit a separate LoRA adapter to each open checkpoint for four-way NNDSS classification."""
import argparse
import hashlib
import json
import random
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Mxfp4Config, set_seed

from prepare import LABELS, SEED, scores

# Immutable revisions of the three text generators listed in Buddy.
CHECKPOINTS = {
    "deepseek-ai/DeepSeek-R1-Distill-Llama-8B": "6a6f4aa4197940add57724a7707d069478df56b1",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B": "711ad2ea6aa40cfca18895e8aca02ab92df1a746",
    "openai/gpt-oss-120b": "b5c939de8f754692c1647ca79fbf85e8c1e70f8a",
}
CHOICES = [" A", " B", " C", " D"]


def encode(tokenizer, rows):
    candidate_ids = [tokenizer.encode(c, add_special_tokens=False) for c in CHOICES]
    if any(len(ids) != 1 for ids in candidate_ids) or len({ids[0] for ids in candidate_ids}) != len(LABELS):
        raise ValueError("The four answer choices must have distinct single-token IDs")
    candidate_ids = [ids[0] for ids in candidate_ids]
    examples = []
    for row in rows:
        prompt = ("Classify the reported weekly case count.\n" + row["text"] +
                  "\nA: no_reported_cases\nB: low\nC: medium\nD: high\nAnswer:")
        ids = tokenizer.encode(prompt, add_special_tokens=False)
        if not examples:  # All prompts have the same suffix.
            for choice, token in zip(CHOICES, candidate_ids):
                if tokenizer.encode(prompt + choice, add_special_tokens=False) != ids + [token]:
                    raise ValueError("Tokenizer merges across the answer boundary")
        if tokenizer.bos_token_id is not None:
            ids.insert(0, tokenizer.bos_token_id)
        examples.append((ids, LABELS.index(row["label"])))
    return examples, candidate_ids


def require_gpu(model_id):
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU. In Colab, choose Runtime > Change runtime type and select a GPU.")
    # Conservative floors for this single-GPU recipe, in free GiB (not advertised GB).
    required = {"deepseek-ai/DeepSeek-R1-Distill-Llama-8B": 8,
                "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B": 21,
                "openai/gpt-oss-120b": 75}[model_id]
    available = torch.cuda.mem_get_info(0)[0] / 2**30
    if available < required:
        raise RuntimeError(f"{model_id} needs at least {required} free GiB for this recipe; GPU has {available:.1f}.")
    if model_id == "openai/gpt-oss-120b":
        from transformers.utils import is_kernels_available, is_triton_available
        if torch.cuda.get_device_capability()[0] < 8 or not is_kernels_available() or not is_triton_available("3.4.0"):
            raise RuntimeError("GPT-OSS needs a BF16-capable GPU, kernels and Triton >=3.4 for frozen MXFP4 experts.")


def load_model(model_id):
    is_oss = model_id == "openai/gpt-oss-120b"
    bf16 = torch.cuda.get_device_capability()[0] >= 8 and torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    if is_oss:
        quant = Mxfp4Config(dequantize=False)
    else:
        quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                   bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype)
    model = AutoModelForCausalLM.from_pretrained(model_id, revision=CHECKPOINTS[model_id], dtype=dtype,
        quantization_config=quant, device_map={"": 0}, attn_implementation="eager", trust_remote_code=False)
    if not is_oss:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=False)
    return model


def attach_adapter(model):
    model.config.use_cache = False
    if model.config.model_type == "gpt_oss":
        # Only backpropagate through the output head. Frozen MXFP4 experts run forward only.
        targets = ["lm_head"]
    else:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        targets = ["q_proj", "v_proj"]
    return get_peft_model(model, LoraConfig(task_type="CAUSAL_LM", target_modules=targets,
                                            r=8, lora_alpha=16, bias="none"))


def logits_for_choices(model, ids, choices):
    device = model.get_input_embeddings().weight.device
    inputs = torch.tensor([ids], device=device)
    logits = model(input_ids=inputs, use_cache=False, logits_to_keep=1).logits[0, -1]
    return logits[choices].float()


def evaluate(model, examples, choices):
    model.eval()
    predictions = []
    with torch.no_grad():
        for ids, _ in examples:
            predictions.append(LABELS[logits_for_choices(model, ids, choices).argmax().item()])
    return scores([LABELS[label] for _, label in examples], predictions)


def fit(model, examples, choices, steps):
    model.train()
    if model.config.model_type == "gpt_oss":
        model.get_base_model().model.eval()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=2e-4, foreach=False)
    order = list(range(len(examples)))
    rng = random.Random(SEED)
    for step in range(steps):
        index = step % len(order)
        if index == 0:
            rng.shuffle(order)
        ids, label = examples[order[index]]
        logits = logits_for_choices(model, ids, choices)
        loss = torch.nn.functional.cross_entropy(logits[None, :], torch.tensor([label], device=logits.device))
        if not torch.isfinite(loss):
            raise RuntimeError("Non-finite classification loss")
        loss.backward()
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=CHECKPOINTS, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, help="Optimizer steps; defaults to one pass through train.jsonl")
    args = parser.parse_args()
    if args.out.exists() or (args.steps is not None and args.steps < 1):
        parser.error("Choose a new run directory and a positive step count")
    require_gpu(args.model)
    set_seed(SEED)
    benchmark_file = args.data / "benchmark.json"
    benchmark = json.loads(benchmark_file.read_bytes())
    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=CHECKPOINTS[args.model])
    splits = {}
    for name in ("train", "validation", "test"):
        raw = (args.data / (name + ".jsonl")).read_bytes()
        if hashlib.sha256(raw).hexdigest() != benchmark["splits"][name]["sha256"]:
            raise ValueError(f"Hash mismatch for {name}")
        splits[name], choices = encode(tokenizer, [json.loads(line) for line in raw.splitlines()])
    model = attach_adapter(load_model(args.model))
    args.out.mkdir(parents=True, exist_ok=False)
    steps = args.steps or len(splits["train"])
    result = {"base": args.model, "revision": CHECKPOINTS[args.model], "seed": SEED, "steps": steps,
              "benchmark_sha256": hashlib.sha256(benchmark_file.read_bytes()).hexdigest()}
    with model.disable_adapter():
        result["base_test"] = evaluate(model, splits["test"], choices)
    fit(model, splits["train"], choices, steps)
    model.save_pretrained(args.out / "adapter", safe_serialization=True, save_embedding_layers=False)
    for name in ("validation", "test"):
        result["adapter_" + name] = evaluate(model, splits[name], choices)
    (args.out / "metrics.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
