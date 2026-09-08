"""Reproducible synthetic package, never based on manuscript text."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import sys
from extract import W, W14, W15

def run(text, deleted=False):
    field = 'delText' if deleted else 't'
    return f'<w:r><w:{field} xml:space="preserve">{text}</w:{field}></w:r>'
def change(kind, id, text, author='Synthetic Editor'):
    return f'<w:{kind} w:id="{id}" w:author="{author}" w:date="2026-09-01T10:30:00Z">{run(text, kind in ("del", "moveFrom"))}</w:{kind}>'
def paragraph(text): return '<w:p>' + text + '</w:p>'

def create(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    paragraphs = [
        paragraph(run('The door ') + change('ins', 1, 'slowly ') + run('opened.')),
        paragraph(run('She ') + change('del', 2, 'really ') + run('waited.')),
        paragraph(run('The light was ') + change('del', 3, 'red') + change('ins', 4, 'blue') + run('.')),
        paragraph(run('A ') + '<w:ins w:id="5" w:author="Second Reviewer" w:date="2026-09-02T11:00:00Z">' + run('quiet ') + run('silver ') + '</w:ins>' + run('bell rang.')),
        paragraph('<w:commentRangeStart w:id="10"/>' + run('He ') + change('del', 6, 'still ') + run('waited.') + '<w:commentRangeEnd w:id="10"/><w:r><w:commentReference w:id="10"/></w:r>'),
        paragraph(run('Echo.') + change('ins', 7, ' Again.')),
        paragraph(run('Echo.')),
        paragraph('<w:pPr><w:rPr><w:del w:id="8" w:author="Synthetic Editor" w:date="2026-09-01T10:30:00Z"/></w:rPr></w:pPr>' + run('First paragraph.')),
        paragraph(run('Second paragraph.')),
        paragraph('<w:r><w:rPr><w:b/><w:rPrChange w:id="9" w:author="Synthetic Editor" w:date="2026-09-01T10:30:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>Styled.</w:t></w:r>'),
        paragraph(change('moveFrom', 11, 'Moved passage.')),
        paragraph(change('moveTo', 12, 'Moved passage.')),
        paragraph('<w:commentRangeStart w:id="13"/>' + run('Across first.')),
        paragraph(run('Across second.') + '<w:commentRangeEnd w:id="13"/><w:r><w:commentReference w:id="13"/></w:r>'),
    ]
    comments = f'<w:comments xmlns:w="{W}" xmlns:w14="{W14}">'
    for id, para, text, author in [(10, '00000010', 'Why does he wait?', 'Synthetic Editor'), (14, '00000014', 'I agree; clarify his motive.', 'Second Reviewer'), (13, '00000013', 'Consider the transition.', 'Synthetic Editor')]:
        comments += f'<w:comment w:id="{id}" w:author="{author}" w:date="2026-09-01T12:00:00Z"><w:p w14:paraId="{para}">{run(text)}</w:p></w:comment>'
    comments += '</w:comments>'
    parts = {
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}<w:sectPr/></w:body></w:document>',
        'word/comments.xml': comments,
        'word/commentsExtended.xml': f'<w15:commentsEx xmlns:w15="{W15}"><w15:commentEx w15:paraId="00000010" w15:done="0"/><w15:commentEx w15:paraId="00000014" w15:paraIdParent="00000010" w15:done="0"/></w15:commentsEx>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:trackRevisions/></w:settings>',
        '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{typ}" Target="{target}"/>' for i, typ, target in [(1, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', 'comments.xml'), (2, 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', 'commentsExtended.xml'), (3, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', 'settings.xml')]) + '</Relationships>',
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join(f'<Override PartName="/word/{name}.xml" ContentType="{mime}"/>' for name, mime in [('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), ('comments', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'), ('commentsExtended', 'application/vnd.ms-word.commentsExtended+xml'), ('settings', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')]) + '</Types>',
    }
    with ZipFile(directory / 'review.docx', 'w') as archive:
        for name, content in sorted(parts.items()):
            info = ZipInfo(name, (2026, 9, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, content)
    (directory / 'mapping.json').write_text(json.dumps({str(i): 'scn_fixture' for i in range(len(paragraphs))}, indent=2) + '\n')

if __name__ == '__main__': create(sys.argv[1])
