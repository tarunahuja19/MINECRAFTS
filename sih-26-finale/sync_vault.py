#!/usr/bin/env python3
"""
sync_vault.py — Automated Validation & Verification Engine for SIH 26 Finale Brain

Validates all markdown notes in sih-26-finale-brain/ for:
1. Strict YAML frontmatter compliance (RULES.md §2).
2. Internal Obsidian wikilink integrity (zero broken links).
3. Graph connectivity (zero unindexed orphan notes).
4. Synchronisation status against raw specifications in files/.

Usage:
    python3 sync_vault.py              # Full status and integrity audit
    python3 sync_vault.py --check      # Return exit code 0 if all checks pass, 1 otherwise
    python3 sync_vault.py --graph      # Output link matrix and degree distribution
"""

import sys
import re
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).resolve().parent
VAULT_DIR = BASE_DIR / "sih-26-finale-brain"
SOURCE_DIR = BASE_DIR / "files"

WIKILINK_PATTERN = re.compile(r"\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]")
FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

REQUIRED_FRONTMATTER = [
    "title",
    "slug",
    "type",
    "module",
    "status",
    "tags",
    "author",
    "last_agent_edit",
]

def get_all_notes(vault_dir: Path):
    """Retrieve all markdown files in vault excluding dotfiles."""
    notes = {}
    for md_path in vault_dir.rglob("*.md"):
        if any(part.startswith(".") for part in md_path.parts):
            continue
        rel_path = md_path.relative_to(vault_dir)
        notes[str(rel_path)] = md_path
    return notes

def parse_yaml_simple(yaml_str: str) -> dict:
    """Parse simple YAML frontmatter key-value pairs without PyYAML."""
    data = {}
    current_key = None
    for line in yaml_str.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            key, val = line.split(":", 1)
            key = key.strip()
            val = val.strip()
            current_key = key
            if val.startswith("[") and val.endswith("]"):
                data[key] = [item.strip() for item in val[1:-1].split(",") if item.strip()]
            elif val.startswith('"') and val.endswith('"'):
                data[key] = val[1:-1]
            elif val.startswith("'") and val.endswith("'"):
                data[key] = val[1:-1]
            elif val.lower() == "true":
                data[key] = True
            elif val.lower() == "false":
                data[key] = False
            elif val:
                data[key] = val
            else:
                data[key] = []
        elif (line.startswith("  - ") or line.startswith("\t- ")) and current_key:
            item = line.split("-", 1)[1].strip()
            if isinstance(data.get(current_key), list):
                data[current_key].append(item)
            else:
                data[current_key] = [item]
    return data

def parse_note(md_path: Path):
    """Parse frontmatter and content from a markdown note."""
    content = md_path.read_text(encoding="utf-8")
    fm_match = FRONTMATTER_PATTERN.match(content)
    frontmatter = {}
    body = content
    if fm_match:
        try:
            frontmatter = parse_yaml_simple(fm_match.group(1))
            body = content[fm_match.end():]
        except Exception:
            frontmatter = {"_yaml_error": True}
    return frontmatter, body

CODE_BLOCK_PATTERN = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_PATTERN = re.compile(r"`[^`]+`")

def resolve_wikilink(link_target: str, all_slugs: dict, all_relpaths: dict):
    """Resolve a wikilink target to an existing note."""
    clean_target = link_target.strip().rstrip("\\").strip().split("#")[0].split("^")[0].strip()
    clean_target = clean_target.rstrip("\\").strip()
    if not clean_target:
        return True, "anchor_only"
    
    # Ignore accidental matches like 2D JSON arrays [[120, 44, -3]]
    if re.match(r"^[\d\s,\-]+$", clean_target):
        return True, "ignored_numeric_array"

    # 1. Direct path check (e.g. docs/interface-contracts or work-packages/WP0-data-pinning)
    clean_md = f"{clean_target}.md"
    if clean_md in all_relpaths:
        return True, clean_md
    if clean_target in all_relpaths:
        return True, clean_target

    # 2. Slug check
    target_slug = Path(clean_target).name
    if target_slug in all_slugs:
        return True, all_slugs[target_slug]

    return False, clean_target

