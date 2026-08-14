import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def extract_fire_dragon_modular_parts():
    base_dir = r"c:\Bot Discord\anh\sieu_thu"
    parts_dir = os.path.join(base_dir, "modular_parts")
    os.makedirs(parts_dir, exist_ok=True)

    # Lấy frame 1 chất lượng cao của Fire Dragon
    f1_path = os.path.join(base_dir, "fire_dragon_f1.png")
    if not os.path.exists(f1_path):
        print("fire_dragon_f1.png not found")
        return

    img = Image.open(f1_path).convert("RGBA")
    w, h = img.size

    # Định nghĩa các vùng bóc tách bộ phận dựa trên tỷ lệ tọa độ chuẩn
    # 1. ĐẦU (HEAD + HORNS + EYES)
    mask_head = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_head)
    # Khoanh vùng đầu và sừng (y từ 0 đến 55% chiều cao)
    d.ellipse([(int(w*0.25), int(h*0.08)), (int(w*0.75), int(h*0.56))], fill=255)
    # Sừng trái & phải
    d.polygon([(int(w*0.3), int(h*0.3)), (int(w*0.18), int(h*0.12)), (int(w*0.45), int(h*0.25))], fill=255)
    d.polygon([(int(w*0.7), int(h*0.3)), (int(w*0.82), int(h*0.12)), (int(w*0.55), int(h*0.25))], fill=255)
    mask_head = mask_head.filter(ImageFilter.GaussianBlur(1.5))
    
    head_img = Image.new("RGBA", (w, h), (0,0,0,0))
    head_img.paste(img, (0, 0), mask_head)
    bbox = head_img.getbbox()
    if bbox:
        head_cropped = head_img.crop(bbox)
        head_cropped.save(os.path.join(parts_dir, "fire_dragon_head.png"))
        print(f"Saved head: {head_cropped.size}")

    # 2. CÁNH TRÁI (LEFT WING)
    mask_wl = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_wl)
    d.polygon([(int(w*0.05), int(h*0.42)), (int(w*0.32), int(h*0.32)), (int(w*0.34), int(h*0.58)), (int(w*0.1), int(h*0.62))], fill=255)
    mask_wl = mask_wl.filter(ImageFilter.GaussianBlur(1.5))
    wl_img = Image.new("RGBA", (w, h), (0,0,0,0))
    wl_img.paste(img, (0, 0), mask_wl)
    bbox = wl_img.getbbox()
    if bbox:
        wl_cropped = wl_img.crop(bbox)
        wl_cropped.save(os.path.join(parts_dir, "fire_dragon_wing_l.png"))
        print(f"Saved wing_l: {wl_cropped.size}")

    # 3. CÁNH PHẢI (RIGHT WING)
    mask_wr = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_wr)
    d.polygon([(int(w*0.66), int(h*0.32)), (int(w*0.95), int(h*0.42)), (int(w*0.9), int(h*0.62)), (int(w*0.66), int(h*0.58))], fill=255)
    mask_wr = mask_wr.filter(ImageFilter.GaussianBlur(1.5))
    wr_img = Image.new("RGBA", (w, h), (0,0,0,0))
    wr_img.paste(img, (0, 0), mask_wr)
    bbox = wr_img.getbbox()
    if bbox:
        wr_cropped = wr_img.crop(bbox)
        wr_cropped.save(os.path.join(parts_dir, "fire_dragon_wing_r.png"))
        print(f"Saved wing_r: {wr_cropped.size}")

    # 4. TAY TRÁI (LEFT ARM)
    mask_al = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_al)
    d.ellipse([(int(w*0.32), int(h*0.48)), (int(w*0.46), int(h*0.68))], fill=255)
    mask_al = mask_al.filter(ImageFilter.GaussianBlur(1.5))
    al_img = Image.new("RGBA", (w, h), (0,0,0,0))
    al_img.paste(img, (0, 0), mask_al)
    bbox = al_img.getbbox()
    if bbox:
        al_cropped = al_img.crop(bbox)
        al_cropped.save(os.path.join(parts_dir, "fire_dragon_arm_l.png"))
        print(f"Saved arm_l: {al_cropped.size}")

    # 5. TAY PHẢI (RIGHT ARM)
    mask_ar = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_ar)
    d.ellipse([(int(w*0.54), int(h*0.48)), (int(w*0.68), int(h*0.68))], fill=255)
    mask_ar = mask_ar.filter(ImageFilter.GaussianBlur(1.5))
    ar_img = Image.new("RGBA", (w, h), (0,0,0,0))
    ar_img.paste(img, (0, 0), mask_ar)
    bbox = ar_img.getbbox()
    if bbox:
        ar_cropped = ar_img.crop(bbox)
        ar_cropped.save(os.path.join(parts_dir, "fire_dragon_arm_r.png"))
        print(f"Saved arm_r: {ar_cropped.size}")

    # 6. ĐUÔI VÀ LỬA ĐUÔI (TAIL & FLAME)
    mask_tail = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_tail)
    d.polygon([(int(w*0.08), int(h*0.56)), (int(w*0.32), int(h*0.68)), (int(w*0.35), int(h*0.88)), (int(w*0.04), int(h*0.75))], fill=255)
    mask_tail = mask_tail.filter(ImageFilter.GaussianBlur(1.5))
    tail_img = Image.new("RGBA", (w, h), (0,0,0,0))
    tail_img.paste(img, (0, 0), mask_tail)
    bbox = tail_img.getbbox()
    if bbox:
        tail_cropped = tail_img.crop(bbox)
        tail_cropped.save(os.path.join(parts_dir, "fire_dragon_tail.png"))
        print(f"Saved tail: {tail_cropped.size}")

    # 7. THÂN MÌNH VÀ BỤNG (TORSO / BODY)
    mask_body = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask_body)
    d.ellipse([(int(w*0.32), int(h*0.46)), (int(w*0.68), int(h*0.92))], fill=255)
    mask_body = mask_body.filter(ImageFilter.GaussianBlur(1.5))
    body_img = Image.new("RGBA", (w, h), (0,0,0,0))
    body_img.paste(img, (0, 0), mask_body)
    bbox = body_img.getbbox()
    if bbox:
        body_cropped = body_img.crop(bbox)
        body_cropped.save(os.path.join(parts_dir, "fire_dragon_body.png"))
        print(f"Saved body: {body_cropped.size}")

    print("Successfully generated modular parts!")

if __name__ == "__main__":
    extract_fire_dragon_modular_parts()
