"""Small, deterministic lexical baseline; replace only as a measured experiment."""
import json
import gzip
import math
import re
from collections import Counter
from pathlib import Path
from .contracts import Evidence

STOP = set('what is are a an the of in to for how does do can you tell me about explain please and why it its main function'.split())
NORMAL = {'mitochondria': 'mitochondrion', 'mitochondrial': 'mitochondrion', 'nuclei': 'nucleus'}

def terms(text):
    return [NORMAL.get(t, t[:-1] if t.endswith('s') and len(t) > 4 else t) for t in re.findall(r'[a-z0-9]+', text.lower()) if t not in STOP]

class Corpus:
    def __init__(self, path):
        opener = gzip.open if str(path).endswith('.gz') else open
        with opener(path, 'rt', encoding='utf-8') as stream:
            self.rows = [json.loads(line) for line in stream if line.strip()]
        self.counts = [Counter(terms(r['title'] + ' ' + r['text'])) for r in self.rows]
        self.df = Counter(term for count in self.counts for term in count)
        self.lengths = [sum(c.values()) for c in self.counts]
        self.average = sum(self.lengths) / max(1, len(self.lengths))

    def search(self, question, limit=5):
        query = set(terms(question))
        ranked = []
        for row, count, length in zip(self.rows, self.counts, self.lengths):
            hits = query & count.keys()
            if not query or len(hits) < math.ceil(len(query) * 0.5):
                continue
            score = sum(math.log(1 + (len(self.rows) - self.df[t] + .5) / (self.df[t] + .5)) * count[t] * 2.2 / (count[t] + 1.2 * (.25 + .75 * length / max(1, self.average))) for t in hits)
            if query <= set(terms(row['title'])):
                score += 6
            ranked.append((score, row))
        ranked.sort(key=lambda pair: (-pair[0], pair[1]['id']))
        return [Evidence.model_validate({k: row[k] for k in ['id', 'title', 'url', 'text']}) for _, row in ranked[:limit]]
