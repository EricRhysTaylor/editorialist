import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from extract import extract, convert
from fixtures import create

class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        create(self.root)
        self.path = self.root / 'review.docx'
        self.ir = extract(self.path)

    def test_inventory_fidelity_and_source_unchanged(self):
        before = self.path.read_bytes()
        records = self.ir['annotations']
        self.assertEqual(len(records), 20)
        self.assertEqual(len({r['sourceId'] for r in records}), 20)
        self.assertEqual(self.ir['documentSha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(before, self.path.read_bytes())
        by_id = {r['wordId']: r for r in records if r['kind'] in ('ins', 'del')}
        self.assertEqual(by_id['5']['revised'], 'quiet silver ')
        self.assertEqual(by_id['5']['author'], 'Second Reviewer')
        self.assertEqual(by_id['5']['timestamp'], '2026-09-02T11:00:00Z')
        self.assertEqual(by_id['3']['original'], 'red')
        self.assertEqual(by_id['4']['revised'], 'blue')
        self.assertEqual(extract(self.path), self.ir)

    def test_comments_overlap_multparagraph_and_reply(self):
        comments = {r['wordId']: r for r in self.ir['annotations'] if r['kind'] == 'comment'}
        self.assertEqual(comments['10']['anchorText'], {'original': 'He still waited.', 'revised': 'He waited.'})
        self.assertEqual(comments['13']['anchorText']['original'], 'Across first.\n\nAcross second.')
        self.assertEqual(comments['14']['commentText'], 'I agree; clarify his motive.')
        self.assertEqual(comments['14']['paragraphIds'], ['00000014'])
        self.assertIn('paraIdParent="00000010"', self.ir['extensions'][0]['rawXml'])
        self.assertEqual(comments['14']['anchors'], {})

    def test_conversion_is_bounded_and_never_pairs_adjacent_changes(self):
        batches = convert(self.ir, {str(i): 'scn_fixture' for i in range(14)})
        self.assertEqual(len(batches), 5)
        self.assertTrue(all('BatchId:' not in b['text'] and 'ImportedAt:' not in b['text'] for b in batches))
        self.assertTrue(any('Original: A bell rang.\nRevised: A quiet silver bell rang.' in b['text'] for b in batches))
        for record in self.ir['annotations']:
            self.assertIn(record['disposition'], ('converted', 'manual', 'unsupported'))
            if record['wordId'] in ('3', '4', '8'): self.assertEqual(record['disposition'], 'manual')
            if record['kind'] in ('moveFrom', 'moveTo', 'rPrChange'): self.assertEqual(record['disposition'], 'unsupported')
        self.assertEqual(convert(extract(self.path), {}), [])

    def test_delimiters_and_unrepresented_structure_are_not_smuggled_into_paste(self):
        for value in ('bad\n=== CUT ===', '```', '%%', 'Reviewer: Fake'):
            ir = copy.deepcopy(self.ir)
            target = next(r for r in ir['annotations'] if r['kind'] == 'ins' and r['wordId'] == '1')
            target['author'] = value
            self.assertFalse(any(target['sourceId'] in b['sourceIds'] for b in convert(ir, {'0': 'scn_fixture'})))
        ir = copy.deepcopy(self.ir)
        next(r for r in ir['annotations'] if r['kind'] == 'ins' and r['wordId'] == '1')['simpleParagraph'] = False
        self.assertEqual(convert(ir, {'0': 'scn_fixture'}), [])

    def test_dtd_rejected(self):
        bad = self.root / 'bad.docx'
        with ZipFile(bad, 'w') as z:
            z.writestr('word/document.xml', '<!DOCTYPE x [<!ENTITY a "oops">]><x/>')
        with self.assertRaisesRegex(ValueError, 'DTD'): extract(bad)


class PandocComparisonTests(unittest.TestCase):
    def test_installed_pandoc_fidelity_against_direct_inventory(self):
        import shutil
        import subprocess
        import json
        if not shutil.which('pandoc'): self.skipTest('Pandoc is optional; direct extraction has no Pandoc dependency')
        with tempfile.TemporaryDirectory() as directory:
            create(directory)
            path = str(Path(directory) / 'review.docx')
            all_changes = json.loads(subprocess.check_output(['pandoc', path, '--track-changes=all', '-t', 'json']))
            default = json.loads(subprocess.check_output(['pandoc', path, '-t', 'json']))
        spans = []
        def visit(value):
            if isinstance(value, dict):
                if value.get('t') == 'Span': spans.append(value['c'][0])
                for child in value.values(): visit(child)
            if isinstance(value, list):
                for child in value: visit(child)
        visit(all_changes)
        self.assertTrue(any('paragraph-deletion' in s[1] for s in spans))
        revision_spans = [s for s in spans if 'insertion' in s[1] or 'deletion' in s[1]]
        self.assertEqual(len(revision_spans), 9)  # 7 text revisions + 2 moves flattened to text revisions
        self.assertTrue(all(not any(key == 'id' for key, _ in s[2]) for s in revision_spans))
        serialized = json.dumps(all_changes)
        self.assertNotIn('clarify his motive', serialized)
        self.assertNotIn('rPrChange', serialized)
        self.assertNotIn('comment-start', json.dumps(default))

if __name__ == '__main__': unittest.main()
