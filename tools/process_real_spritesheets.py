import os
import numpy as np
from PIL import Image
from collections import deque

def remove_bg_floodfill(img, tolerance=25):
    arr = np.array(img.convert("RGBA"))
    h, w, _ = arr.shape
    visited = np.zeros((h, w), dtype=bool)
    is_bg = np.zeros((h, w), dtype=bool)
    queue = deque()

    for x in range(w):
        queue.append((0, x))
        queue.append((h - 1, x))
    for y in range(h):
        queue.append((y, 0))
        queue.append((y, w - 1))

    while queue:
        cy, cx = queue.popleft()
        if visited[cy, cx]:
            continue
        visited[cy, cx] = True

        r, g, b, _ = arr[cy, cx]
        if r > 225 and g > 225 and b > 225 and max(abs(int(r)-int(g)), abs(int(r)-int(b)), abs(int(g)-int(b))) < 35:
            is_bg[cy, cx] = True
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                    queue.append((ny, nx))

    arr[is_bg, 3] = 0
    return Image.fromarray(arr, "RGBA")

def slice_horizontal_frames(sheet_img, num_frames=4):
    w, h = sheet_img.size
    frame_w = w // num_frames
    frames = []
    for i in range(num_frames):
        box = (i * frame_w, 0, (i + 1) * frame_w, h)
        f_crop = sheet_img.crop(box)
        bbox = f_crop.getbbox()
        if bbox:
            cropped = f_crop.crop(bbox)
            cw, ch = cropped.size
            side = max(cw, ch) + 20
            padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            padded.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
            frames.append(padded)
        else:
            frames.append(f_crop)
    return frames

def main():
    ai_dir = r"C:\Users\songt\.gemini\antigravity-ide\brain\e1e90153-66c6-491c-9b1d-09519639b45e"
    out_dir = r"c:\Bot Discord\anh\sieu_thu"
    os.makedirs(out_dir, exist_ok=True)

    sheets = {
        "fire_dragon": "fire_dragon_spritesheet_1786695580222.jpg",
        "thunder_fox": "thunder_fox_spritesheet_1786695701340.jpg",
        "water_turtle": "water_turtle_spritesheet_1786695741280.jpg",
        "plant_golem": "plant_golem_spritesheet_1786695754111.jpg",
        "shadow_dragon": "shadow_dragon_spritesheet_1786696074096.jpg"
    }

    for key, filename in sheets.items():
        src_path = os.path.join(ai_dir, filename)
        if not os.path.exists(src_path):
            print(f"File not found: {src_path}")
            continue

        raw_img = Image.open(src_path)
        # 1. Tách nền trong suốt
        clean_sheet = remove_bg_floodfill(raw_img)
        sheet_out = os.path.join(out_dir, f"{key}_spritesheet.png")
        clean_sheet.save(sheet_out)
        print(f"Saved transparent sheet: {sheet_out}")

        # 2. Cắt 4 frames riêng lẻ
        frames = slice_horizontal_frames(clean_sheet, 4)
        for idx, f in enumerate(frames):
            f_path = os.path.join(out_dir, f"{key}_f{idx+1}.png")
            f.save(f_path)
            print(f"  -> Saved Frame: {f_path}")

if __name__ == "__main__":
    main()
