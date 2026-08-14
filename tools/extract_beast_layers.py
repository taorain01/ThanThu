import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def extract_layers():
    beast_dir = r"c:\Bot Discord\anh\sieu_thu"
    
    # 1. FIRE DRAGON
    fd_path = os.path.join(beast_dir, "fire_dragon.png")
    if os.path.exists(fd_path):
        fd = Image.open(fd_path).convert("RGBA")
        w, h = fd.size

        # Cánh trái (x: 100..330, y: 320..580)
        mask_wl = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_wl)
        draw.polygon([(110, 440), (200, 340), (320, 360), (330, 480), (280, 560), (140, 560)], fill=255)
        mask_wl = mask_wl.filter(ImageFilter.GaussianBlur(2))
        
        wing_l = Image.new("RGBA", (w, h), (0,0,0,0))
        wing_l.paste(fd, (0, 0), mask_wl)
        wing_l.save(os.path.join(beast_dir, "fire_dragon_wing_l.png"))

        # Cánh phải (x: 540..760, y: 330..600)
        mask_wr = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_wr)
        draw.polygon([(540, 390), (620, 340), (740, 420), (750, 560), (660, 600), (550, 520)], fill=255)
        mask_wr = mask_wr.filter(ImageFilter.GaussianBlur(2))
        
        wing_r = Image.new("RGBA", (w, h), (0,0,0,0))
        wing_r.paste(fd, (0, 0), mask_wr)
        wing_r.save(os.path.join(beast_dir, "fire_dragon_wing_r.png"))

        # Ngọn lửa ở đuôi (x: 620..770, y: 500..690)
        mask_flame = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_flame)
        draw.polygon([(630, 610), (680, 510), (760, 530), (770, 670), (680, 690)], fill=255)
        mask_flame = mask_flame.filter(ImageFilter.GaussianBlur(2))
        
        flame = Image.new("RGBA", (w, h), (0,0,0,0))
        flame.paste(fd, (0, 0), mask_flame)
        flame.save(os.path.join(beast_dir, "fire_dragon_flame.png"))

        # Thân chính (Body) - Xóa bớt cánh và ngọn lửa ở thân để khi ghép lại đè lên nhau không bị trùng
        body = fd.copy()
        body_mask = Image.new("L", (w, h), 255)
        draw_b = ImageDraw.Draw(body_mask)
        # Giảm opacity vùng cánh nền sau
        draw_b.polygon([(110, 440), (200, 340), (290, 360), (290, 480), (140, 560)], fill=0)
        draw_b.polygon([(580, 390), (620, 340), (740, 420), (750, 560), (660, 600)], fill=0)
        draw_b.polygon([(660, 510), (760, 530), (770, 670), (680, 690)], fill=0)
        body_mask = body_mask.filter(ImageFilter.GaussianBlur(3))
        
        res_body = Image.new("RGBA", (w, h), (0,0,0,0))
        res_body.paste(fd, (0,0), body_mask)
        res_body.save(os.path.join(beast_dir, "fire_dragon_body.png"))

    # 2. SHADOW DRAGON
    sd_path = os.path.join(beast_dir, "shadow_dragon.png")
    if os.path.exists(sd_path):
        sd = Image.open(sd_path).convert("RGBA")
        w, h = sd.size

        # Cánh trái
        mask_wl = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_wl)
        draw.polygon([(100, 350), (240, 320), (290, 450), (250, 540), (110, 530)], fill=255)
        mask_wl = mask_wl.filter(ImageFilter.GaussianBlur(2))
        wing_l = Image.new("RGBA", (w, h), (0,0,0,0))
        wing_l.paste(sd, (0, 0), mask_wl)
        wing_l.save(os.path.join(beast_dir, "shadow_dragon_wing_l.png"))

        # Cánh phải
        mask_wr = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_wr)
        draw.polygon([(520, 380), (720, 340), (780, 500), (690, 580), (540, 540)], fill=255)
        mask_wr = mask_wr.filter(ImageFilter.GaussianBlur(2))
        wing_r = Image.new("RGBA", (w, h), (0,0,0,0))
        wing_r.paste(sd, (0, 0), mask_wr)
        wing_r.save(os.path.join(beast_dir, "shadow_dragon_wing_r.png"))

    # 3. THUNDER FOX
    tf_path = os.path.join(beast_dir, "thunder_fox.png")
    if os.path.exists(tf_path):
        tf = Image.open(tf_path).convert("RGBA")
        w, h = tf.size

        # Đuôi sét (x: 80..380, y: 120..630)
        mask_tail = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask_tail)
        draw.polygon([(80, 400), (140, 130), (330, 260), (360, 480), (280, 620), (130, 600)], fill=255)
        mask_tail = mask_tail.filter(ImageFilter.GaussianBlur(2))
        tail = Image.new("RGBA", (w, h), (0,0,0,0))
        tail.paste(tf, (0, 0), mask_tail)
        tail.save(os.path.join(beast_dir, "thunder_fox_tail.png"))

    print("Extracted beast parts successfully!")

if __name__ == "__main__":
    extract_layers()
