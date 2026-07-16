import os
import sys
import shutil
import argparse
import hashlib
from typing import List, Dict, Set

def compute_md5(filepath: str) -> str:
    """Computes MD5 checksum of a file to check for duplicates."""
    hash_md5 = hashlib.md5()
    try:
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
    except Exception as e:
        print(f"Error computing MD5 for {filepath}: {e}")
        return ""
    return hash_md5.hexdigest()

def ensure_dataset_structure(dataset_path: str):
    """Ensures YOLO dataset directory structure exists."""
    for split in ("train", "val"):
        os.makedirs(os.path.join(dataset_path, "images", split), exist_ok=True)
        os.makedirs(os.path.join(dataset_path, "labels", split), exist_ok=True)

def cmd_validate(args):
    """Validates YOLO dataset structure and label files."""
    dataset_path = args.dataset
    if not os.path.exists(dataset_path):
        print(f"Dataset path '{dataset_path}' does not exist.")
        sys.exit(1)

    print(f"Validating dataset structure at '{os.path.abspath(dataset_path)}'...")
    issues = 0
    total_images = 0
    total_labels = 0

    for split in ("train", "val"):
        img_dir = os.path.join(dataset_path, "images", split)
        lbl_dir = os.path.join(dataset_path, "labels", split)

        if not os.path.exists(img_dir) or not os.path.exists(lbl_dir):
            print(f"[ERROR] Missing standard directories for split: {split}")
            issues += 1
            continue

        images = [f for f in os.listdir(img_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))]
        total_images += len(images)

        for img in images:
            base_name = os.path.splitext(img)[0]
            # Check matching label file (txt)
            lbl_file = os.path.join(lbl_dir, f"{base_name}.txt")
            if not os.path.exists(lbl_file):
                print(f"[WARNING] Image '{img}' in split '{split}' is missing a corresponding label file '{base_name}.txt'. Creating empty label.")
                try:
                    with open(lbl_file, "w") as f:
                        pass
                except Exception as e:
                    print(f"[ERROR] Failed to create empty label file: {e}")
                    issues += 1
            else:
                total_labels += 1
                # Validate label formats
                try:
                    with open(lbl_file, "r") as f:
                        lines = f.readlines()
                    for idx, line in enumerate(lines):
                        parts = line.strip().split()
                        if not parts:
                            continue
                        if len(parts) != 5:
                            print(f"[ERROR] Invalid format in label '{lbl_file}' line {idx+1}: Expected 'class x_center y_center width height'")
                            issues += 1
                            continue
                        cls_id = parts[0]
                        if cls_id not in ("0", "1"):
                            print(f"[ERROR] Invalid class ID '{cls_id}' in label '{lbl_file}' line {idx+1}: Expected '0' (fire) or '1' (smoke)")
                            issues += 1
                except Exception as e:
                    print(f"[ERROR] Could not read label file '{lbl_file}': {e}")
                    issues += 1

    print(f"Validation complete. Found {issues} issues across {total_images} images and {total_labels} label files.")

def cmd_import(args):
    """Imports a difficult image (and label) into the training dataset."""
    dataset_path = args.dataset
    ensure_dataset_structure(dataset_path)

    img_path = args.image
    lbl_path = args.label
    split = args.split

    if not os.path.exists(img_path):
        print(f"Image path '{img_path}' does not exist.")
        sys.exit(1)

    # 1. Compute MD5 to prevent duplicates
    img_md5 = compute_md5(img_path)
    if img_md5:
        # Check against existing images
        for s in ("train", "val"):
            img_dir = os.path.join(dataset_path, "images", s)
            for f in os.listdir(img_dir):
                if compute_md5(os.path.join(img_dir, f)) == img_md5:
                    print(f"[ABORT] Duplicate image detected: '{f}' in '{s}' has the same MD5 hash.")
                    sys.exit(1)

    # 2. Copy image
    img_name = os.path.basename(img_path)
    dest_img_path = os.path.join(dataset_path, "images", split, img_name)
    shutil.copy2(img_path, dest_img_path)
    print(f"Imported image to {dest_img_path}")

    # 3. Handle label
    base_name = os.path.splitext(img_name)[0]
    dest_lbl_path = os.path.join(dataset_path, "labels", split, f"{base_name}.txt")

    if lbl_path and os.path.exists(lbl_path):
        shutil.copy2(lbl_path, dest_lbl_path)
        print(f"Imported label to {dest_lbl_path}")
    else:
        # Create empty label file (background negative)
        with open(dest_lbl_path, "w") as f:
            pass
        print(f"Created empty label file (true background negative) at {dest_lbl_path}")

