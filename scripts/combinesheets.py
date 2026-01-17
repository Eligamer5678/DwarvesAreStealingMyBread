#!/usr/bin/env python3
"""
Simple Tilesheet Composer
- Uses pygame for the editing canvas and tkinter for file dialogs/simple inputs.

Features:
- Open a base tilesheet (treated as the editable canvas)
- Add one or more source tilesheets (sliced into tiles of `tile_size`)
- Click a tile from the palette to select it
- Click a cell on the base to place the selected tile
- Save the edited base to a new PNG

Usage: python3 scripts/combinesheets.py
Controls (when pygame window has focus):
- O : Open base tilesheet (file dialog)
- A : Add source tilesheet(s)
- S : Save current combined image
- Z : Toggle grid visibility
- Mouse left-click: select tile (in palette) or place tile (on base)
- Mouse wheel: scroll palette
- Number keys 1..9: switch source sheet quickly (if multiple)
- Q or ESC: quit

Dependencies: pygame, tkinter (builtin). Install pygame if missing:
  pip3 install pygame

"""

import os
import sys
import math
import tkinter as tk
from tkinter import filedialog, simpledialog, messagebox
import pygame



# Defaults
TILE_SIZE = 16
PALETTE_COLS = 8
PALETTE_THUMB = 32  # size for palette thumbnails
PALETTE_BG = (30, 30, 30)
GRID_COLOR = (80, 80, 80)


def ask_open_files(title='Open image'):
    root = tk.Tk(); root.withdraw()
    paths = filedialog.askopenfilenames(title=title, filetypes=[('PNG images','*.png'),('All images','*.*')])
    root.destroy()
    return list(paths)


def ask_open_file(title='Open image'):
    root = tk.Tk(); root.withdraw()
    path = filedialog.askopenfilename(title=title, filetypes=[('PNG images','*.png'),('All images','*.*')])
    root.destroy()
    return path


def ask_save_file(title='Save image as'):
    root = tk.Tk(); root.withdraw()
    path = filedialog.asksaveasfilename(title=title, defaultextension='.png', filetypes=[('PNG images','*.png')])
    root.destroy()
    return path


def ask_integer(prompt, title='Input', initial=16):
    root = tk.Tk(); root.withdraw()
    val = simpledialog.askinteger(title, prompt, initialvalue=initial)
    root.destroy()
    return val


