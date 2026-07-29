"""
Extract raw text from the MFU Admission Guide PDFs into JSON.

Run this whenever MFU publishes updated guides:

    npm run extract

It writes one JSON file per source PDF into data/raw/. Those files are the
verbatim source of truth; the curated files in data/knowledge/ are authored on
top of them and must be reviewed by a human whenever the raw text changes.

Requires: PyMuPDF  (pip install PyMuPDF)
"""

import json
import os
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is required. Install it with:  pip install PyMuPDF")

# --- Source PDFs ------------------------------------------------------------
# Update these paths if the guides move. Relative paths resolve from the repo
# root so the script keeps working after the PDFs are copied into the project.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SOURCES = [
    {
        "id": "undergrad",
        "level": "undergraduate",
        "title": "MFU Admission Guide 2-2026 - Undergraduate (International)",
        "path": r"C:\Users\asus\Downloads\Admission Guide (Graduate)-20260728T083213Z-1-001\Admission Guide (Graduate)\Admission Guide 2-2026 Undergrad online.pdf",
    },
    {
        "id": "postgrad",
        "level": "postgraduate",
        "title": "MFU Admission Guide 2-2026 - Postgraduate (Master's & Doctoral)",
        "path": r"C:\Users\asus\Downloads\Admission Guide (Graduate)-20260728T083213Z-1-001\Admission Guide (Graduate)\Admission Guide 2-2026 Postgrad.pdf",
    },
]

OUT_DIR = os.path.join(REPO_ROOT, "data", "raw")


def clean(text: str) -> str:
    """Collapse the ragged whitespace that PDF layout extraction leaves behind.

    Table cells in these guides are emitted as runs of tabs and blank lines
    between a label and its value, which makes the raw text hard for a model to
    read. Collapsing them keeps the reading order intact without inventing
    structure the PDF does not actually have.
    """
    text = text.replace("\u00ad", "")           # soft hyphen
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract(source: dict) -> dict:
    path = source["path"]
    if not os.path.exists(path):
        sys.exit(f"PDF not found: {path}\nUpdate SOURCES in {__file__}")

    doc = fitz.open(path)
    pages = []
    for number, page in enumerate(doc, start=1):
        body = clean(page.get_text())
        pages.append({"page": number, "text": body, "chars": len(body)})
    doc.close()

    total = sum(p["chars"] for p in pages)
    empty = [p["page"] for p in pages if p["chars"] < 20]

    return {
        "id": source["id"],
        "level": source["level"],
        "title": source["title"],
        "source_file": os.path.basename(path),
        "page_count": len(pages),
        "total_chars": total,
        # Pages with almost no text are image-only (photos, infographics). The
        # model cannot read those, so surface them rather than silently losing
        # whatever they contain.
        "image_only_pages": empty,
        "pages": pages,
    }


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    for source in SOURCES:
        result = extract(source)
        out_path = os.path.join(OUT_DIR, f"{result['id']}.json")
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)

        note = ""
        if result["image_only_pages"]:
            note = f"  [!] image-only pages: {result['image_only_pages']}"
        print(
            f"{result['id']:>10}: {result['page_count']} pages, "
            f"{result['total_chars']:,} chars -> data/raw/{result['id']}.json{note}"
        )

    print("\nDone. Review data/knowledge/*.json if the raw text changed.")


if __name__ == "__main__":
    main()
