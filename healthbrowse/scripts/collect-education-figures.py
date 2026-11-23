"""Collect figure metadata from the existing CC BY 4.0 textbook revision.
Images are loaded on demand from this immutable revision. Skip third-party credits.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json, re, hashlib, importlib.util, argparse
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('collector', ROOT/'scripts/collect-education.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
fetch, REVISION, REPOSITORY, NS = collector.fetch, collector.REVISION, collector.REPOSITORY, collector.NS
def text(node):
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip() if node is not None else ''
def figures(module):
    raw = (CHAPTERS/(module['id']+'.cnxml')).read_bytes() if CHAPTERS else fetch('modules/'+module['id']+'/index.cnxml')
    if hashlib.sha256(raw).hexdigest() != module['sha256']:
        raise ValueError('Chapter differs from licensed snapshot')
    rows=[]
    for figure in ET.fromstring(raw).findall('.//c:figure', NS):
        image=figure.find('.//c:image', NS)
        media=figure.find('.//c:media', NS)
        caption=text(figure.find('c:caption', NS))
        if image is None or media is None or re.search(r'credit|copyright|©|courtesy|adapted from',caption,re.I):
            continue
        path=image.attrib.get('src','')
        if not re.fullmatch(r'\.\./\.\./media/[A-Za-z0-9_.-]+\.(?:jpg|png|jpeg)',path):
            continue
        title=text(figure.find('c:title', NS))
        alt=media.attrib.get('alt','').strip()
        if not title or not alt: continue
        rows.append({'id':module['id']+'-'+figure.attrib['id'],'module':module['id'],
            'title':title,'alt':alt,'caption':caption,'chapter':module['title'],
            'sourceUrl':module['url']+'#'+figure.attrib['id'],
            'asset':path[6:],'license':'CC BY 4.0',
            'attribution':'OpenStax, Anatomy and Physiology 2e. CC BY 4.0. Unmodified figure from the 11 March 2026 source snapshot.'})
    return rows
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--chapters-dir',type=Path,help='Previously fetched pinned chapters; each SHA-256 must match the text corpus')
    CHAPTERS=parser.parse_args().chapters_dir
    license_text=(ROOT/'docs/licenses/OpenStax-CC-BY-4.0.txt').read_text() if CHAPTERS else fetch('LICENSE').decode()
    if not license_text.startswith('Attribution 4.0 International'):
        raise ValueError('License must be reviewed')
    data=json.loads((ROOT/'dist/education-sources.json').read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows=[r for group in pool.map(figures,data['modules']) for r in group]
    out={'revision':REVISION,'license':'CC BY 4.0','licenseUrl':data['licenseUrl'],'figures':rows}
    (ROOT/'dist/education-figures.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({'figures':len(rows)}))
