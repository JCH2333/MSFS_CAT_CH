#!/usr/bin/env python3
"""Create, validate, install and restore GSX native-dialog image localizations.

This tool is deliberately build-time only. It never modifies Python bytecode,
executables, GSX checksums or user configuration; only files below GSX/res.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:
    raise SystemExit("缺少 Pillow。请在制作环境安装 Pillow 后重试。") from error

TOOL_VERSION = "1.0.0"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_ROOT = Path(__file__).resolve().parent
DEFAULT_RUNTIME = Path(r"F:\games\MSF tools\Addon Manager\couatl\GSX\res")
DEFAULT_BACKUPS = PROJECT_ROOT / ".local-backups" / "gsx-runtime"
DEFAULT_OUTPUT = TOOL_ROOT / "output"
CACHE_ROOT = TOOL_ROOT / "cache"
MANIFEST_NAME = "backup-manifest.json"
OUTPUT_MANIFEST_NAME = "output-manifest.json"
INSTALL_RECORD_NAME = "image-installation-record.json"
HELP_IMAGES = {"editorHelp.png", "editorHelp_MSFS.png"}
ALLOWED_EXTENSIONS = {".png", ".html", ".xrc", ".ttf", ".otf", ".ttc"}
PROCESS_NAMES = {
    "FlightSimulator2024.exe",
    "FlightSimulator.exe",
    "couatl64_MSFS2024.exe",
    "couatl64_MSFS.exe",
    "Couatl_Updater.exe",
    "Couatl_Updater2.exe",
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fail(message: str) -> None:
    raise SystemExit(f"错误：{message}")


def resolve_runtime(value: str | None) -> Path:
    result = Path(value).expanduser().resolve() if value else DEFAULT_RUNTIME
    if result.name.lower() != "res":
        fail(f"目标必须是 GSX 的 res 目录，而不是：{result}")
    if not result.is_dir():
        fail(f"找不到 GSX res 目录：{result}")
    return result


def gsx_version(value: str | None) -> str:
    if value:
        return value
    manifest = Path(r"F:\games\community\community\fsdreamteam-gsx-pro\manifest.json")
    if manifest.is_file():
        try:
            return str(read_json(manifest).get("package_version") or "unknown")
        except (OSError, ValueError):
            pass
    return "unknown"


def selected_assets(runtime: Path) -> list[Path]:
    files = sorted(runtime.glob("btn_*.png"))
    files += [runtime / name for name in sorted(HELP_IMAGES) if (runtime / name).is_file()]
    files += [runtime / name for name in ("editorHelp.html", "editorHelp_MSFS.html", "resources.xrc") if (runtime / name).is_file()]
    fonts = runtime / "fonts"
    if fonts.is_dir():
        files += sorted(path for path in fonts.rglob("*") if path.is_file() and path.suffix.lower() in {".ttf", ".otf", ".ttc"})
    return files


def to_relative(path: Path, runtime: Path) -> str:
    relative = path.relative_to(runtime)
    if relative.is_absolute() or ".." in relative.parts:
        fail(f"发现不安全路径：{path}")
    return relative.as_posix()


def file_record(path: Path, runtime: Path, version: str) -> dict[str, Any]:
    stat = path.stat()
    return {
        "absolutePath": str(path),
        "relativePath": to_relative(path, runtime),
        "kind": "image" if path.suffix.lower() == ".png" else ("font" if path.suffix.lower() in {".ttf", ".otf", ".ttc"} else "resource"),
        "size": stat.st_size,
        "sha256": sha256(path),
        "createdAt": dt.datetime.fromtimestamp(stat.st_ctime, dt.timezone.utc).isoformat(),
        "modifiedAt": dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat(),
        "gsxVersion": version,
        "backupToolVersion": TOOL_VERSION,
    }


def backup_matches(manifest: dict[str, Any], backup_dir: Path, runtime: Path, check_source: bool) -> tuple[bool, list[str]]:
    issues: list[str] = []
    if manifest.get("runtimeDirectory") != str(runtime):
        issues.append("备份记录的运行时目录不一致")
    for entry in manifest.get("files", []):
        relative = Path(entry["relativePath"])
        backup_file = backup_dir / "files" / relative
        source_file = runtime / relative
        if not backup_file.is_file():
            issues.append(f"备份缺失：{relative}")
            continue
        if backup_file.stat().st_size != entry["size"] or sha256(backup_file) != entry["sha256"]:
            issues.append(f"备份哈希不匹配：{relative}")
        if check_source:
            if not source_file.is_file():
                issues.append(f"运行时文件缺失：{relative}")
            elif source_file.stat().st_size != entry["size"] or sha256(source_file) != entry["sha256"]:
                issues.append(f"运行时文件已改变：{relative}")
    return not issues, issues


def locate_backup(runtime: Path, version: str, backup_root: Path, require_source_match: bool = False) -> tuple[Path, dict[str, Any]]:
    candidates = [backup_root / version] + sorted(backup_root.glob(f"{version}-changed-*"), reverse=True)
    for backup_dir in candidates:
        manifest_path = backup_dir / MANIFEST_NAME
        if not manifest_path.is_file():
            continue
        try:
            manifest = read_json(manifest_path)
        except (OSError, ValueError):
            continue
        ok, _ = backup_matches(manifest, backup_dir, runtime, require_source_match)
        if ok:
            return backup_dir, manifest
    fail(f"未找到可用的 {version} 原始备份；请先运行 backup。")


def create_backup(runtime: Path, version: str, backup_root: Path) -> Path:
    assets = selected_assets(runtime)
    if not assets:
        fail(f"目标目录没有可备份的 GSX 图片资源：{runtime}")
    primary = backup_root / version
    if (primary / MANIFEST_NAME).is_file():
        existing = read_json(primary / MANIFEST_NAME)
        complete, issues = backup_matches(existing, primary, runtime, check_source=True)
        if complete:
            print(f"复用已校验备份：{primary}")
            return primary
        timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_dir = backup_root / f"{version}-changed-{timestamp}"
        print("同版本原始文件已变化，保留旧备份并建立新快照。")
        if issues:
            print("；".join(issues[:3]))
    else:
        backup_dir = primary
    if backup_dir.exists():
        fail(f"备份目录已存在，拒绝覆盖：{backup_dir}")
    files: list[dict[str, Any]] = []
    for source in assets:
        record = file_record(source, runtime, version)
        destination = backup_dir / "files" / record["relativePath"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        files.append(record)
    manifest = {
        "schemaVersion": 1,
        "createdAt": utc_now(),
        "toolVersion": TOOL_VERSION,
        "gsxVersion": version,
        "runtimeDirectory": str(runtime),
        "files": files,
    }
    write_json(backup_dir / MANIFEST_NAME, manifest)
    valid, issues = backup_matches(manifest, backup_dir, runtime, check_source=True)
    if not valid:
        fail("备份校验失败，已停止：" + "；".join(issues))
    print(f"已建立并校验备份：{backup_dir}")
    return backup_dir


def inspect_processes() -> list[str]:
    try:
        output = subprocess.check_output(["tasklist", "/FO", "CSV", "/NH"], text=True, encoding="utf-8", errors="replace")
    except (OSError, subprocess.CalledProcessError):
        return []
    return [name for name in PROCESS_NAMES if re.search(rf'^"{re.escape(name)}"', output, re.IGNORECASE | re.MULTILINE)]


def load_glossary(path: Path) -> dict[str, str]:
    data = read_json(path)
    return {str(key): str(value) for key, value in data.get("translations", {}).items()}


def source_label(filename: str) -> str:
    name = re.sub(r"_hover|_pressed", "", Path(filename).stem.lower())
    words = name.removeprefix("btn_").replace("_", " ").strip()
    return words.title()


def cache_key(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def translate_with_openai(source: str, context: str, glossary: dict[str, str]) -> dict[str, Any] | None:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    cache_file = CACHE_ROOT / "translations" / f"{cache_key(source + context)}.json"
    if cache_file.is_file():
        return read_json(cache_file)
    payload = {
        "model": os.environ.get("GSX_LOCALIZER_MODEL", "gpt-5.3-codex"),
        "store": False,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": (
            "Translate a GSX native-dialog UI string to Simplified Chinese. "
            "Return JSON only with source, translation, action, confidence, reason. "
            "action is translate or preserve. Keep airport codes, numbers, function keys, Numpad keys and product names unchanged. "
            f"source={source!r}; context={context!r}; glossary={json.dumps(glossary, ensure_ascii=False)}"
        )}]}],
        "text": {"format": {"type": "json_schema", "name": "gsx_translation", "strict": True, "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["source", "translation", "action", "confidence", "reason"],
            "properties": {
                "source": {"type": "string"},
                "translation": {"type": "string"},
                "action": {"type": "string", "enum": ["translate", "preserve"]},
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
            },
        }}},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result.get("output_text")
        translation = json.loads(content) if isinstance(content, str) else None
        if not translation:
            return None
        write_json(cache_file, translation)
        return translation
    except (urllib.error.URLError, ValueError, OSError) as error:
        print(f"GPT 翻译不可用，已跳过：{error}", file=sys.stderr)
        return None


def resolve_translation(source: str, filename: str, glossary: dict[str, str], use_gpt: bool) -> tuple[str, dict[str, Any]]:
    if source in glossary:
        return glossary[source], {"provider": "glossary", "confidence": 1.0, "source": source}
    if use_gpt:
        result = translate_with_openai(source, filename, glossary)
        if result and result.get("action") == "translate" and result.get("translation"):
            return str(result["translation"]), {"provider": "openai", **result}
    return source, {"provider": "untranslated", "confidence": 0.0, "source": source}


def chinese_font(runtime: Path, size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        runtime / "fonts" / "msyh.ttc",
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyh.ttc",
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "simhei.ttf",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def find_text_box(image: Image.Image, right_margin: int = 44) -> tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    # Buttons come in both light-background/dark-text and blue-background/
    # light-text variants. Sample an unused point at the left to detect text
    # by contrast, rather than assuming a particular foreground colour.
    background = pixels[min(6, rgba.width - 1), rgba.height // 2]
    candidates: list[tuple[int, int]] = []
    # Exclude the button outline/shadow. Including it would make the text box
    # span the whole image and could destroy its border during redrawing.
    for y in range(5, max(5, rgba.height - 5)):
        for x in range(10, max(11, rgba.width - right_margin - 4)):
            r, g, b, alpha = pixels[x, y]
            contrast = max(abs(r - background[0]), abs(g - background[1]), abs(b - background[2]))
            if alpha > 120 and contrast >= 55:
                candidates.append((x, y))
    if not candidates:
        return None
    xs, ys = zip(*candidates)
    return max(3, min(xs) - 2), max(1, min(ys) - 2), min(rgba.width - right_margin, max(xs) + 3), min(rgba.height - 1, max(ys) + 3)


def localize_button(source: Path, destination: Path, translation: str, runtime: Path) -> dict[str, Any]:
    original = Image.open(source)
    original_size, original_mode = original.size, original.mode
    original_has_alpha = "A" in original.getbands() or "transparency" in original.info
    image = original.convert("RGBA")
    box = find_text_box(image)
    if not box:
        raise ValueError("未检测到可清除的按钮文字")
    draw = ImageDraw.Draw(image)
    # Buttons use a flat/patterned background; sample the pixels just above the text first.
    sx = min(max(box[0], 0), image.width - 1)
    sy = min(max(box[1] - 3, 0), image.height - 1)
    background = image.getpixel((sx, sy))
    draw.rectangle(box, fill=background)
    text_left = 8
    text_right = image.width - 44 - 5
    max_width = max(4, text_right - text_left)
    font_size = max(10, min(20, int((box[3] - box[1]) * 1.25)))
    font = chinese_font(runtime, font_size)
    while font_size > 8 and draw.textbbox((0, 0), translation, font=font)[2] > max_width:
        font_size -= 1
        font = chinese_font(runtime, font_size)
    text_box = draw.textbbox((0, 0), translation, font=font)
    if text_box[2] > max_width:
        raise ValueError(f"译文过宽：{translation}")
    x = text_left + (max_width - text_box[2]) // 2
    y = (image.height - (text_box[3] - text_box[1])) // 2 - text_box[1]
    luminance = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]
    color = (20, 20, 20, 255) if luminance > 170 else (235, 235, 235, 255)
    draw.text((x, y), translation, font=font, fill=color)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image_to_save = image if original_has_alpha else image.convert("RGB")
    image_to_save.save(destination, "PNG")
    rendered = Image.open(destination)
    rendered_has_alpha = "A" in rendered.getbands() or "transparency" in rendered.info
    if rendered.size != original_size or rendered_has_alpha != original_has_alpha:
        raise ValueError("PNG 尺寸或透明通道改变")
    return {"textBox": box, "translation": translation, "size": list(original_size), "sourceMode": original_mode}


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None or shutil.which("tesseract.exe") is not None


def build_output(runtime: Path, version: str, backup_root: Path, output_root: Path, use_gpt: bool) -> Path:
    backup_dir, backup = locate_backup(runtime, version, backup_root, require_source_match=True)
    if output_root.exists():
        shutil.rmtree(output_root)
    files_root = output_root / "files"
    glossary = load_glossary(TOOL_ROOT / "glossary.json")
    records: list[dict[str, Any]] = []
    failures: list[str] = []
    buttons = [entry for entry in backup["files"] if Path(entry["relativePath"]).name.startswith("btn_") and entry["relativePath"].endswith(".png")]
    if not buttons:
        fail("备份中没有按钮图片，无法开始图片汉化。")
    for entry in buttons:
        relative = Path(entry["relativePath"])
        source = backup_dir / "files" / relative
        label = source_label(relative.name)
        translation, translation_info = resolve_translation(label, relative.name, glossary, use_gpt)
        if translation_info["provider"] == "untranslated":
            failures.append(f"{relative}: 缺少翻译")
            continue
        try:
            details = localize_button(source, files_root / relative, translation, runtime)
            records.append({"relativePath": relative.as_posix(), "sourceSha256": entry["sha256"], "sha256": sha256(files_root / relative), "translation": translation, "translationInfo": translation_info, **details})
        except (OSError, ValueError) as error:
            failures.append(f"{relative}: {error}")
    if failures:
        shutil.rmtree(output_root, ignore_errors=True)
        fail("按钮质量门槛未通过，未生成可安装输出：" + "；".join(failures[:8]))
    help_status = {"status": "skipped", "reason": "未配置本地 Tesseract OCR，未处理帮助图。"}
    if tesseract_available():
        help_status = {"status": "manual-review-required", "reason": "OCR 已检测到；帮助图重绘需经人工版面复核，当前版本不会自动写入帮助图。"}
    manifest = {
        "schemaVersion": 1,
        "createdAt": utc_now(),
        "toolVersion": TOOL_VERSION,
        "gsxVersion": version,
        "runtimeDirectory": str(runtime),
        "backupDirectory": str(backup_dir),
        "files": records,
        "helpImages": help_status,
    }
    write_json(output_root / OUTPUT_MANIFEST_NAME, manifest)
    print(f"已生成 {len(records)} 张按钮图片：{output_root}")
    return output_root


def verify_output(output_root: Path) -> tuple[bool, list[str], dict[str, Any]]:
    manifest_path = output_root / OUTPUT_MANIFEST_NAME
    if not manifest_path.is_file():
        return False, ["输出清单缺失"], {}
    manifest = read_json(manifest_path)
    issues: list[str] = []
    for entry in manifest.get("files", []):
        path = output_root / "files" / entry["relativePath"]
        if not path.is_file() or sha256(path) != entry["sha256"]:
            issues.append(f"输出哈希不匹配：{entry['relativePath']}")
    return not issues, issues, manifest


def install_output(runtime: Path, version: str, backup_root: Path, output_root: Path) -> None:
    running = inspect_processes()
    if running:
        fail("检测到游戏、Couatl 或官方更新器仍在运行：" + "，".join(running))
    backup_dir, backup = locate_backup(runtime, version, backup_root, require_source_match=True)
    valid, issues, output = verify_output(output_root)
    if not valid:
        fail("输出校验失败：" + "；".join(issues))
    installed: list[dict[str, Any]] = []
    for entry in output["files"]:
        relative = Path(entry["relativePath"])
        source = output_root / "files" / relative
        target = runtime / relative
        if not target.resolve().is_relative_to(runtime.resolve()):
            fail(f"拒绝越界写入：{relative}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if sha256(target) != entry["sha256"]:
            fail(f"安装后哈希不匹配：{relative}")
        installed.append({"relativePath": relative.as_posix(), "installedSha256": entry["sha256"], "originalSha256": next(item["sha256"] for item in backup["files"] if item["relativePath"] == relative.as_posix())})
    write_json(backup_dir / INSTALL_RECORD_NAME, {
        "schemaVersion": 1, "installedAt": utc_now(), "toolVersion": TOOL_VERSION,
        "gsxVersion": version, "runtimeDirectory": str(runtime), "outputDirectory": str(output_root), "files": installed,
    })
    print(f"已安全安装 {len(installed)} 张图片。")


def restore(runtime: Path, version: str, backup_root: Path) -> None:
    running = inspect_processes()
    if running:
        fail("检测到游戏、Couatl 或官方更新器仍在运行：" + "，".join(running))
    backup_dir, backup = locate_backup(runtime, version, backup_root, require_source_match=False)
    record_path = backup_dir / INSTALL_RECORD_NAME
    if not record_path.is_file():
        fail("没有该版本的图片安装记录，拒绝盲目恢复。")
    installation = read_json(record_path)
    restored, conflicts = [], []
    originals = {item["relativePath"]: item for item in backup["files"]}
    for entry in installation.get("files", []):
        relative = Path(entry["relativePath"])
        target, original = runtime / relative, backup_dir / "files" / relative
        if not target.is_file() or sha256(target) != entry["installedSha256"]:
            conflicts.append(relative.as_posix())
            continue
        shutil.copy2(original, target)
        if sha256(target) != originals[relative.as_posix()]["sha256"]:
            fail(f"恢复后哈希不匹配：{relative}")
        restored.append(relative.as_posix())
    write_json(backup_dir / "image-restore-result.json", {"restoredAt": utc_now(), "restored": restored, "conflicts": conflicts})
    print(f"恢复完成：{len(restored)} 个文件；冲突保留：{len(conflicts)} 个。")


def scan(runtime: Path, version: str) -> None:
    assets = selected_assets(runtime)
    print(json.dumps({
        "runtimeDirectory": str(runtime), "gsxVersion": version, "assetCount": len(assets),
        "buttons": len([path for path in assets if path.name.startswith("btn_")]),
        "helpImages": [path.name for path in assets if path.name in HELP_IMAGES],
        "fonts": len([path for path in assets if path.suffix.lower() in {".ttf", ".otf", ".ttc"}]),
        "tesseractAvailable": tesseract_available(),
    }, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="GSX 原生弹窗图片汉化制作工具（安全备份版）")
    parser.add_argument("--runtime", help="GSX res 目录")
    parser.add_argument("--version", help="GSX 版本（默认从 manifest.json 读取）")
    parser.add_argument("--backup-root", default=str(DEFAULT_BACKUPS))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--with-gpt", action="store_true", help="未命中术语表时使用 OPENAI_API_KEY 翻译")
    parser.add_argument("command", choices=("scan", "backup", "verify-backup", "build", "verify-output", "install", "restore"))
    args = parser.parse_args()
    runtime, version = resolve_runtime(args.runtime), gsx_version(args.version)
    backup_root, output_root = Path(args.backup_root).resolve(), Path(args.output).resolve()
    if args.command == "scan":
        scan(runtime, version)
    elif args.command == "backup":
        create_backup(runtime, version, backup_root)
    elif args.command == "verify-backup":
        directory, manifest = locate_backup(runtime, version, backup_root, require_source_match=False)
        ok, issues = backup_matches(manifest, directory, runtime, check_source=False)
        if not ok:
            fail("备份校验失败：" + "；".join(issues))
        print(f"备份校验通过：{directory}")
    elif args.command == "build":
        build_output(runtime, version, backup_root, output_root, args.with_gpt)
    elif args.command == "verify-output":
        ok, issues, _ = verify_output(output_root)
        if not ok:
            fail("输出校验失败：" + "；".join(issues))
        print(f"输出校验通过：{output_root}")
    elif args.command == "install":
        install_output(runtime, version, backup_root, output_root)
    else:
        restore(runtime, version, backup_root)


if __name__ == "__main__":
    main()
