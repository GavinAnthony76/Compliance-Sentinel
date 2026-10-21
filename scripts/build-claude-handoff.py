"""Package the verified documentation only; never include code, logs, or secrets."""

from pathlib import Path
import importlib.util
import json
import re
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts" / "claude-handoff"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / "docs" / "claude-handoff"
ORDER = [
    "README.md", "ARCHITECTURE.md", "FEATURE-INVENTORY.md", "DATABASE.md",
    "INTEGRATIONS.md", "BACKLOG.md", "BASELINE.md", "REGRESSION-GUARDRAILS.md",
    "REPLIT-ENVIRONMENT.md", "GIT-WORKFLOW.md", "VALIDATION.md", "ROLLBACK.md",
    "CLAUDE-INSTRUCTIONS.md",
]
NAME = "GreenSynk-Claude-Engineering-Handoff"

spec = importlib.util.spec_from_file_location("guide", ROOT / "scripts" / "build-product-guide.py")
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)


def print_markdown(source):
    """Keep shell code as separate paragraphs in reading-oriented exports."""
    source = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", source)
    result, in_code = [], False
    for line in source.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            result.append("")
        elif in_code:
            result.extend(["`" + line.replace("`", "") + "`", ""])
        else:
            result.append(line)
    return "\n".join(result)


def main():
    documents = [(name, (SOURCE / name).read_text()) for name in ORDER]
    assert len(documents) == 13
    combined = "\n\n".join(text for _, text in documents)
    blocks = []
    for name, text in documents:
        current = guide.parse_markdown(print_markdown(text))
        if current:
            current[0]["file"] = name
        blocks.extend(current)
    (OUT / "handoff-blocks.json").write_text(json.dumps(blocks, ensure_ascii=False, indent=2))
    (OUT / (NAME + ".md")).write_text(combined)
    word = OUT / (NAME + ".docx")
    guide.render_docx(blocks, word)
    with zipfile.ZipFile(word) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    parts["word/footer1.xml"] = parts["word/footer1.xml"].replace(
        b"Product &amp; Technical Reference", b"Claude Engineering Handoff"
    )
    with zipfile.ZipFile(word, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    with zipfile.ZipFile(word) as z:
        assert z.testzip() is None
        for name in z.namelist():
            if name.endswith((".xml", ".rels")):
                ET.fromstring(z.read(name))
    print(json.dumps({"documents": len(documents), "words": len(combined.split()),
                      "blocks": len(blocks), "word": str(word)}))


if __name__ == "__main__":
    main()
