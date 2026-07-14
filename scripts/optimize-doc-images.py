import argparse
import os
import re
from pathlib import Path

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit(
        "Pillow is required to optimize documentation images. "
        "Install it with `python -m pip install Pillow`."
    ) from error


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
REFERENCE_EXTENSIONS = {".md", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".json"}
SKIP_DIRS = {
    ".git",
    ".next",
    ".nuxt",
    ".react-router",
    ".svelte-kit",
    ".vinext",
    "dist",
    "node_modules",
}


def should_skip(path: Path, repo_root: Path) -> bool:
    try:
        relative_parts = path.relative_to(repo_root).parts
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in relative_parts)


def convert_images(repo_root: Path, image_dir: Path, delete_originals: bool) -> dict[str, str]:
    converted: dict[str, str] = {}
    stats: list[tuple[int, int]] = []

    print("Converting documentation screenshots to WebP...")
    print("-" * 60)

    if not image_dir.exists():
        print(f"Image directory not found: {image_dir}")
        return converted

    for image_path in sorted(image_dir.iterdir()):
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        webp_path = image_path.with_suffix(".webp")
        original_size = image_path.stat().st_size

        image = Image.open(image_path)
        image.save(webp_path, "WEBP", quality=85, method=6)

        new_size = webp_path.stat().st_size
        saved_pct = (
            ((original_size - new_size) / original_size * 100)
            if original_size
            else 0
        )
        rel_path = image_path.relative_to(repo_root)
        print(
            f"{str(rel_path):<45} | "
            f"{original_size / 1024:>7.1f} KB -> "
            f"{new_size / 1024:>6.1f} KB | "
            f"Saved {saved_pct:>5.1f}%"
        )

        converted[image_path.name] = webp_path.name
        stats.append((original_size, new_size))

        if delete_originals:
            image_path.unlink()

    if stats:
        total_original = sum(item[0] for item in stats)
        total_new = sum(item[1] for item in stats)
        total_saved_pct = (total_original - total_new) / total_original * 100
        print("-" * 60)
        print(
            f"Docs images size: {total_original / 1024 / 1024:.2f} MB -> "
            f"{total_new / 1024 / 1024:.2f} MB | "
            f"Saved {total_saved_pct:.1f}%"
        )
    else:
        print("No PNG/JPEG screenshots found to convert.")

    return converted


def update_references(repo_root: Path, converted: dict[str, str]) -> None:
    if not converted:
        return

    print("\nUpdating references...")
    print("-" * 60)

    updated_count = 0
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in REFERENCE_EXTENSIONS:
            continue
        if should_skip(path, repo_root):
            continue

        content = path.read_text(encoding="utf-8")
        next_content = content
        for old_name, new_name in converted.items():
            next_content = re.sub(re.escape(old_name), new_name, next_content)

        if next_content == content:
            continue

        path.write_text(next_content, encoding="utf-8")
        print(f"Updated references in: {path.relative_to(repo_root)}")
        updated_count += 1

    print(f"Updated {updated_count} file(s).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert this repo's documentation screenshots to WebP.",
    )
    parser.add_argument(
        "--image-dir",
        default="assets",
        help="Directory containing documentation screenshots, relative to repo root.",
    )
    parser.add_argument(
        "--delete-originals",
        action="store_true",
        help="Delete source PNG/JPEG files after WebP conversion.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    image_dir = (repo_root / args.image_dir).resolve()

    os.chdir(repo_root)
    converted = convert_images(repo_root, image_dir, args.delete_originals)
    update_references(repo_root, converted)


if __name__ == "__main__":
    main()
