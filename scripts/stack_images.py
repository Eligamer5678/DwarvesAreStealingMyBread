#!/usr/bin/env python3
"""
stack_images.py

just in case you made the same mistake as me and accidently have each animation as a seprate file
Usage examples:
  Overlay specific files into one composite:
    python3 scripts/stack_images.py --mode overlay -o out.png img1.png img2.png

  Concatenate all PNGs in a directory vertically:
    python3 scripts/stack_images.py --dir Assets/Sprites --mode concat --direction vertical -o spritesheet.png

  Batch overlay: group files by prefix before last '_' and produce per-group outputs:
    python3 scripts/stack_images.py --dir Assets/Sprites --mode overlay --batch --group-sep _ --out-dir out/

Requires: Pillow
  pip install pillow

"""
import argparse
import os
from PIL import Image
from collections import defaultdict


def collect_files_from_dir(d, exts=None, recursive=False):
    exts = exts or ('.png', '.jpg', '.jpeg')
    files = []
    if recursive:
        for root, dirs, filenames in os.walk(d):
            for f in filenames:
                if f.lower().endswith(exts):
                    files.append(os.path.join(root, f))
    else:
        for f in os.listdir(d):
            if f.lower().endswith(exts):
                files.append(os.path.join(d, f))
    return sorted(files)


def group_by_prefix_last_sep(files, sep='_'):
    groups = defaultdict(list)
    for p in files:
        name = os.path.splitext(os.path.basename(p))[0]
        if sep and sep in name:
            key = name.rsplit(sep, 1)[0]
        else:
            key = name
        groups[key].append(p)
    # sort members
    for k in list(groups.keys()):
        groups[k] = sorted(groups[k])
    return groups


def overlay_images(paths, bgcolor=None, align='center'):
    imgs = [Image.open(p).convert('RGBA') for p in paths]
    widths = [im.width for im in imgs]
    heights = [im.height for im in imgs]
    w = max(widths)
    h = max(heights)

    if bgcolor is None:
        base = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    else:
        base = Image.new('RGBA', (w, h), bgcolor)

    for im in imgs:
        if align == 'center':
            x = (w - im.width) // 2
            y = (h - im.height) // 2
        else:
            x = 0
            y = 0
        base.alpha_composite(im, (x, y))
    return base


def concat_images(paths, direction='vertical', bgcolor=None, align='topleft'):
    imgs = [Image.open(p).convert('RGBA') for p in paths]
    if direction == 'vertical':
        w = max(im.width for im in imgs)
        h = sum(im.height for im in imgs)
        out = Image.new('RGBA', (w, h), bgcolor or (0, 0, 0, 0))
        y = 0
        for im in imgs:
            if align == 'center':
                x = (w - im.width) // 2
            else:
                x = 0
            out.alpha_composite(im, (x, y))
            y += im.height
    else:
        h = max(im.height for im in imgs)
        w = sum(im.width for im in imgs)
        out = Image.new('RGBA', (w, h), bgcolor or (0, 0, 0, 0))
        x = 0
        for im in imgs:
            if align == 'center':
                y = (h - im.height) // 2
            else:
                y = 0
            out.alpha_composite(im, (x, y))
            x += im.width
    return out


def ensure_out_dir(path):
    d = os.path.dirname(path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)


def main():
    p = argparse.ArgumentParser(description='Overlay or concatenate images.')
    p.add_argument('--dir', '-d', help='Directory to collect images from')
    p.add_argument('--out', '-o', help='Output filename (single mode)')
    p.add_argument('--out-dir', help='Output directory for batch mode', default='out')
    p.add_argument('--mode', choices=['overlay', 'concat'], default='overlay', help='Operation mode')
    p.add_argument('--direction', choices=['vertical', 'horizontal'], default='vertical', help='Concat direction')
    p.add_argument('--align', choices=['center', 'topleft', 'left'], default='topleft', help='Alignment when sizes differ (default left/top)')
    p.add_argument('--bgcolor', help='Background color like "#RRGGBB" or "#RRGGBBAA" (default transparent)')
    p.add_argument('--batch', action='store_true', help='Group files by prefix and process each group')
    p.add_argument('--group-sep', default='_', help='Separator used to split group prefix (default "_")')
    p.add_argument('--recursive', action='store_true', help='Recursively search directory')
    p.add_argument('files', nargs='*', help='Image files (if not using --dir)')
    args = p.parse_args()

    file_list = []
    if args.dir:
        file_list = collect_files_from_dir(args.dir, recursive=args.recursive)
    else:
        file_list = args.files

    if not file_list:
        print('No images found. Provide files or use --dir')
        return

    bgcolor = None
    if args.bgcolor:
        c = args.bgcolor.lstrip('#')
        if len(c) == 6:
            bgcolor = tuple(int(c[i:i+2], 16) for i in (0, 2, 4)) + (255,)
        elif len(c) == 8:
            bgcolor = tuple(int(c[i:i+2], 16) for i in (0, 2, 4, 6))

    if args.batch:
        groups = group_by_prefix_last_sep(file_list, sep=args.group_sep)
        os.makedirs(args.out_dir, exist_ok=True)
        for key, paths in groups.items():
            if not paths:
                continue
            outname = os.path.join(args.out_dir, f"{key}_stack.png")
            print('Processing group', key, '->', outname)
            if args.mode == 'overlay':
                img = overlay_images(paths, bgcolor=bgcolor, align=args.align)
            else:
                img = concat_images(paths, direction=args.direction, bgcolor=bgcolor, align=args.align)
            img.save(outname)
    else:
        # single output: stack all provided files in file_list
        out = args.out or 'stack.png'
        ensure_out_dir(out)
        if args.mode == 'overlay':
            img = overlay_images(file_list, bgcolor=bgcolor, align=args.align)
        else:
            img = concat_images(file_list, direction=args.direction, bgcolor=bgcolor, align=args.align)
        img.save(out)
        print('Wrote', out)


if __name__ == '__main__':
    main()
