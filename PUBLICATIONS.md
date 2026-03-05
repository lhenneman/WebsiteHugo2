# Updating Publications

This file explains how to keep the publications list on the website current using the `sync_publications.py` script.

---

## Quick-start

```bash
# Install the required Python package (one-time setup)
python3 -m pip install scholarly bibtexparser free-proxy "httpx<0.28.0"

# Run the sync script
python3 sync_publications.py
```

The script fetches your Google Scholar profile, finds papers not yet on the website, and creates draft entries for each one. It **never modifies existing publication entries** — only adds new ones.

---

## What the script does

1. Fetches all publications from your Google Scholar profile (`IL-s1LkAAAAJ`)
2. **Skips conference presentations** (inproceedings / proceedings types)
3. Checks each paper against existing entries in `content/publication/` by DOI (and title as a fallback)
4. For new papers: creates `content/publication/<slug>/index.md` with title, authors, year, abstract, and DOI pre-filled
5. Leaves a blank `url_pdf:` field in each stub — see below for how to fill it in

---

## After running the script

### 1. Review new entries

Open each newly created `content/publication/<slug>/index.md` file. At minimum check:
- **Authors**: `scholarly` sometimes returns abbreviated names; fix if needed
- **Date**: the script uses the year only; update the month if you know it (`2024-03-01`)
- **Abstract**: may occasionally be truncated or missing

### 2. Add open-access / author URLs

Each stub has this line:

```yaml
url_pdf: ""
```

Paste the URL to your accepted manuscript or published PDF between the quotes:

```yaml
url_pdf: "https://dash.harvard.edu/handle/1/..."
```

This will add a PDF button to the publication card on the website.

### 3. Exclude a publication

If you don't want a paper on the site, simply delete its folder:

```bash
rm -rf content/publication/<slug>/
```

The script will not re-create it on the next run **if you also add the DOI to the exclusion list** at the top of `sync_publications.py` (see the `EXCLUDED_DOIS` variable in the script — add any DOIs you want permanently skipped).

### 4. Publish

```bash
git add content/publication/
git commit -m "Add new publications from Scholar sync"
git push
```

Netlify will detect the push and rebuild the site automatically (usually takes 1–2 minutes).

---

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | See what would be added without writing any files |
| `--verbose` | Print details about every publication examined |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Google returns a CAPTCHA / blocks the request | Wait a few minutes and try again. Google occasionally throttles scraping. The `--dry-run` flag is useful for testing without hammering Scholar. |
| Author names show as `Last, F` | Edit the generated `index.md` manually |
| A paper appears twice | Delete the duplicate folder; the script will not re-create it |
| Script crashes with `ImportError` | Run `python3 -m pip install scholarly bibtexparser free-proxy "httpx<0.28.0"` |
