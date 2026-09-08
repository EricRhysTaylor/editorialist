"""Bounded, offline DOCX review experiment. Never writes to the source or a vault."""
import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
def tag(name): return '{' + W + '}' + name
def local(name): return name.rsplit('}', 1)[-1]
def attr(node, name): return node.get(tag(name))

def projection(node, revised=False):
    name = local(node.tag)
    if name in ('pPr', 'rPr'): return ''
    if name in (('del', 'moveFrom') if revised else ('ins', 'moveTo')): return ''
    if name in ('t', 'delText'): return node.text or ''
    if name == 'tab': return '\t'
    if name in ('br', 'cr'): return '\n'
    return ''.join(projection(child, revised) + ('\n\n' if local(child.tag) == 'p' else '') for child in node)

def annotation(node):
    name = local(node.tag)
    return (name in {'ins', 'del', 'comment', 'commentRangeStart', 'commentRangeEnd', 'commentReference',
                     'cellIns', 'cellDel', 'cellMerge', 'numberingChange'}
            or 'move' in name.lower() or name.endswith('Change')
            or attr(node, 'author') is not None)

def extract(path):
    if Path(path).stat().st_size > 32 * 1024 * 1024: raise ValueError('Source exceeds prototype limits')
    data = Path(path).read_bytes()
    records, parts, roots = [], [], {}
    with ZipFile(BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 2048 or sum(i.file_size for i in infos) > 32 * 1024 * 1024:
            raise ValueError('Package exceeds prototype limits')
        if len({i.filename for i in infos}) != len(infos): raise ValueError('Duplicate ZIP part names')
        for info in sorted(infos, key=lambda i: i.filename):
            if not info.filename.endswith(('.xml', '.rels')): continue
            raw = archive.read(info)
            # Reject declarations rather than expanding entities. No relationships are fetched.
            if b'<!DOCTYPE' in raw.replace(b'\x00', b'').upper() or b'<!ENTITY' in raw.replace(b'\x00', b'').upper(): raise ValueError('DTD/entities unsupported')
            root = ET.fromstring(raw)
            roots[info.filename] = root
            parts.append({'part': info.filename, 'sha256': hashlib.sha256(raw).hexdigest()})
    document = roots.get('word/document.xml')
    if document is None or document.tag != tag('document'): raise ValueError('Only transitional word/document.xml supported')
    parents = {child: parent for parent in document.iter() for child in parent}
    paragraphs = list(document.iter(tag('p')))
    owners = {node: i for i, p in enumerate(paragraphs) for node in p.iter()}
    spans = {}
    position = [0, 0]
    # Comment anchors use offsets into both flattened projections, including paragraph boundaries.
    def offsets(node, deleted=False, inserted=False):
        name = local(node.tag)
        if name in ('pPr', 'rPr'): return
        if name in ('commentRangeStart', 'commentRangeEnd', 'commentReference'):
            spans.setdefault(attr(node, 'id'), {}).setdefault(name, []).append(position.copy())
        deleted |= name in ('del', 'moveFrom')
        inserted |= name in ('ins', 'moveTo')
        value = (node.text or '') if name in ('t', 'delText') else ('\t' if name == 'tab' else '\n' if name in ('br', 'cr') else '')
        if not inserted: position[0] += len(value)
        if not deleted: position[1] += len(value)
        for child in node: offsets(child, deleted, inserted)
        if name == 'p':
            position[0] += 2
            position[1] += 2
    offsets(document)
    original, revised = projection(document), projection(document, True)
    for part, root in roots.items():
        for ordinal, node in enumerate(root.iter()):
            if not annotation(node): continue
            p = owners.get(node) if part == 'word/document.xml' else None
            name = local(node.tag)
            record = {'sourceId': f'{part}#{ordinal}:{name}:{attr(node, "id") or ""}',
                      'part': part, 'kind': name, 'wordId': attr(node, 'id'),
                      'author': attr(node, 'author'), 'timestamp': attr(node, 'date'),
                      'paragraph': p, 'original': projection(node), 'revised': projection(node, True),
                      'rawXml': ET.tostring(node, encoding='unicode'),
                      'disposition': 'manual', 'reason': 'Requires author review; no operation inferred'}
            if p is not None:
                record['context'] = {'original': projection(paragraphs[p]), 'revised': projection(paragraphs[p], True)}
                record['simpleParagraph'] = (parents.get(paragraphs[p]) is document.find(tag('body'))
                    and parents.get(node) is paragraphs[p]
                    and all(n.tag in {tag(t) for t in ('p', 'r', 't', 'delText', 'ins', 'del', 'commentRangeStart', 'commentRangeEnd', 'commentReference')} for n in paragraphs[p].iter()))
            if name == 'comment':
                record['commentText'] = projection(node).rstrip('\n')
                record['anchors'] = spans.get(attr(node, 'id'), {})
                anchor = record['anchors']
                starts, ends = anchor.get('commentRangeStart', []), anchor.get('commentRangeEnd', [])
                if len(starts) == len(ends) == 1:
                    record['anchorText'] = {'original': original[starts[0][0]:ends[0][0]], 'revised': revised[starts[0][1]:ends[0][1]]}
                record['paragraphIds'] = [p.get('{' + W14 + '}paraId') for p in node.iter(tag('p'))]
            if name not in ('ins', 'del', 'comment', 'commentRangeStart', 'commentRangeEnd', 'commentReference'):
                record.update(disposition='unsupported', reason='Revision semantics not implemented; raw XML retained')
            records.append(record)
    # Extensions are retained in full: threading metadata must not vanish when no base comment is anchored.
    extensions = [{'part': part, 'rawXml': ET.tostring(root, encoding='unicode'), 'disposition': 'manual'}
                  for part, root in roots.items() if 'comment' in part.lower() and part != 'word/comments.xml' and not part.endswith('.rels')]
    return {'schemaVersion': 1, 'documentSha256': hashlib.sha256(data).hexdigest(), 'parts': parts,
            'retainedParts': [{'part': part, 'disposition': 'manual', 'rawXml': ET.tostring(root, encoding='unicode')} for part, root in roots.items() if part not in ('word/document.xml', 'word/comments.xml')],
            'originalText': original, 'revisedText': revised, 'annotations': records, 'extensions': extensions,
            'limitations': ['Not a lossless Word model', 'Only simple main-body paragraphs eligible for conversion',
                            'Unknown extensions and non-text objects require package inspection']}

# Field syntax in the paste format is not an escaped text container. Block ambiguous payloads.
def safe(value):
    return bool(value) and not re.search(r'[\r\n]|```|%%|===|^(?:Original|Revised|Why|SceneId|Reviewer|BatchId|ImportedBy|ImportedAt):', value, re.I)

def convert(ir, mapping):
    """Explicit paragraph→scene mapping; never consults current manuscript text."""
    if not isinstance(mapping, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()):
        raise ValueError('Mapping must be an object of paragraph indexes to scene ID strings')
    batches = []
    for record in ir['annotations']:
        if record['kind'] not in ('ins', 'del') or record['part'] != 'word/document.xml': continue
        p = record['paragraph']
        context = record.get('context', {})
        siblings = [a for a in ir['annotations'] if a['part'] == record['part'] and a['paragraph'] == p and a['kind'] not in ('commentRangeStart', 'commentRangeEnd', 'commentReference')]
        scene = mapping.get(str(p))
        if len(siblings) != 1 or not scene or not record.get('simpleParagraph'): continue
        before, after = context.get('original', ''), context.get('revised', '')
        if not all(safe(v) for v in (before, after, scene, record['author'] or '')) or before == after: continue
        # Restricted to run-level revisions. Paragraph marks and nested structures stay manual.
        node = ET.fromstring(record['rawXml'])
        if not list(node) or any(local(n.tag) not in {'ins', 'del', 'r', 't', 'delText'} for n in node.iter()): continue
        provenance = f'Word source {ir["documentSha256"]} / {record["sourceId"]} / {record["timestamp"] or "undated"}'
        if not safe(provenance): continue
        text = f'Template: Editorialist advanced\nReviewer: {record["author"]}\nReviewerType: editor\n\n=== EDIT ===\nSceneId: {scene}\nOriginal: {before}\nRevised: {after}\nWhy: {provenance}\n'
        batches.append({'sourceIds': [record['sourceId']], 'text': text})
        record.update(disposition='converted', reason='One isolated run revision; paragraph context from source DOCX')
    return batches

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('docx')
    parser.add_argument('--mapping', help='JSON object mapping zero-based paragraph indexes to scene IDs')
    args = parser.parse_args()
    result = extract(args.docx)
    result['batches'] = convert(result, json.loads(Path(args.mapping).read_text()) if args.mapping else {})
    print(json.dumps(result, indent=2, ensure_ascii=False))