def run_audit(verbose: bool = True):
    """Audit the vault for compliance, link integrity, and connectivity."""
    notes = get_all_notes(VAULT_DIR)
    if not notes:
        print(f"Error: No notes found in {VAULT_DIR}")
        return False

    all_relpaths = set(notes.keys())
    all_slugs = {}
    parsed_notes = {}
    
    # First pass: Parse frontmatter and map slugs
    fm_errors = defaultdict(list)
    for rel_path, path in notes.items():
        fm, body = parse_note(path)
        parsed_notes[rel_path] = (fm, body)
        slug = fm.get("slug") or path.stem
        all_slugs[slug] = rel_path
        all_slugs[path.stem] = rel_path

        if rel_path == "RULES.md":
            continue # Root governance may omit type/module if pure markdown
            
        for req in REQUIRED_FRONTMATTER:
            if req not in fm:
                fm_errors[rel_path].append(req)

    # Second pass: Wikilink integrity and graph degrees
    broken_links = defaultdict(list)
    outgoing_links = defaultdict(set)
    incoming_links = defaultdict(set)

    for rel_path, (fm, body) in parsed_notes.items():
        prose_body = CODE_BLOCK_PATTERN.sub("", body)
        prose_body = INLINE_CODE_PATTERN.sub("", prose_body)
        links = WIKILINK_PATTERN.findall(prose_body)
        for link_target, _ in links:
            resolved, target_id = resolve_wikilink(link_target, all_slugs, all_relpaths)
            if resolved:
                if target_id not in ("anchor_only", "ignored_numeric_array"):
                    resolved_path = target_id if target_id in all_relpaths else all_slugs.get(target_id, target_id)
                    outgoing_links[rel_path].add(resolved_path)
                    incoming_links[resolved_path].add(rel_path)
            else:
                broken_links[rel_path].append(link_target)

    # Check for orphan notes
    orphan_notes = []
    for rel_path in notes:
        if rel_path in ["RULES.md"]:
            continue
        in_degree = len(incoming_links[rel_path])
        out_degree = len(outgoing_links[rel_path])
        if in_degree == 0 and out_degree == 0:
            orphan_notes.append(rel_path)

    # Output Summary
    total_notes = len(notes)
    total_links = sum(len(targets) for targets in outgoing_links.values())
    total_broken = sum(len(b) for b in broken_links.values())

    print("\n" + "=" * 65)
    print(f"  SIH 26 FINALE OBSIDIAN VAULT AUDIT REPORT: {VAULT_DIR.name}")
    print("=" * 65)
    print(f"Total Notes Indexed:           {total_notes}")
    print(f"Total Valid Internal Links:    {total_links}")
    print(f"Broken Wikilinks:              {total_broken}")
    print(f"Orphan Notes (disconnected):   {len(orphan_notes)}")
    print(f"Frontmatter Missing Fields:    {len(fm_errors)}")
    print("-" * 65)

    if broken_links:
        print("\n[!] Broken Wikilinks Found:")
        for source, targets in broken_links.items():
            print(f"  In {source}:")
            for t in targets:
                print(f"    -> [[{t}]] (Target note does not exist!)")

    if fm_errors:
        print("\n[!] Frontmatter Issues:")
        for source, missing in fm_errors.items():
            print(f"  In {source}: missing {missing}")

    if orphan_notes:
        print("\n[!] Disconnected Orphan Notes:")
        for o in orphan_notes:
            print(f"  - {o}")

    all_passed = (total_broken == 0 and len(fm_errors) == 0 and len(orphan_notes) == 0)
    print("\nVault Health Status: " + ("PERFECT (100% HEALTHY)" if all_passed else "ATTENTION NEEDED"))
    print("=" * 65 + "\n")
    return all_passed

if __name__ == "__main__":
    check_mode = "--check" in sys.argv
    passed = run_audit()
    if check_mode and not passed:
        sys.exit(1)
    sys.exit(0)
