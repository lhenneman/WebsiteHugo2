#!/usr/bin/env python3
"""
sync_publications.py
====================
Fetches publications from Google Scholar and creates Hugo content stubs
for any papers not already on the website.

SETUP
-----
  python3 -m pip install scholarly bibtexparser free-proxy "httpx<0.28.0"

USAGE
-----
  python3 sync_publications.py

  Optional flags:
    --dry-run    Preview what would be added without writing any files
    --verbose    Show detailed info about each publication examined

WHAT IT DOES
------------
1. Fetches all publications from the Google Scholar profile for the
   configured SCHOLAR_USER_ID.
2. Skips conference papers/presentations (only keeps journal articles,
   preprints, and book chapters). Ambiguous entries are flagged for review.
3. Checks each new paper against existing content/publication/ folders
   (matched by DOI, then by title similarity). Papers already on the site
   are skipped — your edits are never overwritten.
4. For genuinely new papers: creates a folder + index.md stub under
   content/publication/.

AFTER RUNNING
-------------
- Open any newly created content/publication/<slug>/index.md files.
- Add the open-access author URL to the blank `url_pdf:` field if available.
- Commit the new folders to git and push (Netlify will rebuild automatically).

See PUBLICATIONS.md for full instructions and tips.
"""

import argparse
import difflib
import os
import re
import sys
import time
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION — edit these if needed
# ──────────────────────────────────────────────────────────────────────────────

# Your Google Scholar user ID (from the URL of your Scholar profile)
SCHOLAR_USER_ID = "IL-s1LkAAAAJ"

# Absolute path to the root of the Hugo site
SITE_ROOT = Path(__file__).parent.resolve()

# Where Hugo publication content lives
PUBLICATION_DIR = SITE_ROOT / "content" / "publication"

# Publication types to INCLUDE (from scholarly's bib['ENTRYTYPE'])
# Common values: 'article', 'inproceedings', 'book', 'incollection', 'misc'
# We include articles, preprints (misc), and book chapters
INCLUDE_TYPES = {"article", "misc", "incollection"}

# Types that are always skipped
SKIP_TYPES = {"inproceedings"}

# ──────────────────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Convert a title to a URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text[:60]  # keep slugs readable


def get_existing_dois() -> dict[str, Path]:
    """Return a dict of {doi_lower: folder_path} for all existing publications."""
    dois = {}
    for folder in PUBLICATION_DIR.iterdir():
        if not folder.is_dir():
            continue
        index_file = folder / "index.md"
        if not index_file.exists():
            continue
        content = index_file.read_text(encoding="utf-8")
        doi_match = re.search(r'doi:\s*["\']?([^\s"\']+)["\']?', content, re.IGNORECASE)
        if doi_match:
            dois[doi_match.group(1).lower().strip()] = folder
    return dois


def get_existing_titles() -> dict[str, Path]:
    """Return a dict of {title_slug: folder_path} for all existing publications."""
    titles = {}
    for folder in PUBLICATION_DIR.iterdir():
        if not folder.is_dir():
            continue
        index_file = folder / "index.md"
        if not index_file.exists():
            continue
        content = index_file.read_text(encoding="utf-8")
        title_match = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', content, re.MULTILINE | re.IGNORECASE)
        if title_match:
            slug = slugify(title_match.group(1))
            titles[slug] = folder
    return titles


def safe_get(pub_bib: dict, key: str, default="") -> str:
    """Safely extract a string from a scholarly bib dict."""
    val = pub_bib.get(key, default) or default
    # scholarly sometimes returns lists
    if isinstance(val, list):
        val = ", ".join(str(v) for v in val)
    return str(val).strip()


def format_authors(author_str: str) -> list[str]:
    """
    Convert an author string like 'Smith, J and Jones, A'
    into a list of names for the Hugo front matter.
    """
    if not author_str:
        return []
    # scholarly returns 'Author One and Author Two'
    parts = re.split(r"\s+and\s+", author_str, flags=re.IGNORECASE)
    result = []
    for part in parts:
        part = part.strip()
        if "," in part:
            # 'Last, First' → 'First Last'
            last, *first = part.split(",", 1)
            part = f"{first[0].strip()} {last.strip()}" if first else last.strip()
        result.append(part)
    return result


