"""Install a finished EJ letterhead PDF and its DOCX raster companion.

The supplied PDF is already the final artwork. Do not strip text or overlay
contact details: doing so would duplicate the footer. The PDF remains the
vector source for PDF exports and the PNG is only used by Word headers.
"""
import argparse
import pathlib
import shutil
import subprocess
from PIL import Image
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("--output", default="server/assets/ej-brand")
args = parser.parse_args()
directory = pathlib.Path(args.output)
directory.mkdir(parents=True, exist_ok=True)
reader = PdfReader(args.source)
if len(reader.pages) != 1:
    raise SystemExit("The finished letterhead must contain exactly one page")
page = reader.pages[0]
width = float(page.mediabox.width)
height = float(page.mediabox.height)
if abs(width - 612) > 0.5 or abs(height - 792) > 0.5:
    raise SystemExit(f"Expected Letter 612x792 pt, got {width}x{height}")
text = reader.pages[0].extract_text() or ""
lower = text.lower()
if "lorem" in lower or "expresionjuridica@live.com" in lower:
    raise SystemExit("The source contains sample or obsolete contact text")
if "consultoria@expresionjuridica.com" not in lower or "boulevard europa no. 33" not in lower:
    raise SystemExit("The source is missing the expected EJ footer contact")
target = directory / "letterhead.pdf"
shutil.copyfile(args.source, target)
subprocess.run(["pdftoppm", "-f", "1", "-singlefile", "-r", "180", "-png", str(target), str(directory / "letterhead")], check=True)
png = directory / "letterhead.png"
with Image.open(png) as image:
    if image.size != (1530, 1980):
        raise SystemExit(f"Expected 180 dpi Letter raster 1530x1980, got {image.size}")
print(target)
