"""Prompt-injection detection at ingestion (design doc 11.5, layer 4).

This is the weakest of the four defenses and only *flags*: the strong ones are read-only tools,
permission filtering before the LLM, and wrapping retrieved text as data. A flagged item still
gets ingested; if an answer uses it, the answer says an embedded instruction was ignored.
"""

import re

_PATTERNS = [
    # Indonesian
    r"\babaikan\s+(?:semua\s+|seluruh\s+)?(?:instruksi|aturan|perintah|batasan)",
    r"\bjika\s+(?:kamu\s+|anda\s+)?ditanya\b.{0,80}\b(?:jawab|katakan|bilang)\b",
    r"\b(?:tampilkan|bocorkan|berikan)\s+(?:semua|seluruh)\s+(?:data|gaji|informasi|password)",
    r"\b(?:kamu|anda)\s+(?:sekarang|adalah)\s+(?:asisten|ai|admin)\b",
    r"\bjangan\s+(?:sebut|tampilkan|ikuti)\s+(?:sumber|aturan|instruksi)",
    # English
    r"\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)",
    r"\bdisregard\s+(?:all\s+|the\s+|your\s+)?(?:previous\s+|prior\s+)?(?:instructions|rules|guidelines)",
    r"\bif\s+(?:you\s+are|you're)\s+asked\b.{0,80}\b(?:answer|say|reply|respond)\b",
    r"\byou\s+are\s+now\b",
    r"\b(?:system\s+prompt|developer\s+mode|jailbreak)\b",
    r"\boverride\s+(?:your|the|all)\s+(?:instructions|rules|safety)",
    # Addressing the model directly: "AI: ...", "Note to AI", "untuk AI"
    r"(?:^|\n)\s*(?:AI|ChatGPT|Gemini|asisten|assistant)\s*:",
    r"\b(?:note|pesan|catatan)\s+(?:to|untuk)\s+(?:the\s+)?(?:ai|asisten|assistant|llm|model)\b",
]
_REGEX = re.compile("|".join(f"(?:{p})" for p in _PATTERNS), re.IGNORECASE | re.DOTALL)


def detect_injection(text: str) -> list[str]:
    """Matched snippets (empty = clean)."""
    return [m.group(0).strip()[:120] for m in _REGEX.finditer(text)]