def pub_type_for_hugo(entrytype: str) -> str:
    """Map BibTeX entry type to Wowchemy publication_types code."""
    mapping = {
        "article": "2",          # Journal article
        "misc": "3",             # Preprint
        "incollection": "6",     # Book chapter
        "book": "5",             # Book
        "phdthesis": "7",        # Thesis
        "techreport": "4",       # Report
    }
    return mapping.get(entrytype.lower(), "2")


def make_slug(pub_bib: dict) -> str:
    """Generate a unique slug from authors + year."""
    title = safe_get(pub_bib, "title", "untitled")
    year = safe_get(pub_bib, "pub_year") or safe_get(pub_bib, "year", "0000")
    return slugify(title) + f"-{year}"


def write_hugo_stub(pub, folder: Path) -> None:
    """Write a content/publication/<slug>/index.md stub."""
    bib = pub.get("bib", {})
    title = safe_get(bib, "title", "Untitled")
    year = safe_get(bib, "pub_year") or safe_get(bib, "year", "")
    date = f"{year}-01-01" if year else "1900-01-01"
    authors = format_authors(safe_get(bib, "author"))
    abstract = safe_get(bib, "abstract")
    journal = safe_get(bib, "journal") or safe_get(bib, "booktitle", "")
    doi = safe_get(pub.get("bib", {}), "doi") or safe_get(pub, "eprint_url", "")
    entrytype = bib.get("ENTRYTYPE", "article").lower()
    pub_type = pub_type_for_hugo(entrytype)

    # Format authors list for YAML
    authors_yaml = "\n".join(f'  - "{a}"' for a in authors) if authors else '  - "Lucas RF Henneman"'

    stub = f"""---
title: "{title}"
date: {date}
publishDate: {date}
authors:
{authors_yaml}
publication_types: ["{pub_type}"]
abstract: "{abstract}"
featured: false
publication: "*{journal}*"
# Add the open-access URL below when available:
url_pdf: ""
doi: "{doi}"
---
"""

    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.md").write_text(stub, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Sync Google Scholar publications to Hugo.")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing files")
    parser.add_argument("--verbose", action="store_true", help="Print details for every publication")
    args = parser.parse_args()

    try:
        from scholarly import scholarly
        from scholarly import ProxyGenerator
    except ImportError:
        print("ERROR: 'scholarly' or dependencies missing. Run:  python3 -m pip install scholarly free-proxy \"httpx<0.28.0\"")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  HAQ Lab Publication Sync")
    print(f"  Scholar ID: {SCHOLAR_USER_ID}")
    print(f"{'='*60}\n")
    
    # Initialize Proxy to avoid Google Scholar rate-limiting
    print("Initializing proxies to avoid rate limits (this takes a moment)...")
    pg = ProxyGenerator()
    pg.FreeProxies()
    scholarly.use_proxy(pg)

    # Load existing publications
    existing_dois = get_existing_dois()
    existing_titles = get_existing_titles()
    print(f"Found {len(existing_dois)} existing publications with DOIs on the site.\n")

    # Fetch author from Scholar
    print("Connecting to Google Scholar (this may take 30–60 seconds)...")
    author = scholarly.search_author_id(SCHOLAR_USER_ID)
    author = scholarly.fill(author, sections=["publications"])
    pubs = author.get("publications", [])
    print(f"Found {len(pubs)} total publications on Google Scholar.\n")

    added = []
    skipped_existing = []
    skipped_type = []
    flagged = []

    for pub in pubs:
        # Fill publication details (slow — adds a small delay per pub)
        try:
            pub = scholarly.fill(pub)
            time.sleep(1)  # be polite to Scholar
        except Exception as e:
            print(f"  WARNING: Could not fill publication details: {e}")
            continue

        bib = pub.get("bib", {})
        entrytype = bib.get("ENTRYTYPE", "").lower()
        title = safe_get(bib, "title", "(no title)")
        doi = safe_get(bib, "doi", "").lower().strip()
        title_slug = slugify(title)

        if args.verbose:
            print(f"  Examining: {title[:70]}... [{entrytype}]")

        # --- Filter by title terms ---
        if "erratum" in title.lower():
            skipped_type.append(title)
            if args.verbose:
                print(f"    → SKIP (erratum)")
            continue

        # --- Filter by publication type ---
        # Scholarly often returns an empty ENTRYTYPE. 
        journal_or_venue = f"{safe_get(bib, 'journal')} {safe_get(bib, 'booktitle')} {safe_get(bib, 'publisher')}".lower()
        
        # Check for explicit conference terms to exclude (using word boundaries to avoid matching substrings)
        is_conference = bool(re.search(r'\b(conference|proceeding|meeting|isee|ats|environmental epidemiology|american thoracic society)\b', journal_or_venue))
        
        # Guard AGU journals like GeoHealth from the conference filter
        if re.search(r'\b(agu|american geophysical union)\b', journal_or_venue):
            if "geohealth" not in journal_or_venue and "journal" not in journal_or_venue:
                is_conference = True

        if not entrytype or entrytype == "article":
            if is_conference:
                entrytype = "inproceedings"
            elif not entrytype:
                if journal_or_venue:
                    entrytype = "article"
                else:
                    entrytype = "unknown"
                
        if entrytype in SKIP_TYPES:
            skipped_type.append(title)
            if args.verbose:
                print(f"    → SKIP (conference/presentation type: {entrytype})")
            continue

        if entrytype not in INCLUDE_TYPES and entrytype != "article":
            flagged.append((title, entrytype))
            if args.verbose:
                print(f"    → FLAGGED for review (unknown type: {entrytype})")
            continue

        # --- Check if already on the site ---
        if doi and doi in existing_dois:
            skipped_existing.append(title)
            if args.verbose:
                print(f"    → Already on site (matched by DOI)")
            continue

        if title_slug in existing_titles:
            skipped_existing.append(title)
            if args.verbose:
                print(f"    → Already on site (matched by title)")
            continue

        # Fuzzy match title to catch variations (similarity > 0.85)
        found_fuzzy = False
        for ex_slug in existing_titles:
            if difflib.SequenceMatcher(None, title_slug, ex_slug).ratio() > 0.85:
                found_fuzzy = True
                break
        
        if found_fuzzy:
            skipped_existing.append(title)
            if args.verbose:
                print(f"    → Already on site (fuzzy matched by title)")
            continue

        # --- New publication — add it ---
        slug = make_slug(bib)
        folder = PUBLICATION_DIR / slug

        # Handle slug collisions
        n = 1
        original_slug = slug
        while folder.exists():
            slug = f"{original_slug}-{n}"
            folder = PUBLICATION_DIR / slug
            n += 1

        if args.dry_run:
            print(f"  [DRY RUN] Would create: content/publication/{slug}/")
        else:
            write_hugo_stub(pub, folder)
            print(f"  ✓ Added: content/publication/{slug}/")

        added.append((slug, title))

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print(f"  SUMMARY")
    print(f"{'─'*60}")
    print(f"  New publications added : {len(added)}")
    print(f"  Already on site        : {len(skipped_existing)}")
    print(f"  Skipped (conferences)  : {len(skipped_type)}")
    print(f"  Flagged for review     : {len(flagged)}")

    if added:
        print(f"\n  NEWLY ADDED:")
        for slug, title in added:
            print(f"    • content/publication/{slug}/  {title[:60]}")

    if flagged:
        print(f"\n  FLAGGED (unknown type — review manually):")
        for title, etype in flagged:
            print(f"    ? [{etype}]  {title[:70]}")

    if not args.dry_run and added:
        print(f"\n  NEXT STEPS:")
        print(f"  1. Open each new index.md and add open-access URLs to 'url_pdf:' if available")
        print(f"  2. Review author names for formatting (scholarly sometimes returns initials only)")
        print(f"  3. git add content/publication/ && git commit -m 'Add new publications'")
        print(f"  4. git push  (Netlify will rebuild automatically)")

    print()


if __name__ == "__main__":
    main()
