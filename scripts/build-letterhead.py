"""Remove only the sample body text from the supplied Illustrator PDF.

Keep the vector identity and contact information; rasterize a separate copy
for Word's repeated, replaceable header image. Run with bundled Python.
"""
import argparse
import pathlib
import subprocess
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("--output", default="server/assets/ej-brand")
args = parser.parse_args()
directory = pathlib.Path(args.output)
directory.mkdir(parents=True, exist_ok=True)
reader = PdfReader(args.source)
page = reader.pages[0]
stream = ContentStream(page.get_contents(), reader)
sample = False
operations = []
for operands, operator in stream.operations:
    if operator == b"BT":
        sample = False
    if operator == b"Tm":
        sample = float(operands[5]) < 650
    if sample and operator in (b"Tj", b"TJ", b"'", b'"'):
        continue
    operations.append((operands, operator))
stream.operations = operations
page[NameObject("/Contents")] = stream
for key in ("/PieceInfo", "/Metadata"):
    if key in page:
        del page[key]
writer = PdfWriter()
writer.add_page(page)
writer.add_metadata({"/Title": "Hoja membretada de Expresión Jurídica", "/Author": "Expresión Jurídica Consultores"})
target = directory / "letterhead.pdf"
with target.open("wb") as output:
    writer.write(output)
assert "Lorem" not in PdfReader(target).pages[0].extract_text()
subprocess.run(["pdftoppm", "-f", "1", "-singlefile", "-r", "180", "-png", str(target), str(directory / "letterhead")], check=True)
print(target)
