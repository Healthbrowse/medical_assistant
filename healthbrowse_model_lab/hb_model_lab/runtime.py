"""Local model execution. No Groq, production routes, API fallbacks, or secret reuse."""
import json
import re
import unicodedata
from pathlib import Path
from .contracts import Answer, Query, validate_answer
from .data import digest
from .prompts import messages
from .training import load_config


def safety_intercept(query: Query):
    text = unicodedata.normalize('NFKC', query.question).lower()
    text = re.sub('[\u200b-\u200f\ufeff]', '', text)
    dangerous = (
        r'\b(?:stitch|suture|operat\w*|surg\w*)\b.{0,90}\b(?:myself|yourself|at home|on my own)\b',
        r'\b(?:myself|at home|on my own)\b.{0,90}\b(?:stitch|suture|surgery)\b',
        r'\b(?:lethal|fatal)\s+(?:dose|dosage)\b',
        r'\b(?:how|steps|instructions)\b.{0,60}\b(?:kill myself|end my life|poison someone)\b',
    )
    if any(re.search(p, text, re.S) for p in dangerous):
        return Answer(status='refuse', message="I can help with health information, but cannot give instructions that could seriously harm you or someone else. For a wound or personal medical concern, seek professional care. If anyone is in immediate danger, contact local emergency services.")
    return None


def adapter_manifest(adapter, config, allow_smoke=False):
    adapter = Path(adapter)
    manifest = json.loads((adapter.parent / 'run-manifest.json').read_text())
    if manifest.get('status') != 'trained' or manifest.get('config') != config:
        raise ValueError('Adapter manifest must match the completed run and exact configuration')
    if manifest.get('smoke_only') and not allow_smoke:
        raise ValueError('Smoke-test weights are not a candidate model')
    if digest(adapter / 'adapter_model.safetensors') != manifest.get('adapter_sha256'):
        raise ValueError('Adapter artifact hash mismatch')
    if digest(adapter / 'adapter_config.json') != manifest.get('adapter_config_sha256'):
        raise ValueError('Adapter configuration hash mismatch')
    if json.loads((adapter / 'adapter_config.json').read_text()).get('base_model_name_or_path') != config['base_model']:
        raise ValueError('Adapter targets a different base model')
    return manifest

class ModelRunner:
    def __init__(self, config_path, adapter=None, baseline=False):
        if not adapter and not baseline:
            raise ValueError('Select an adapter or explicitly request the unmodified base-model baseline')
        self.config = c = load_config(config_path)
        self.manifest = adapter_manifest(adapter, c) if adapter else None
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        if not torch.cuda.is_available():
            raise RuntimeError('This inference profile requires a CUDA GPU')
        dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 and torch.cuda.is_bf16_supported() else torch.float16
        self.tokenizer = AutoTokenizer.from_pretrained(c['base_model'], revision=c['revision'], trust_remote_code=False)
        self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(c['base_model'], revision=c['revision'], trust_remote_code=False,
            device_map={'': 0}, torch_dtype=dtype, quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype))
        if adapter:
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, str(adapter), is_trainable=False)
        self.model.eval()
        self.model.config.use_cache = True

    def answer(self, query: Query):
        intercepted = safety_intercept(query)
        if intercepted:
            return intercepted
        prompt = self.tokenizer.apply_chat_template(messages(query), tokenize=True, add_generation_prompt=True, return_tensors='pt')
        if prompt.shape[-1] + self.config['max_new_tokens'] > self.config['inference_context_length']:
            raise ValueError('Context is too long; reduce supplied evidence instead of truncating the question')
        import torch
        prompt = prompt.to(self.model.device)
        with torch.inference_mode():
            result = self.model.generate(prompt, attention_mask=torch.ones_like(prompt), max_new_tokens=self.config['max_new_tokens'], do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id, eos_token_id=[self.tokenizer.eos_token_id, self.tokenizer.convert_tokens_to_ids('<|eot_id|>')])
        text = self.tokenizer.decode(result[0][prompt.shape[-1]:], skip_special_tokens=True)
        return validate_answer(json.loads(text), query)
