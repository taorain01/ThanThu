import os
import numpy as np
from PIL import Image
from collections import deque

def remove_background_floodfill(img_path, out_path, tolerance=25, feather=1.5):
    img = Image.open(img_path).convert("RGBA")
    arr = np.array(img)
    h, w, _ = arr.shape

    # Tìm các pixel nền trắng xuất phát từ các cạnh
    visited = np.zeros((h, w), dtype=bool)
    is_bg = np.zeros((h, w), dtype=bool)

    queue = deque()

    # Thêm toàn bộ pixel ở 4 cạnh
    for x in range(w):
        queue.append((0, x))
        queue.append((h - 1, x))
    for y in range(h):
        queue.append((y, 0))
        queue.append((y, w - 1))

    # Flood fill kiểm tra độ sáng & độ gần trắng
    while queue:
        cy, cx = queue.popleft()
        if visited[cy, cx]:
            continue
        visited[cy, cx] = True

        r, g, b, _ = arr[cy, cx]
        # Màu trắng / gần trắng (r, g, b đều cao và gần nhau)
        # Nền trắng AI thường có r,g,b > 235 và max diff < 30
        if r > 225 and g > 225 and b > 225 and max(abs(int(r)-int(g)), abs(int(r)-int(b)), abs(int(g)-int(b))) < 35:
            is_bg[cy, cx] = True
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                    queue.append((ny, nx))

    # Đặt Alpha = 0 cho vùng is_bg
    arr[is_bg, 3] = 0

    # Làm mềm biên tiếp giáp giữa nền và nhân vật
    from scipy.ndimage import distance_transform_edt
    try:
        # Nếu có scipy
        dist_inside = distance_transform_edt(~is_bg)
        # Gradient alpha cho 1.5px biên
        feather_mask = (dist_inside > 0) & (dist_inside < 2.5)
        for y in range(h):
            for x in range(w):
                if feather_mask[y, x]:
                    d = dist_inside[y, x]
                    alpha_factor = min(1.0, max(0.0, d / 2.5))
                    arr[y, x, 3] = int(arr[y, x, 3] * alpha_factor)
    except Exception:
        pass

    res = Image.fromarray(arr, "RGBA")
    
    # Crop sát viền nhân vật để animation chuẩn tâm
    bbox = res.getbbox()
    if bbox:
        # Tạo canvas vuông có padding cân đối
        cropped = res.crop(bbox)
        cw, ch = cropped.size
        side = max(cw, ch) + 20
        new_img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        new_img.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
        res = new_img

    res.save(out_path, "PNG")
    print(f"Done: {out_path} (Size: {res.size})")

if __name__ == "__main__":
    beast_dir = r"c:\Bot Discord\anh\sieu_thu"
    files = ["fire_dragon", "water_beast", "thunder_fox", "plant_golem", "shadow_dragon"]
    for f in files:
        in_p = os.path.join(beast_dir, f + ".jpg")
        out_p = os.path.join(beast_dir, f + ".png")
        if os.path.exists(in_p):
            remove_background_floodfill(in_p, out_p)
