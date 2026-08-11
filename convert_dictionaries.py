#!/usr/bin/env python3
"""
Convert Yomitan-format dictionaries to LinguaReader TypeScript format.
Yomitan format: [word, reading, pos_tags, extra_tags, sequence, structured_content]
"""

import json
import os
import re
import zipfile
from pathlib import Path

# --- Config ---
DOWNLOAD_DIR = Path.home() / "Downloads"
OUTPUT_DIR = Path(__file__).resolve().parent / "app" / "src" / "lib"
MAX_ENTRIES = 15000

DICTS = [
    {"zip": "wty-de-en.zip", "lang": "de", "file": "germanDictionary.ts",
     "interface": "GermanWordEntry", "var": "germanDictionary",
     "data_type": "GermanWordEntry", "lookup_fn": "getGermanDefinition"},
    {"zip": "wty-fr-en.zip", "lang": "fr", "file": "frenchDictionary.ts",
     "interface": "FrenchWordEntry", "var": "frenchDictionary",
     "data_type": "FrenchWordEntry", "lookup_fn": "getFrenchDefinition"},
    {"zip": "wty-ja-zh.zip", "lang": "ja", "file": "japaneseDictionary.ts",
     "interface": "JapaneseWordEntry", "var": "japaneseDictionary",
     "data_type": "JapaneseWordEntry", "lookup_fn": "getJapaneseDefinition"},
    {"zip": "wty-uk-en.zip", "lang": "uk", "file": "ukrainianDictionary.ts",
     "interface": "UkrainianWordEntry", "var": "ukrainianDictionary",
     "data_type": "UkrainianWordEntry", "lookup_fn": "getUkrainianDefinition"},
    {"zip": "wty-pl-en.zip", "lang": "pl", "file": "polishDictionary.ts",
     "interface": "PolishWordEntry", "var": "polishDictionary",
     "data_type": "PolishWordEntry", "lookup_fn": "getPolishDefinition"},
]

# --- Extract text from structured-content recursively ---
def extract_text_from_structured(sc):
    """Recursively extract all plain text from Yomitan structured-content."""
    texts = []
    
    def walk(node):
        if isinstance(node, str):
            t = node.strip()
            if t:
                texts.append(t)
        elif isinstance(node, dict):
            # Skip backlinks, etymology details, grammar details 
            # Keep glosses, definitions, examples
            node_type = node.get("type", "")
            data = node.get("data", {})
            content_type = data.get("content", "") if isinstance(data, dict) else ""
            
            # Skip these sections
            if content_type in ("details-entry-Etymology", "details-entry-Grammar", 
                               "Etymology-content", "Grammar-content",
                               "details-entry-Synonyms", "details-entry-RelatedTerms",
                               "details-entry-Antonyms", "details-entry-SeeAlso",
                               "details-entry-DerivedTerms", "details-entry-Related",
                               "details-entry-Conjugation", "details-entry-Declension",
                               "details-entry-Inflection", "details-entry-UsageNotes",
                               "details-entry-References",
                               "synonyms", "antonyms", "related", "derived", "see-also",
                               "cross-references", "etymology"):
                return
            
            if content_type in ("preamble", "details-entry-Pronunciation", 
                               "details-entry-Compounds", "details-entry-Descendants",
                               "details-entry-Translations", "details-entry-Anagrams",
                               "details-entry-FurtherReading", "details-entry-Statistics"):
                return

            content = node.get("content", [])
            if isinstance(content, list):
                for child in content:
                    walk(child)
            elif isinstance(content, str):
                t = content.strip()
                if t:
                    texts.append(t)
        elif isinstance(node, list):
            for child in node:
                walk(child)
    
    if isinstance(sc, list):
        for item in sc:
            walk(item)
    else:
        walk(sc)
    
    return texts


def extract_glosses(sc):
    """Extract only gloss/definition texts from structured-content."""
    glosses = []
    
    def walk_glosses(node, in_glosses=False):
        if isinstance(node, str):
            t = node.strip()
            if t and in_glosses:
                glosses.append(t)
        elif isinstance(node, dict):
            data = node.get("data", {})
            content_type = data.get("content", "") if isinstance(data, dict) else ""
            
            # Enter glosses section
            if content_type == "glosses":
                new_in = True
            else:
                new_in = in_glosses
            
            # Skip non-definition sections
            skip_types = {
                "details-entry-Etymology", "details-entry-Grammar",
                "Etymology-content", "Grammar-content",
                "details-entry-Synonyms", "details-entry-Antonyms",
                "synonyms", "antonyms", "etymology", "backlink",
                "synonyms-label", "antonyms-label", "summary-entry",
                "tags", "preamble", "details-entry-Pronunciation",
                "details-entry-Conjugation", "details-entry-Declension",
                "details-entry-Inflection", "details-entry-References",
            }
            
            if content_type in skip_types and not in_glosses:
                return
            
            content = node.get("content", [])
            if isinstance(content, list):
                for child in content:
                    walk_glosses(child, new_in)
            elif isinstance(content, str):
                t = content.strip()
                if t and new_in:
                    glosses.append(t)
        elif isinstance(node, list):
            for child in node:
                walk_glosses(child, in_glosses)
    
    if isinstance(sc, list):
        for item in sc:
            walk_glosses(item, False)
    else:
        walk_glosses(sc, False)
    
    # Clean up glosses - remove very short ones and grammar markers
    cleaned = []
    for g in glosses:
        g = g.strip()
        # Skip very short or non-definition glosses
        if len(g) < 2:
            continue
        # Skip pure grammar descriptions
        if re.match(r'^(table of |conjugation of |declension of |this entry)', g, re.IGNORECASE):
            continue
        cleaned.append(g)
    
    return cleaned