def cmd_remove_annotation(args):
    """Removes incorrect annotations of class_id from label file."""
    dataset_path = args.dataset
    img_name = args.image_name
    class_id = str(args.class_id)
    base_name = os.path.splitext(img_name)[0]

    found = False
    for split in ("train", "val"):
        lbl_file = os.path.join(dataset_path, "labels", split, f"{base_name}.txt")
        if os.path.exists(lbl_file):
            found = True
            try:
                with open(lbl_file, "r") as f:
                    lines = f.readlines()
                
                filtered = [line for line in lines if not line.strip().startswith(class_id)]
                
                removed_count = len(lines) - len(filtered)
                with open(lbl_file, "w") as f:
                    f.writelines(filtered)
                
                print(f"Updated label file '{lbl_file}': Removed {removed_count} annotations of class '{class_id}'.")
            except Exception as e:
                print(f"Error modifying label file '{lbl_file}': {e}")
                sys.exit(1)

    if not found:
        print(f"Label file for image '{img_name}' not found in train or val splits.")
        sys.exit(1)

def cmd_add_negatives(args):
    """Imports verified false positive cropped ROI images as true background negatives."""
    dataset_path = args.dataset
    ensure_dataset_structure(dataset_path)
    source_dir = args.source
    split = args.split

    if not os.path.exists(source_dir):
        print(f"Source directory '{source_dir}' does not exist.")
        sys.exit(1)

    files = [f for f in os.listdir(source_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    if not files:
        print(f"No images found in source folder '{source_dir}' to import.")
        return

    imported_count = 0
    duplicate_count = 0

    print(f"Scanning '{source_dir}' for negative samples...")
    for filename in files:
        src_path = os.path.join(source_dir, filename)
        img_md5 = compute_md5(src_path)
        
        # Check duplicate
        is_dup = False
        for s in ("train", "val"):
            img_dir = os.path.join(dataset_path, "images", s)
            if os.path.exists(img_dir):
                for f in os.listdir(img_dir):
                    if compute_md5(os.path.join(img_dir, f)) == img_md5:
                        is_dup = True
                        break
            if is_dup:
                break
        
        if is_dup:
            duplicate_count += 1
            continue

        # Copy to images/split
        dest_img_path = os.path.join(dataset_path, "images", split, filename)
        shutil.copy2(src_path, dest_img_path)

        # Create empty label file (background negative)
        base_name = os.path.splitext(filename)[0]
        dest_lbl_path = os.path.join(dataset_path, "labels", split, f"{base_name}.txt")
        with open(dest_lbl_path, "w") as f:
            pass

        imported_count += 1

    print(f"Completed importing negatives. Imported: {imported_count}. Skipped duplicates: {duplicate_count}.")

def cmd_stats(args):
    """Calculates dataset statistics (sizes, class counts, backgrounds, duplicates)."""
    dataset_path = args.dataset
    if not os.path.exists(dataset_path):
        print(f"Dataset path '{dataset_path}' does not exist.")
        sys.exit(1)

    print(f"Analyzing dataset statistics for '{os.path.abspath(dataset_path)}'...")
    
    total_images = 0
    bg_images = 0
    class_counts = {0: 0, 1: 0} # 0 = fire, 1 = smoke
    all_hashes: Dict[str, str] = {}
    duplicates = []

    for split in ("train", "val"):
        img_dir = os.path.join(dataset_path, "images", split)
        lbl_dir = os.path.join(dataset_path, "labels", split)

        if not os.path.exists(img_dir):
            continue

        images = [f for f in os.listdir(img_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))]
        print(f"\nSplit: {split.upper()}")
        print(f"  Images: {len(images)}")

        split_bg = 0
        split_boxes = {0: 0, 1: 0}

        for img in images:
            img_path = os.path.join(img_dir, img)
            h = compute_md5(img_path)
            if h:
                if h in all_hashes:
                    duplicates.append((img_path, all_hashes[h]))
                else:
                    all_hashes[h] = img_path

            base_name = os.path.splitext(img)[0]
            lbl_file = os.path.join(lbl_dir, f"{base_name}.txt")

            if not os.path.exists(lbl_file):
                split_bg += 1
                bg_images += 1
                total_images += 1
                continue

            try:
                with open(lbl_file, "r") as f:
                    lines = f.readlines()
                
                boxes = 0
                for line in lines:
                    parts = line.strip().split()
                    if not parts:
                        continue
                    cls_id = int(parts[0])
                    if cls_id in (0, 1):
                        split_boxes[cls_id] += 1
                        class_counts[cls_id] += 1
                    boxes += 1
                
                if boxes == 0:
                    split_bg += 1
                    bg_images += 1
            except Exception:
                split_bg += 1
                bg_images += 1

            total_images += 1

        print(f"  Background images (no labels): {split_bg} ({split_bg/len(images):.1%})")
        print(f"  Annotation boxes: Fire={split_boxes[0]} Smoke={split_boxes[1]}")

    print("\n" + "="*40)
    print("GLOBAL DATASET SUMMARY")
    print(f"  Total Images       : {total_images}")
    print(f"  Background Images  : {bg_images} ({bg_images/total_images:.1% if total_images > 0 else 0:.1%})")
    print(f"  Fire boxes (0)     : {class_counts[0]}")
    print(f"  Smoke boxes (1)    : {class_counts[1]}")
    print(f"  Duplicates detected: {len(duplicates)}")
    if duplicates:
        print("\nDuplicates details (first 5):")
        for dup, orig in duplicates[:5]:
            print(f"  - Duplicate: {dup}\n    Original:  {orig}")


def main():
    parser = argparse.ArgumentParser(description="SentinelOS - Training Dataset Curation Utility")
    parser.add_argument("-d", "--dataset", default="dataset", help="Path to YOLO dataset directory (default: 'dataset')")
    subparsers = parser.add_subparsers(dest="command", required=True, help="Subcommands")

    # validate parser
    subparsers.add_parser("validate", help="Validate dataset structure and formatting")

    # import parser
    import_parser = subparsers.add_parser("import-difficult", help="Import a difficult image (and optional label) into splits")
    import_parser.add_argument("image", help="Path to input image file")
    import_parser.add_argument("-l", "--label", default=None, help="Path to input label file in YOLO txt format")
    import_parser.add_argument("-s", "--split", choices=("train", "val"), default="train", help="Destination split (default: 'train')")

    # remove-annotation parser
    remove_parser = subparsers.add_parser("remove-annotation", help="Remove incorrect annotations from images")
    remove_parser.add_argument("image_name", help="Name of the image file (e.g. frame_001.jpg)")
    remove_parser.add_argument("class_id", type=int, choices=(0, 1), help="Class ID to remove (0 = fire, 1 = smoke)")

    # add-negatives parser
    negatives_parser = subparsers.add_parser("add-negatives", help="Mine verified negatives (false positives) from rejected ROIs folder")
    negatives_parser.add_argument("source", help="Path to rejected ROIs folder (e.g., 'evidence/rejected_rois')")
    negatives_parser.add_argument("-s", "--split", choices=("train", "val"), default="train", help="Destination split (default: 'train')")

    # stats parser
    subparsers.add_parser("stats", help="Show global dataset statistics, balance, and duplicate hashes")

    args = parser.parse_args()

    if args.command == "validate":
        cmd_validate(args)
    elif args.command == "import-difficult":
        cmd_import(args)
    elif args.command == "remove-annotation":
        cmd_remove_annotation(args)
    elif args.command == "add-negatives":
        cmd_add_negatives(args)
    elif args.command == "stats":
        cmd_stats(args)

if __name__ == "__main__":
    main()
