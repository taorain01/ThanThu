import os, uuid
from urllib.request import Request, urlopen

WEBHOOK = "https://discord.com/api/webhooks/1483188114213306439/gRQCcD-DbpB0Li4ZpBjq5WvQ6mT-mV3rqIS3kOcXK-AO3Zb3xtM9fp7QZykofHRjR7CD"

fp = r"c:\ALABASTA\ThanThu\bao_cao_tune_do.html"
with open(fp, "rb") as f:
    data = f.read()
fname = os.path.basename(fp)
fsize = len(data)

boundary = uuid.uuid4().hex
body = b""
body += f"--{boundary}\r\n".encode()
body += b'Content-Disposition: form-data; name="content"\r\n\r\n'
body += f"\U0001f4ca **Bao Cao He Thong Tune Do** - ThanThu Bot ({fsize/1024:.1f} KB)\r\n".encode()
body += f"--{boundary}\r\n".encode()
body += f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'.encode()
body += b"Content-Type: text/html\r\n\r\n"
body += data
body += b"\r\n"
body += f"--{boundary}--\r\n".encode()

req = Request(WEBHOOK, data=body, method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
req.add_header("User-Agent", "Mozilla/5.0")
try:
    resp = urlopen(req, timeout=30)
    print(f"OK status={resp.status}")
except Exception as e:
    print(f"Error: {e}")