def map_pos(tags_str):
    """Map Yomitan POS tags to a simplified part of speech."""
    if not tags_str:
        return ""
    tags = tags_str.split()
    
    # Priority-based mapping
    for tag in tags:
        tag_lower = tag.lower()
        if tag_lower in ('n', 'noun'):
            return 'noun'
        if tag_lower in ('v', 'verb', 'verbal'):
            return 'verb'
        if tag_lower in ('adj', 'adjective', 'adjectival'):
            return 'adjective'
        if tag_lower in ('adv', 'adverb', 'adverbial'):
            return 'adverb'
        if tag_lower in ('pron', 'pronoun'):
            return 'pronoun'
        if tag_lower in ('prep', 'preposition'):
            return 'preposition'
        if tag_lower in ('conj', 'conjunction'):
            return 'conjunction'
        if tag_lower in ('interj', 'interjection'):
            return 'interjection'
        if tag_lower in ('art', 'article'):
            return 'article'
        if tag_lower in ('num', 'numeral'):
            return 'numeral'
        if tag_lower in ('pref', 'prefix'):
            return 'prefix'
        if tag_lower in ('suf', 'suffix', 'suff'):
            return 'suffix'
        if tag_lower in ('part', 'particle'):
            return 'particle'
        if tag_lower in ('name', 'proper'):
            return 'proper noun'
        if tag_lower in ('char', 'character'):
            return 'character'
    
    # Default: use the first tag
    for tag in tags:
        if tag and not tag.startswith(('n ', 'v ', 'adj ', 'm', 'f', 'neut', 'masc', 'fem', 
                                         'strong', 'weak', 'mixed', 'not-comp', 'col', 
                                         'arch', 'fig', 'rare', 'dated', 'aux', 'impf',
                                         'pf', 'inan', 'anim', 'pers', 'imperf', 'perf',
                                         'irreg', 'ordinal', 'cardinal', 'di')):
            return tag
    
    return tags[0] if tags else ""


def escape_ts_string(s):
    """Escape a string for inclusion in a TypeScript single-quoted string."""
    s = s.replace('\\', '\\\\')
    s = s.replace("'", "\\'")
    s = s.replace('\n', '\\n')
    s = s.replace('\r', '')
    return s


def generate_ts_file(lang_info, entries):
    """Generate a TypeScript dictionary file."""
    interface = lang_info["interface"]
    var_name = lang_info["var"]
    data_type = lang_info["data_type"]
    lang = lang_info["lang"]
    lookup_fn = lang_info["lookup_fn"]
    
    # Build interface based on language
    if lang == "ja":
        interface_def = f"""export interface {interface} {{
  word: string;
  reading?: string;
  phonetic?: string;
  partOfSpeech: string;
  definitions: string[];
  examples?: string[];
}}"""
    else:
        interface_def = f"""export interface {interface} {{
  word: string;
  phonetic?: string;
  partOfSpeech: string;
  definitions: string[];
  examples?: string[];
}}"""
    
    # Build dictionary entries
    entries_lines = []
   
    # Sort by word length then alphabetically 
    entries.sort(key=lambda e: (len(e["word"]), e["word"].lower()))
    
    # Remove duplicates keeping first occurrence (which is shorter word usually)
    seen = set()
    unique_entries = []
    for e in entries:
        key = e["word"].lower().strip()
        if key not in seen:
            seen.add(key)
            unique_entries.append(e)
    
    entries = unique_entries
    
    for e in entries:
        word = escape_ts_string(e["word"])
        pos = escape_ts_string(e.get("partOfSpeech", ""))
        defs = [escape_ts_string(d) for d in e.get("definitions", [])]
        
        if lang == "ja":
            reading = escape_ts_string(e.get("reading", "") or "")
            phonetic = escape_ts_string(e.get("phonetic", "") or "")
            
            entry_str = f"  '{word}': {{ word: '{word}'"
            if reading:
                entry_str += f", reading: '{reading}'"
            if phonetic:
                entry_str += f", phonetic: '{phonetic}'"
            if pos:
                entry_str += f", partOfSpeech: '{pos}'"
            if defs:
                defs_str = ", ".join(f"'{d}'" for d in defs)
                entry_str += f", definitions: [{defs_str}]"
            
            entry_str += " }"
        else:
            entry_str = f"  '{word}': {{ word: '{word}'"
            if pos:
                entry_str += f", partOfSpeech: '{pos}'"
            if defs:
                defs_str = ", ".join(f"'{d}'" for d in defs)
                entry_str += f", definitions: [{defs_str}]"
            
            entry_str += " }"
        
        entries_lines.append(entry_str)
    
    # Output
    content = f"""// {lang.upper()} dictionary - auto-generated from Yomitan/Wiktionary data
{interface_def}

export const {var_name}: Record<string, {data_type}> = {{
{
  ",\n".join(entries_lines)
}
}};

// Simple direct lookup function
export function {lookup_fn}(word: string): {data_type} | undefined {{
  return {var_name}[word.toLowerCase().trim()];
}}
"""
    
    return content


