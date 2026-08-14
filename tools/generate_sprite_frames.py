import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

def generate_frame_sequences():
    base_dir = r"c:\Bot Discord\anh\sieu_thu"
    frames_dir = os.path.join(base_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    # 1. Tải ảnh base của Fire Dragon
    fd_path = os.path.join(base_dir, "fire_dragon.png")
    if not os.path.exists(fd_path):
        print("Fire dragon png not found!")
        return

    base_img = Image.open(fd_path).convert("RGBA")
    w, h = base_img.size

    # Load các layer độc lập
    wl_path = os.path.join(base_dir, "fire_dragon_wing_l.png")
    wr_path = os.path.join(base_dir, "fire_dragon_wing_r.png")
    flame_path = os.path.join(base_dir, "fire_dragon_flame.png")
    body_path = os.path.join(base_dir, "fire_dragon_body.png")

    wing_l = Image.open(wl_path).convert("RGBA") if os.path.exists(wl_path) else base_img
    wing_r = Image.open(wr_path).convert("RGBA") if os.path.exists(wr_path) else base_img
    flame_img = Image.open(flame_path).convert("RGBA") if os.path.exists(flame_path) else base_img
    body_img = Image.open(body_path).convert("RGBA") if os.path.exists(body_path) else base_img

    # ==========================================================
    # CHUỖI 1: IDLE (THỞ & ĐỨNG) - 4 FRAMES
    # Frame 0: Chuẩn bị
    # Frame 1: Hít vào (Ngực phồng, cánh hơi nâng, đuôi uốn nhẹ)
    # Frame 2: Đỉnh thở (Mắt chớp nhẹ, cánh dang rộng)
    # Frame 3: Thở ra (Cơ thể hạ xuống)
    # ==========================================================
    idle_frames = []
    for i in range(4):
        t = i / 4.0
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        
        # Biến dạng thân (Squash & Stretch theo frame)
        scale_y = 1.0 + 0.04 * math.sin(t * math.pi * 2)
        scale_x = 1.0 - 0.02 * math.sin(t * math.pi * 2)
        sw = int(w * scale_x)
        sh = int(h * scale_y)
        res_body = body_img.resize((sw, sh), Image.Resampling.BICUBIC)
        
        # Cánh trái xoay theo frame
        angle_l = math.sin(t * math.pi * 2) * 14
        rot_wl = wing_l.rotate(angle_l, center=(250, 480), resample=Image.Resampling.BICUBIC)
        
        # Cánh phải xoay theo frame
        angle_r = -math.sin(t * math.pi * 2) * 14
        rot_wr = wing_r.rotate(angle_r, center=(580, 480), resample=Image.Resampling.BICUBIC)

        # Lửa đuôi bập bùng theo frame
        flame_scale = 1.0 + 0.15 * math.sin(t * math.pi * 4)
        rot_flame = flame_img.rotate(math.sin(t * math.pi * 2) * 10, center=(680, 600), resample=Image.Resampling.BICUBIC)
        
        # Ghép frame
        frame.paste(rot_wl, (0, 0), rot_wl)
        frame.paste(rot_wr, (0, 0), rot_wr)
        
        body_pos = ((w - sw) // 2, h - sh)
        frame.paste(res_body, body_pos, res_body)
        frame.paste(rot_flame, (0, 0), rot_flame)

        # Mắt chớp ở Frame 2
        if i == 2:
            draw = ImageDraw.Draw(frame)
            # Vẽ mí mắt khép lại
            draw.arc([(310, 370), (370, 410)], 10, 170, fill=(40, 20, 20, 255), width=5)
            draw.arc([(430, 370), (490, 410)], 10, 170, fill=(40, 20, 20, 255), width=5)

        out_name = f"fire_dragon_idle_f{i+1}.png"
        frame.save(os.path.join(frames_dir, out_name))
        idle_frames.append(frame)

    # ==========================================================
    # CHUỖI 2: ATTACK (CÀO VUỐT & PHUN LỬA) - 5 FRAMES
    # Frame 1: Co người lấy đà (Lùi lại, giương vuốt)
    # Frame 2: Lao tới mở rộng vuốt
    # Frame 3: Cào vuốt chém xé (Tia lửa bùng phát)
    # Frame 4: Phun luồng lửa rực cháy từ miệng
    # Frame 5: Thu thế nảy nhẹ
    # ==========================================================
    attack_frames = []
    for i in range(5):
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame)
        
        if i == 0:
            # Lấy đà
            rot_b = body_img.rotate(-10, center=(400, 700), resample=Image.Resampling.BICUBIC)
            frame.paste(rot_b, (-40, 10), rot_b)
        elif i == 1:
            # Lao tới
            rot_b = body_img.rotate(15, center=(400, 700), resample=Image.Resampling.BICUBIC)
            frame.paste(rot_b, (50, -20), rot_b)
        elif i == 2:
            # Cào chém (Slash effect)
            rot_b = body_img.rotate(22, center=(400, 700), resample=Image.Resampling.BICUBIC)
            frame.paste(rot_b, (80, -30), rot_b)
            # Vẽ tia cào vuốt lửa
            draw.line([(450, 250), (680, 420)], fill=(255, 220, 50, 240), width=12)
            draw.line([(430, 290), (660, 460)], fill=(255, 100, 30, 240), width=10)
            draw.line([(410, 330), (640, 500)], fill=(255, 50, 50, 240), width=8)
        elif i == 3:
            # Phun lửa cực đại
            rot_b = body_img.rotate(10, center=(400, 700), resample=Image.Resampling.BICUBIC)
            frame.paste(rot_b, (40, -10), rot_b)
            # Cầu lửa phun từ miệng
            for r in range(60, 10, -10):
                color = (255, int(150 + r), int(30), int(200 - r*2))
                draw.ellipse([(520 - r, 360 - r), (520 + r*2, 360 + r)], fill=color)
        elif i == 4:
            # Thu thế
            frame.paste(body_img, (0, 0), body_img)

        out_name = f"fire_dragon_attack_f{i+1}.png"
        frame.save(os.path.join(frames_dir, out_name))
        attack_frames.append(frame)

    # ==========================================================
    # CHUỖI 3: WING FLAP / FLY (VỖ CÁNH BAY) - 4 FRAMES
    # Frame 1: Cánh cụp xuống
    # Frame 2: Cánh ngang
    # Frame 3: Cánh dang rộng hết cỡ
    # Frame 4: Cánh đập mạnh xuống đẩy thân nâng lên
    # ==========================================================
    fly_frames = []
    angles = [-20, 0, 25, -10]
    elevations = [0, -15, -35, -20]
    for i in range(4):
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ang = angles[i]
        elev = elevations[i]

        rot_wl = wing_l.rotate(ang, center=(250, 480), resample=Image.Resampling.BICUBIC)
        rot_wr = wing_r.rotate(-ang, center=(580, 480), resample=Image.Resampling.BICUBIC)

        frame.paste(rot_wl, (0, elev), rot_wl)
        frame.paste(rot_wr, (0, elev), rot_wr)
        frame.paste(body_img, (0, elev), body_img)
        frame.paste(flame_img, (0, elev), flame_img)

        out_name = f"fire_dragon_fly_f{i+1}.png"
        frame.save(os.path.join(frames_dir, out_name))
        fly_frames.append(frame)

    # ==========================================================
    # TẠO SPRITE SHEET CHUẨN TỔNG HỢP (GRID 4x3) CHO GAME ENGINE
    # ==========================================================
    sheet_cols = 4
    sheet_rows = 3
    frame_w = 400
    frame_h = 400
    sheet = Image.new("RGBA", (frame_w * sheet_cols, frame_h * sheet_rows), (0, 0, 0, 0))

    # Row 0: Idle (4 frames)
    for c in range(4):
        thumb = idle_frames[c].resize((frame_w, frame_h), Image.Resampling.BICUBIC)
        sheet.paste(thumb, (c * frame_w, 0 * frame_h), thumb)

    # Row 1: Attack (4 frames đầu)
    for c in range(4):
        thumb = attack_frames[c].resize((frame_w, frame_h), Image.Resampling.BICUBIC)
        sheet.paste(thumb, (c * frame_w, 1 * frame_h), thumb)

    # Row 2: Fly (4 frames)
    for c in range(4):
        thumb = fly_frames[c].resize((frame_w, frame_h), Image.Resampling.BICUBIC)
        sheet.paste(thumb, (c * frame_w, 2 * frame_h), thumb)

    sheet_path = os.path.join(base_dir, "fire_dragon_spritesheet.png")
    sheet.save(sheet_path)
    print(f"Exported SpriteSheet: {sheet_path} (Size: {sheet.size})")

if __name__ == "__main__":
    generate_frame_sequences()
