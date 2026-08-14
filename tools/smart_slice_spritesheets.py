import os
import numpy as np
from PIL import Image
from collections import deque
from scipy.ndimage import label, find_objects

def remove_bg_floodfill(img):
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
        if r > 220 and g > 220 and b > 220 and max(abs(int(r)-int(g)), abs(int(r)-int(b)), abs(int(g)-int(b))) < 35:
            is_bg[cy, cx] = True
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                    queue.append((ny, nx))

    arr[is_bg, 3] = 0
    return Image.fromarray(arr, "RGBA")

def smart_extract_components(clean_img, expected_count=4, min_area=5000):
    arr = np.array(clean_img)
    alpha = arr[:, :, 3] > 0
    
    # Gắn nhãn các cụm pixel liên thông
    labeled_array, num_features = label(alpha)
    slices = find_objects(labeled_array)
    
    components = []
    for s in slices:
        sy, sx = s
        box_w = sx.stop - sx.start
        box_h = sy.stop - sy.start
        area = box_w * box_h
        if area >= min_area and box_w > 80 and box_h > 80:
            components.append({
                "slice": s,
                "x": sx.start,
                "y": sy.start,
                "w": box_w,
                "h": box_h,
                "area": area
            })

    # Sắp xếp các cụm:
    # Nếu bố cục 1 hàng ngang (đa số có y gần nhau): sort theo x
    # Nếu bố cục 2 hàng: gom nhóm hàng trên, hàng dưới
    if len(components) >= expected_count:
        # Lấy top 4 cụm diện tích lớn nhất
        components = sorted(components, key=lambda c: c["area"], reverse=True)[:expected_count]
        # Sort vị trí: hàng trên từ trái->phải, hàng dưới từ trái->phải
        components = sorted(components, key=lambda c: (c["y"] // 250, c["x"]))

    frames = []
    for c in components:
        sy, sx = c["slice"]
        cropped = clean_img.crop((sx.start, sy.start, sx.stop, sy.stop))
        
        # Thêm padding để thành hình vuông cân đối
        cw, ch = cropped.size
        side = max(cw, ch) + 30
        padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        padded.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
        frames.append(padded)

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
            continue

        raw_img = Image.open(src_path)
        clean_sheet = remove_bg_floodfill(raw_img)
        
        # Xuất sheet sạch
        clean_sheet.save(os.path.join(out_dir, f"{key}_spritesheet.png"))

        # Cắt thông minh theo bounding box chính xác từng nhân vật
        frames = smart_extract_components(clean_sheet, 4)
        print(f"[{key}] Found {len(frames)} smart frames.")
        
        for idx, f in enumerate(frames):
            f_path = os.path.join(out_dir, f"{key}_f{idx+1}.png")
            f.save(f_path)
            print(f"  -> Saved clean frame: {f_path} (Size: {f.size})")

if __name__ == "__main__":
    main()
