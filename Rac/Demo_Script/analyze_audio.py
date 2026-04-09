import os
import time
import google.generativeai as genai

# Load API key directly from .env
api_key = None
with open(r"c:\ALABASTA\ThanThu\.env", "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line.startswith("GEMINI_API_KEY=") or line.startswith("GOOGLE_API_KEY="):
            # parse out quotes if any
            api_key = line.split("=", 1)[1].strip('"\'')
            break

if not api_key:
    print("Error: Could not find GEMINI_API_KEY or GOOGLE_API_KEY in .env")
    exit(1)

genai.configure(api_key=api_key)

# Upload the file
audio_file_path = r"c:\ALABASTA\ThanThu\Let It Be.wav"
print(f"Uploading {audio_file_path}...")
myfile = genai.upload_file(audio_file_path)

# Wait for file processing if needed
print(f"File uploaded as {myfile.name}. Waiting for processing...")
while True:
    f = genai.get_file(myfile.name)
    if f.state.name == "PROCESSING":
        print(".", end="", flush=True)
        time.sleep(3)
    elif f.state.name == "FAILED":
        print("\nError: Processing failed.")
        exit(1)
    else:
        print("\nFile ready!")
        break

# Use Gemini 1.5 Pro to analyze
model = genai.GenerativeModel('gemini-1.5-pro')

prompt = """
Hãy nghe kỹ file âm thanh (bài hát) này và:
1. Phân tích chi tiết:
- Thể loại nhạc (Genre).
- Tinh thần / Cảm xúc (Mood / Vibe).
- Các loại nhạc cụ chính được sử dụng.
- Giọng hát (Voice: nam hay nữ, cách hát như thế nào).
- Nhịp / Tốc độ (Tempo / Rhythm).

2. Phân tích thành 'Style Prompt' cho Suno AI:
- Dựa trên phân tích trên, hãy chuyển đổi các đặc điểm thành một đoạn 'Style Prompt' bằng TIẾNG ANH (tối đa 120 ký tự) tối ưu cho Suno AI. Format của Suno Style prompt là các từ hoặc cụm từ khóa tiếng Anh cách nhau bằng dấu phẩy. 
Ví dụ: `acoustic pop rock, sad emotional male vocal, slow piano chords, soft drums, melancholic ballad`

Trả về kết quả bằng tiếng Việt theo định dạng rõ ràng.
"""

print("Generating analysis with Gemini...\n")
response = model.generate_content([myfile, prompt])

print("=== KẾT QUẢ PHÂN TÍCH ===")
print(response.text)