def process_dictionary(dict_info):
    """Process a single Yomitan dictionary zip file."""
    zip_path = DOWNLOAD_DIR / dict_info["zip"]
    lang = dict_info["lang"]
    
    print(f"\n{'='*60}")
    print(f"Processing: {dict_info['zip']} ({lang})")
    print(f"{'='*60}")
    
    if not zip_path.exists():
        print(f"ERROR: {zip_path} not found!")
        return None
    
    entries = []
    total_raw = 0
    good_entries = 0
    skipped_no_def = 0
    
    with zipfile.ZipFile(zip_path, 'r') as zf:
        # Find all term_bank files
        term_files = sorted([f for f in zf.namelist() if f.startswith('term_bank_') and f.endswith('.json')])
        print(f"Found {len(term_files)} term bank files")
        
        for tf in term_files:
            with zf.open(tf) as f:
                raw_terms = json.loads(f.read().decode('utf-8'))
            
            file_good = 0
            for term in raw_terms:
                total_raw += 1
                word = (term[0] or "").strip()
                if not word:
                    continue
                
                # Skip single character entries that aren't common
                if len(word) == 1 and ord(word[0]) > 127:
                    # Keep Latin/Cyrillic single chars, skip CJK radicals
                    if word[0] in ('Ａ','Ｂ','Ｃ','Ｄ','Ｅ','Ｆ','Ｇ','Ｈ','Ｉ','Ｊ','Ｋ','Ｌ',
                                   'Ｍ','Ｎ','Ｏ','Ｐ','Ｑ','Ｒ','Ｓ','Ｔ','Ｕ','Ｖ','Ｗ','Ｘ','Ｙ','Ｚ',
                                   'ａ','ｂ','ｃ','ｄ','ｅ','ｆ','ｇ','ｈ','ｉ','ｊ','ｋ','ｌ',
                                   'ｍ','ｎ','ｏ','ｐ','ｑ','ｒ','ｓ','ｔ','ｕ','ｖ','ｗ','ｘ','ｙ','ｚ'):
                        continue
                
                # Skip words with too many special characters
                special_count = sum(1 for c in word if not c.isalnum() and c not in "'’- ")
                if special_count > len(word) * 0.3:
                    continue
                
                # Parse structured content
                sc = term[5]
                glosses = extract_glosses(sc)
                
                if not glosses:
                    skipped_no_def += 1
                    continue
                
                # Get part of speech
                pos = map_pos(term[2])
                
                # Get reading (important for Japanese)
                reading = (term[1] or "").strip()
                
                # Limit definitions
                defs = glosses[:5]  # max 5 definitions
                
                entry = {
                    "word": word,
                    "partOfSpeech": pos,
                    "definitions": defs,
                }
                
                if lang == "ja" and reading:
                    entry["reading"] = reading
                
                entries.append(entry)
                file_good += 1
            
            good_entries += file_good
        
        total_raw += skipped_no_def  # already counted
        rate = (good_entries / total_raw * 100) if total_raw > 0 else 0
    
    print(f"Total raw entries: {total_raw}")
    print(f"Entries with definitions: {good_entries} ({rate:.1f}%)")
    print(f"Skipped (no glosses): {skipped_no_def}")
    
    # Sort by word length (shorter first), then alphabetically
    entries.sort(key=lambda e: (len(e["word"]), e["word"].lower()))
    
    # Limit
    if len(entries) > MAX_ENTRIES:
        entries = entries[:MAX_ENTRIES]
        print(f"Limited to top {MAX_ENTRIES} entries (shortest words first)")
    
    # Generate TS content
    ts_content = generate_ts_file(dict_info, entries)
    
    # Write file
    out_path = OUTPUT_DIR / dict_info["file"]
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(ts_content)
    
    file_size = out_path.stat().st_size / (1024 * 1024)
    print(f"Written {out_path} ({file_size:.1f} MB, {len(entries)} entries)")
    
    # Show sample entries
    print(f"Sample entries:")
    for e in entries[:10]:
        defs = ", ".join(e["definitions"][:2])
        word_len = e["word"]
        print(f"  {word_len}: {defs[:80]}")
    
    return entries


def extract_and_map_reading(entries_dict, lang):
    """For Japanese, try to extract reading from word itself or from structured content."""
    if lang != "ja":
        return entries_dict
    # Japanese reading extraction would need furigana data
    # For now, leave as-is from Yomitan data
    return entries_dict


def main():
    for d in DICTS:
        process_dictionary(d)
    
    print("\n" + "="*60)
    print("DONE! All dictionaries converted.")
    print("="*60)


if __name__ == "__main__":
    main()
