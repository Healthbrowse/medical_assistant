"""Rebuild the licensed educational retrieval snapshot. Never follow main.

This is source collection for retrieval, not model training or clinical validation.
The pinned release is CC BY 4.0; newer releases have different license terms.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'b0058a743bdd2cc08196abaaa7d5469970c0d80c'
REPOSITORY = 'https://github.com/openstax/osbooks-anatomy-physiology'
RAW = 'https://raw.githubusercontent.com/openstax/osbooks-anatomy-physiology/' + REVISION
NS = {'c': 'http://cnx.rice.edu/cnxml', 'col': 'http://cnx.rice.edu/collxml'}

def fetch(path):
    with urllib.request.urlopen(RAW + '/' + path, timeout=30) as response:
        data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError('Unexpected source size')
        return data

def module(document):
    raw = fetch('modules/' + document + '/index.cnxml')
    root = ET.fromstring(raw)
    parents = {child: parent for parent in root.iter() for child in parent}
    title = ''.join(root.find('c:title', NS).itertext()).strip()
    paragraphs = []
    for number, node in enumerate(root.findall('.//c:content//c:para', NS)):
        parent = node
        lineage = []
        heading = ''
        while parent in parents:
            parent = parents[parent]
            tag = parent.tag.split('}')[-1]
            lineage.append(tag)
            if tag == 'section' and not heading:
                section_title = parent.find('c:title', NS)
                if section_title is not None:
                    heading = ''.join(section_title.itertext()).strip()
        if any(tag in lineage for tag in ['figure', 'caption', 'exercise', 'solution', 'example']):
            continue
        text = re.sub(r'\s+', ' ', ''.join(node.itertext())).strip()
        if not 45 <= len(text) <= 2200:
            continue
        paragraphs.append({'id': node.attrib.get('id', document + '-' + str(number)), 'heading': heading, 'text': text})
    return {'id': document, 'title': title, 'url': REPOSITORY + '/blob/' + REVISION + '/modules/' + document + '/index.cnxml', 'sha256': hashlib.sha256(raw).hexdigest(), 'paragraphs': paragraphs}

def main():
    license_text = fetch('LICENSE').decode()
    if not license_text.startswith('Attribution 4.0 International'):
        raise ValueError('Pinned source license differs; review it before collecting')
    collection = ET.fromstring(fetch('collections/anatomy-and-physiology-2e.collection.xml'))
    if not any('creativecommons.org/licenses/by/4.0' in node.attrib.get('url', '') for node in collection.iter()):
        raise ValueError('Book collection does not declare the expected license')
    ids = list(dict.fromkeys(node.attrib['document'] for node in collection.findall('.//col:module', NS)))
    if len(ids) != 198 or any(not re.fullmatch(r'm\d+', value) for value in ids):
        raise ValueError('Unexpected book structure')
    with ThreadPoolExecutor(max_workers=4) as pool:
        modules = list(pool.map(module, ids))
    data = {'title': 'OpenStax Anatomy and Physiology 2e', 'revision': REVISION, 'snapshotDate': '2026-03-11', 'collectedAt': datetime.now(timezone.utc).isoformat(), 'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/', 'purpose': 'Educational retrieval; not a clinical guideline or training dataset', 'attribution': 'Adapted from OpenStax, Anatomy and Physiology 2e, CC BY 4.0, source snapshot 11 March 2026. Text extracted and reorganized by HealthBrowse; figures and exercises omitted.', 'modules': modules}
    destination = ROOT / 'dist' / 'education-sources.json'
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(destination)
    licenses = ROOT / 'docs' / 'licenses'
    licenses.mkdir(parents=True, exist_ok=True)
    (licenses / 'OpenStax-CC-BY-4.0.txt').write_text(license_text)
    print(json.dumps({'modules': len(modules), 'paragraphs': sum(len(m['paragraphs']) for m in modules), 'bytes': destination.stat().st_size}))

if __name__ == '__main__':
    main()
