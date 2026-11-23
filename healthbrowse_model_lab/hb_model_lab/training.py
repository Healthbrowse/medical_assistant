"""Independent single-GPU QLoRA training; never calls the production provider."""
import importlib.util
import json
import platform
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from .data import read_jsonl, validate_rows, validate_splits, encode_row, digest


def load_config(path):
    c = json.loads(Path(path).read_text())
    if c.get("production_routing") is not False or c.get("method") != "qlora":
        raise ValueError("This project only permits isolated QLoRA research runs")
    if not re.fullmatch(r"[0-9a-f]{40}", c.get("revision", "")):
        raise ValueError("Pin a full reviewed base-model commit")
    if c.get("roles") != ["general", "clinician"]:
        raise ValueError("Exactly General and Clinicians are supported")
    if not 512 <= c["max_length"] <= 8192 or not 32 <= c["max_new_tokens"] < c["inference_context_length"] <= 8192:
        raise ValueError("Invalid context or output limits")
    for field in ["lora_rank", "lora_alpha", "learning_rate", "epochs", "batch_size", "gradient_accumulation_steps"]:
        if c[field] <= 0:
            raise ValueError(f"{field} must be positive")
    return c


def preflight(config_path):
    c = load_config(config_path)
    result = {"base_model": c["base_model"], "revision": c["revision"], "python": platform.python_version(), "production_routing": False,
              "packages": {name: bool(importlib.util.find_spec(name)) for name in ["torch", "transformers", "peft", "bitsandbytes", "accelerate"]}, "cuda": False, "training_started": False}
    if result["packages"]["torch"]:
        import torch
        result["cuda"] = torch.cuda.is_available()
        if result["cuda"]:
            result["gpu"] = torch.cuda.get_device_name(0)
            result["vram_gib"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
    return result


def train(config_path, train_path, validation_path, output, smoke=False):
    c = load_config(config_path)
    train_rows = validate_rows(read_jsonl(train_path), allow_examples=smoke)
    val_rows = validate_rows(read_jsonl(validation_path), allow_examples=smoke)
    validate_splits(train_rows, val_rows)
    if set(r["input"]["role"] for r in train_rows) != set(c["roles"]):
        raise ValueError("Training data must include both audiences")
    output = Path(output)
    if output.exists():
        raise ValueError("Choose a new run directory; existing artifacts are never overwritten")
    check = preflight(config_path)
    if not check["cuda"] or not all(check["packages"].values()):
        raise RuntimeError("CUDA GPU and the [train] dependencies are required. Run hb-model preflight.")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer, TrainingArguments, DataCollatorForSeq2Seq, set_seed
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from importlib.metadata import version
    set_seed(c["seed"])
    bf16 = torch.cuda.get_device_capability()[0] >= 8 and torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    tokenizer = AutoTokenizer.from_pretrained(c["base_model"], revision=c["revision"], trust_remote_code=False)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    encoded_train = [encode_row(r, tokenizer, c["max_length"]) for r in train_rows]
    encoded_val = [encode_row(r, tokenizer, c["max_length"]) for r in val_rows]
    output.mkdir(parents=True, exist_ok=False)
    manifest = {"status": "training", "config": c, "created_at": datetime.now(timezone.utc).isoformat(),
                "train_sha256": digest(train_path), "validation_sha256": digest(validation_path), "train_examples": len(train_rows), "validation_examples": len(val_rows),
                "code_commit": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip() or "untracked",
                "smoke_only": smoke, "clinical_validation": "not_performed", "production_approved": False,
                "packages": {p: version(p) for p in ["torch", "transformers", "peft", "bitsandbytes", "accelerate"]}}
    manifest_path = output / "run-manifest.json"
    def save():
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    save()
    try:
        model = AutoModelForCausalLM.from_pretrained(c["base_model"], revision=c["revision"], trust_remote_code=False,
            device_map={"": 0}, torch_dtype=dtype, quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype))
        model.config.use_cache = False
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
        model = get_peft_model(model, LoraConfig(r=c["lora_rank"], lora_alpha=c["lora_alpha"], lora_dropout=c["lora_dropout"], target_modules="all-linear", task_type="CAUSAL_LM", bias="none"))
        args = TrainingArguments(output_dir=str(output / "checkpoints"), per_device_train_batch_size=c["batch_size"], per_device_eval_batch_size=1,
            gradient_accumulation_steps=c["gradient_accumulation_steps"], learning_rate=c["learning_rate"], num_train_epochs=c["epochs"],
            max_steps=1 if smoke else -1, bf16=bf16, fp16=not bf16, gradient_checkpointing=True, optim="paged_adamw_8bit",
            eval_strategy="epoch", save_strategy="epoch", save_total_limit=2, logging_steps=1 if smoke else 10, report_to="none", seed=c["seed"], data_seed=c["seed"])
        trainer = Trainer(model=model, args=args, train_dataset=encoded_train, eval_dataset=encoded_val, processing_class=tokenizer,
                          data_collator=DataCollatorForSeq2Seq(tokenizer, padding=True, label_pad_token_id=-100))
        trained = trainer.train()
        metrics = trainer.evaluate()
        adapter = output / "adapter"
        trainer.save_model(str(adapter))
        tokenizer.save_pretrained(adapter)
        if not (adapter / "adapter_model.safetensors").is_file():
            raise RuntimeError("Trainer did not save adapter weights")
        manifest.update(status="trained", training_metrics=trained.metrics, evaluation_metrics=metrics,
                        adapter_sha256=digest(adapter / "adapter_model.safetensors"),
                        adapter_config_sha256=digest(adapter / "adapter_config.json"))
        save()
        return manifest
    except Exception:
        manifest["status"] = "failed"
        save()
        raise
