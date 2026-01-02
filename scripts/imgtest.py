#!/usr/bin/env python3
#!/usr/bin/env python3
"""
imgtest.py

Load a PNG named `test.png` (or a file provided as first arg), resize to a square grid
(default 12x12) and print lines with inline color tags like `<#RRGGBB>` whenever the
pixel color changes while traversing top-left → bottom-right. Transparent pixels are
rendered as an invisible, same-width blank (space by default) and do not trigger tag
changes.

this is to make images for a specific game chat

Usage:
  python3 imgtest.py [path_to_image] [size]

Example:
  python3 imgtest.py test.png 12

Requires: Pillow (`pip install Pillow`)
"""

import sys
from PIL import Image


def rgb_to_hex(rgb):
	return '%02X%02X%02X' % rgb


def print_image(path='test.png', size=12, alpha_thresh=16, blank_char=' '):
	im = Image.open(path).convert('RGBA')
	# Resize to size x size using nearest neighbor so pixel art remains blocky
	im = im.resize((size, size), resample=Image.NEAREST)
	w, h = im.size

	# Traverse top-left to bottom-right in row-major order.
	prev_tag = None
	buffer = []
	total = w * h
	for idx in range(total):
		x = idx % w
		y = idx // w
		r, g, b, a = im.getpixel((x, y))
		if a > alpha_thresh:
			tag = '#' + rgb_to_hex((r, g, b))
			char = '█'
			# emit tag only when color changes
			if tag != prev_tag:
				buffer.append(f'<{tag}>')
				prev_tag = tag
		else:
			# transparent: invisible same-size char, do not change tag
			char = "░"

		buffer.append(char)

		# when we reach the end of a line, print and clear buffer
		if (idx + 1) % w == 0:
			print(''.join(buffer))
			buffer = []


def main(argv):
	path = 'test.png'
	size = 12
	if len(argv) >= 2:
		path = argv[1]
	if len(argv) >= 3:
		try:
			size = int(argv[2])
		except ValueError:
			pass

	try:
		print_image(path, size)
	except FileNotFoundError:
		print('File not found:', path)
	except Exception as e:
		print('Error:', e)


if __name__ == '__main__':
	main(sys.argv)

