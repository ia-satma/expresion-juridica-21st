"""Build private EOT parts and width metrics from the approved EJ reference fonts.
Run only after replacing TTF sources. The generated assets are used server-side
and embedded in private presentations; they are not exposed as web fonts.
EOT v1 header: https://www.w3.org/submissions/EOT/#Version00010000
"""
import json
import struct
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1] / 'server/assets/ej-brand'
metrics = {}
for stem, key, family, style in [
    ('bahnschrift-light', 'body', 'Bahnschrift Light', 'Regular'),
    ('libre-caslon-italic', 'heading', 'Libre Caslon Text', 'Italic'),
]:
    target = root / (stem + '.ttf')
    font = TTFont(target)
    names = font['name']
    # Give the extracted face a stable, unambiguous family for Office and Fontconfig.
    replacements = {1: family, 2: style, 4: family if style == 'Regular' else family + ' ' + style,
                    6: family.replace(' ', '') + '-' + style, 16: family, 17: style}
    for record in names.names:
        if record.nameID in replacements:
            record.string = replacements[record.nameID].encode(record.getEncoding())
    for name_id, value in replacements.items():
        names.setName(value, name_id, 3, 1, 0x409)
    font.save(target)
    raw = target.read_bytes()
    os2, head = font['OS/2'], font['head']
    if os2.fsType & 0x2 or (os2.fsType & 0x4 and not os2.fsType & 0x8):
        raise ValueError('Font does not allow editable document embedding: ' + stem)
    header = bytearray(82)
    struct.pack_into('<III', header, 4, len(raw), 0x10000, 0)
    panose = os2.panose
    header[16:26] = bytes(getattr(panose, name) for name in ('bFamilyType','bSerifStyle','bWeight','bProportion','bContrast','bStrokeVariation','bArmStyle','bLetterForm','bMidline','bXHeight'))
    header[26] = 1
    header[27] = 1 if os2.fsSelection & 1 else 0
    struct.pack_into('<IHH', header, 28, os2.usWeightClass, os2.fsType, 0x504C)
    struct.pack_into('<7I', header, 36, *[getattr(os2, name, 0) for name in ('ulUnicodeRange1','ulUnicodeRange2','ulUnicodeRange3','ulUnicodeRange4','ulCodePageRange1','ulCodePageRange2')], head.checkSumAdjustment)
    strings = bytearray()
    for name_id in (1, 2, 5, 4):
        value = names.getDebugName(name_id) or ''
        encoded = value.encode('utf-16le')
        # Padding1 is already the final two bytes of header; subsequent records
        # have their own zero padding followed by a byte count.
        if strings:
            strings.extend(b'\0\0')
        strings.extend(struct.pack('<H', len(encoded)))
        strings.extend(encoded)
    eot = header + strings + raw
    struct.pack_into('<I', eot, 0, len(eot))
    (root / (stem + '.eot')).write_bytes(eot)
    upm = head.unitsPerEm
    metrics[key] = {chr(code): round(font['hmtx'].metrics[glyph][0] / upm, 6) for code, glyph in font.getBestCmap().items()}
(root / 'font-metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, separators=(',', ':')))
print('Built 2 private font parts and metrics.')
