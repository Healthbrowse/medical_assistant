"""Run in this directory with the training dependencies installed."""
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from prepare import make_splits, modeling_rows


class WeeklyDataTest(unittest.TestCase):
    def test_flags_gaps_and_temporal_cutoffs(self):
        raw = []
        for year in (2024, 2025, 2026):
            for week, count, flag in [(1, 2, "-"), (2, None, "-"), (3, None, "U"),
                                      (4, 9 if year == 2024 else 9000, ""), (5, None, "N")]:
                raw.append(dict(label="Example", states="Area", year=year, week=week, m1=count, m1_flag=flag))
        frame = modeling_rows(pd.DataFrame(raw))
        self.assertEqual(frame.week.tolist(), [1, 2, 4] * 3)
        self.assertEqual(frame[frame.week == 2]["count"].tolist(), [0] * 3)
        self.assertEqual(frame[frame.week == 2].previous.tolist(), [2] * 3)
        self.assertTrue(frame[frame.week == 4].previous.isna().all())
        splits, years, cutoffs = make_splits(frame, [3, 3, 3])
        self.assertEqual(years, {"train": [2024], "validation": 2025, "test": 2026})
        self.assertLess(cutoffs[1], 9)
        self.assertTrue(all("9000" not in row["text"] for row in splits["test"]))


class AdapterSmokeTest(unittest.TestCase):
    def test_optimizer_and_adapter_roundtrip_on_miniature_architectures(self):
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, LlamaConfig, Qwen2Config, GptOssConfig
        from train import attach_adapter, fit, evaluate, logits_for_choices

        params = dict(vocab_size=32, hidden_size=32, intermediate_size=32, num_hidden_layers=2,
                      num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=128)
        configs = [LlamaConfig(**params), Qwen2Config(**params), GptOssConfig(
            **params, num_local_experts=2, num_experts_per_tok=1, head_dim=8, rope_scaling=None)]
        examples = [([5, 6, 7], 0), ([10, 11, 12], 3)]
        choices = [1, 2, 3, 4]
        torch.set_num_threads(1)
        for config in configs:
            with self.subTest(model=config.model_type), tempfile.TemporaryDirectory() as out:
                config._attn_implementation = "eager"
                torch.manual_seed(42)
                model = attach_adapter(AutoModelForCausalLM.from_config(config))
                model.eval()
                before = logits_for_choices(model, examples[0][0], choices).detach()
                fit(model, examples, choices, 2)
                evaluate(model, examples, choices)
                after = logits_for_choices(model, examples[0][0], choices).detach()
                self.assertFalse(torch.equal(before, after))
                model.save_pretrained(out, save_embedding_layers=False)
                self.assertTrue(Path(out, "adapter_model.safetensors").is_file())
                torch.manual_seed(42)
                base = AutoModelForCausalLM.from_config(config)
                reloaded = PeftModel.from_pretrained(base, out).eval()
                torch.testing.assert_close(logits_for_choices(reloaded, examples[0][0], choices), after)


if __name__ == "__main__":
    unittest.main()