class TileSheet:
    def __init__(self, path, tile_size=16):
        self.path = path
        self.tile_size = tile_size
        self.surface = pygame.image.load(path).convert_alpha()
        self.width, self.height = self.surface.get_size()
        self.cols = max(1, self.width // tile_size)
        self.rows = max(1, self.height // tile_size)
        self.tiles = []
        self._slice_tiles()

    def _slice_tiles(self):
        self.tiles = []
        for y in range(self.rows):
            for x in range(self.cols):
                rect = pygame.Rect(x * self.tile_size, y * self.tile_size, self.tile_size, self.tile_size)
                tile_surf = pygame.Surface((self.tile_size, self.tile_size), pygame.SRCALPHA)
                tile_surf.blit(self.surface, (0, 0), rect)
                self.tiles.append(tile_surf)


class Composer:
    def __init__(self):
        pygame.init()
        pygame.display.set_caption('Tilesheet Composer')
        self.tile_size = TILE_SIZE
        self.base_sheet = None  # TileSheet used as canvas
        self.canvas_surface = None  # pygame.Surface for editable canvas
        self.palette_sheets = []  # list of TileSheet
        self.palette_index = 0
        self.selected_tile = None  # pygame.Surface
        # selection / dragging on canvas
        self.canvas_selected_tile = None  # Surface being dragged from canvas
        self.canvas_selected_orig = None  # original (x,y) on canvas of selected tile
        self.canvas_dragging = False
        self.canvas_drag_mouse = (0, 0)
        self.grid_visible = True
        self.palette_scroll = 0
        self.running = True
        # default window (resizable later)
        self.win_w = 800; self.win_h = 600
        self.screen = pygame.display.set_mode((self.win_w, self.win_h), pygame.RESIZABLE)
        self.clock = pygame.time.Clock()
        self.info_font = pygame.font.SysFont('dejavusans', 14)

    def open_base(self, path=None):
        if not path:
            path = ask_open_file('Select base tilesheet')
            if not path: return
        try:
            ts = TileSheet(path, tile_size=self.tile_size)
        except Exception as e:
            messagebox.showerror('Error', f'Failed to open base image: {e}')
            return
        self.base_sheet = ts
        # create editable canvas copy
        self.canvas_surface = pygame.Surface((ts.width, ts.height), pygame.SRCALPHA)
        self.canvas_surface.blit(ts.surface, (0, 0))
        # resize window to fit canvas + palette
        self._resize_window_for_canvas()

    def add_palette_sheet(self, path=None):
        if not path:
            paths = ask_open_files('Add source tilesheet(s) for palette')
            if not paths: return
        else:
            paths = [path]
        for p in paths:
            try:
                ts = TileSheet(p, tile_size=self.tile_size)
                self.palette_sheets.append(ts)
            except Exception as e:
                messagebox.showerror('Error', f'Failed to open source image {p}: {e}')
        # ensure palette_index valid
        if len(self.palette_sheets) > 0:
            self.palette_index = min(self.palette_index, len(self.palette_sheets)-1)
        # adjust window if needed
        self._resize_window_for_canvas()

    def _resize_window_for_canvas(self):
        if not self.canvas_surface: return
        canvas_w, canvas_h = self.canvas_surface.get_size()
        palette_w = PALETTE_THUMB * PALETTE_COLS + 20
        desired_w = canvas_w + palette_w
        desired_h = max(canvas_h, 400)
        self.win_w, self.win_h = desired_w, desired_h
        try:
            self.screen = pygame.display.set_mode((self.win_w, self.win_h), pygame.RESIZABLE)
        except Exception:
            pass

    def select_tile_from_palette_coords(self, mx, my):
        # palette area is to the right of canvas
        if not self.canvas_surface: return False
        canvas_w, canvas_h = self.canvas_surface.get_size()
        px = mx - canvas_w - 10
        py = my - 10
        if px < 0 or py < 0: return False
        thumb = PALETTE_THUMB
        col = px // thumb
        row = (py // thumb) + self.palette_scroll
        idx = row * PALETTE_COLS + col
        # iterate over combined tiles from all palette sheets
        tiles = []
        for sheet in self.palette_sheets:
            tiles.extend(sheet.tiles)
        if 0 <= idx < len(tiles):
            self.selected_tile = tiles[idx]
            return True
        return False

    def get_canvas_cell_pos(self, mx, my):
        """Return top-left pixel coordinates of the tile cell under mouse, or None if outside canvas."""
        if not self.canvas_surface: return None
        if mx < 0 or my < 0: return None
        if mx >= self.canvas_surface.get_width() or my >= self.canvas_surface.get_height(): return None
        tx = mx // self.tile_size * self.tile_size
        ty = my // self.tile_size * self.tile_size
        return tx, ty

    def get_tile_surface_from_canvas(self, tx, ty):
        """Return a new Surface containing the tile at (tx,ty) from the canvas."""
        surf = pygame.Surface((self.tile_size, self.tile_size), pygame.SRCALPHA)
        surf.blit(self.canvas_surface, (0, 0), pygame.Rect(tx, ty, self.tile_size, self.tile_size))
        return surf

    def is_surface_nonempty(self, surf):
        """Return True if surface has any non-transparent pixels."""
        r = surf.get_bounding_rect()
        return r.width > 0 and r.height > 0

    def draw_palette(self):
        # draws thumbnails of all tiles from palette_sheets at right side
        if not self.palette_sheets: return
        canvas_w, canvas_h = (0,0)
        if self.canvas_surface: canvas_w, canvas_h = self.canvas_surface.get_size()
        x0 = canvas_w + 10
        y0 = 10
        # background
        palette_w = PALETTE_THUMB * PALETTE_COLS + 10
        pygame.draw.rect(self.screen, PALETTE_BG, (canvas_w, 0, palette_w, self.win_h))
        tiles = []
        for sheet in self.palette_sheets:
            tiles.extend(sheet.tiles)
        # draw thumbs
        thumb = PALETTE_THUMB
        for i, t in enumerate(tiles):
            col = i % PALETTE_COLS
            row = i // PALETTE_COLS - self.palette_scroll
            if row < 0: continue
            tx = x0 + col * thumb
            ty = y0 + row * thumb
            # scale tile to thumb
            thumb_s = pygame.transform.smoothscale(t, (thumb, thumb))
            self.screen.blit(thumb_s, (tx, ty))
            # highlight if selected
            if self.selected_tile is t:
                pygame.draw.rect(self.screen, (255,255,0), (tx, ty, thumb, thumb), 2)

    def place_tile_on_canvas(self, mx, my):
        if not self.canvas_surface or not self.selected_tile: return
        tx = mx // self.tile_size * self.tile_size
        ty = my // self.tile_size * self.tile_size
        if tx < 0 or ty < 0: return
        if tx >= self.canvas_surface.get_width() or ty >= self.canvas_surface.get_height(): return
        self.canvas_surface.blit(self.selected_tile, (tx, ty))

    def draw_grid(self):
        if not self.canvas_surface: return
        w,h = self.canvas_surface.get_size()
        for x in range(0, w, self.tile_size):
            pygame.draw.line(self.screen, GRID_COLOR, (x,0), (x,h))
        for y in range(0, h, self.tile_size):
            pygame.draw.line(self.screen, GRID_COLOR, (0,y), (w,y))

    def run(self):
        if not self.canvas_surface:
            # prompt to open base first
            print('Press O to open a base tilesheet, A to add palette sheets, S to save, Q to quit')
        while self.running:
            # clear the display at the start of each frame
            self.screen.fill((40,40,40))

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self.running = False
                elif event.type == pygame.VIDEORESIZE:
                    self.win_w, self.win_h = event.w, event.h
                    self.screen = pygame.display.set_mode((self.win_w, self.win_h), pygame.RESIZABLE)
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_o:
                        self.open_base()
                    elif event.key == pygame.K_a:
                        self.add_palette_sheet()
                    elif event.key == pygame.K_s:
                        self.save_canvas()
                    elif event.key == pygame.K_z:
                        self.grid_visible = not self.grid_visible
                    elif event.key in (pygame.K_ESCAPE, pygame.K_q):
                        self.running = False
                    elif pygame.K_1 <= event.key <= pygame.K_9:
                        idx = event.key - pygame.K_1
                        if idx < len(self.palette_sheets):
                            self.palette_index = idx
                            # set selected to first tile of that sheet
                            if self.palette_sheets:
                                self.selected_tile = self.palette_sheets[self.palette_index].tiles[0]
                    elif event.key == pygame.K_x:
                        # delete tile under mouse on canvas
                        mx, my = pygame.mouse.get_pos()
                        cell = self.get_canvas_cell_pos(mx, my)
                        if cell:
                            tx, ty = cell
                            self.canvas_surface.fill((0,0,0,0), pygame.Rect(tx, ty, self.tile_size, self.tile_size))
                elif event.type == pygame.MOUSEBUTTONDOWN:
                    mx,my = event.pos
                    # left click
                    if event.button == 1:
                        # if click inside palette region
                        if self.canvas_surface and mx > self.canvas_surface.get_width():
                            self.select_tile_from_palette_coords(mx, my)
                        else:
                            # clicking on canvas: try to select existing tile for dragging
                            cell = self.get_canvas_cell_pos(mx, my)
                            if cell:
                                tx, ty = cell
                                tile_surf = self.get_tile_surface_from_canvas(tx, ty)
                                if self.is_surface_nonempty(tile_surf):
                                    # start dragging this tile (remove from canvas while dragging)
                                    self.canvas_selected_tile = tile_surf
                                    self.canvas_selected_orig = (tx, ty)
                                    self.canvas_dragging = True
                                    self.canvas_drag_mouse = event.pos
                                    # clear original cell
                                    self.canvas_surface.fill((0,0,0,0), pygame.Rect(tx, ty, self.tile_size, self.tile_size))
                                else:
                                    # empty cell: place currently selected palette tile if any
                                    self.place_tile_on_canvas(mx, my)
                    elif event.button == 4:  # scroll up
                        self.palette_scroll = max(0, self.palette_scroll - 1)
                    elif event.button == 5:  # scroll down
                        self.palette_scroll = self.palette_scroll + 1
                elif event.type == pygame.MOUSEMOTION:
                    # track mouse while dragging
                    if self.canvas_dragging:
                        self.canvas_drag_mouse = event.pos
                elif event.type == pygame.MOUSEBUTTONUP:
                    if event.button == 1 and self.canvas_dragging:
                        # drop dragged tile
                        mx,my = event.pos
                        cell = self.get_canvas_cell_pos(mx, my)
                        if cell:
                            tx, ty = cell
                            self.canvas_surface.blit(self.canvas_selected_tile, (tx, ty))
                        else:
                            # outside canvas: restore to original position
                            ox, oy = self.canvas_selected_orig
                            if ox is not None:
                                self.canvas_surface.blit(self.canvas_selected_tile, (ox, oy))
                        # clear drag state
                        self.canvas_selected_tile = None
                        self.canvas_selected_orig = None
                        self.canvas_dragging = False

            # draw
            if self.canvas_surface:
                self.screen.blit(self.canvas_surface, (0,0))
                if self.grid_visible:
                    self.draw_grid()
            # draw dragged tile preview
            if self.canvas_dragging and self.canvas_selected_tile:
                mx, my = self.canvas_drag_mouse
                snap = self.get_canvas_cell_pos(mx, my)
                if snap:
                    sx, sy = snap
                else:
                    # if outside canvas, draw at raw mouse position snapped to tile grid
                    sx = mx // self.tile_size * self.tile_size
                    sy = my // self.tile_size * self.tile_size
                preview = self.canvas_selected_tile.copy()
                try:
                    preview.set_alpha(200)
                except Exception:
                    pass
                self.screen.blit(preview, (sx, sy))
            # draw palette
            self.draw_palette()
            # draw info
            info = f'Tile size: {self.tile_size}  Palette sheets: {len(self.palette_sheets)}  Selected: {"yes" if self.selected_tile else "no"}'
            txt = self.info_font.render(info, True, (255,255,255))
            self.screen.blit(txt, (10, self.win_h - 24))

            pygame.display.flip()
            self.clock.tick(60)
        pygame.quit()

    def save_canvas(self):
        if not self.canvas_surface:
            messagebox.showinfo('No canvas', 'Nothing to save: open a base tilesheet first')
            return
        out = ask_save_file('Save combined tilesheet as')
        if not out: return
        # convert surface to string buffer and save using pygame.image
        try:
            pygame.image.save(self.canvas_surface, out)
            messagebox.showinfo('Saved', f'Saved combined tilesheet to {out}')
        except Exception as e:
            messagebox.showerror('Error', f'Failed to save: {e}')


def main():
    c = Composer()
    c.run()

if __name__ == '__main__':
    main()
