"""Inline CSS, JS and the sample data into one self-contained site/index.html (works on GitHub Pages or file://)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent
d = root.parent / "data"
answers = (d / "answers.jsonl").read_text()
prompts = json.loads((d / "prompts.json").read_text())
data = "window.SAMPLE=" + json.dumps({"answers": answers, "prompts": prompts, "brief": (d / "customer_brief.txt").read_text()}).replace("</", "<\\/") + ";"
sources = "window.SOURCES=" + json.dumps({"app.js": (root / "src/app.js").read_text(), "analysis.py": (root.parent / "aeo/analysis.py").read_text()}).replace("</", "<\\/") + ";"
t = (root / "src/template.html").read_text()
html = (t.replace("/*CSS*/", (root / "src/style.css").read_text())
         .replace("/*DATA*/", data).replace("/*SOURCES*/", sources).replace("/*JS*/", (root / "src/app.js").read_text()))
(root / "index.html").write_text(html)
(root.parent / "docs").mkdir(exist_ok=True)
(root.parent / "docs" / "index.html").write_text(html)  # GitHub Pages serves /docs
print("wrote", root / "index.html", len(html) // 1024, "KB")
