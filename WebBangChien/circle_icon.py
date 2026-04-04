import os
from rembg import remove
from PIL import Image, ImageDraw

def make_circle_icon(input_path, output_path):
    try:
        # Read the image
        with Image.open(input_path) as img:
            img = img.convert("RGBA")
            
            # 1. Use rembg to remove background
            no_bg_img = remove(img)
            
            # Ensure it's square
            width, height = no_bg_img.size
            size = min(width, height)
            
            # Calculate cropping box to make it square
            left = (width - size) / 2
            top = (height - size) / 2
            right = (width + size) / 2
            bottom = (height + size) / 2
            
            square_img = no_bg_img.crop((left, top, right, bottom))
            
            # 2. Make it circular
            mask = Image.new('L', (size, size), 0)
            draw = ImageDraw.Draw(mask)
            draw.ellipse((0, 0, size, size), fill=255)
            
            # Apply the circular mask
            circular_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            circular_img.paste(square_img, (0, 0), mask=mask)
            
            circular_img.save(output_path, "PNG")
            print(f"Successfully created {output_path}")
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

if __name__ == "__main__":
    make_circle_icon("anh/lang_gia_logo_raw.png", "anh/langgia_icon_circle.png")
    make_circle_icon("anh/langgia_icon.png", "anh/langgia_icon_circle_2.png")
