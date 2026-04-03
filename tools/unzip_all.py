"""
Phần mềm giải nén hàng loạt file ZIP trong folder đã chọn.
Giải nén tại chỗ (cùng thư mục với file ZIP).
"""

import os
import zipfile
import threading
import tkinter as tk
from tkinter import filedialog, ttk
from datetime import datetime


class UnzipApp:
    def __init__(self, root):
        self.root = root
        self.root.title("⚡ Giải Nén Hàng Loạt")
        self.root.geometry("720x560")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")

        # Biến
        self.folder_path = tk.StringVar(value="")
        self.is_running = False

        self._build_ui()
        self._center_window()

    def _center_window(self):
        """Căn giữa cửa sổ trên màn hình"""
        self.root.update_idletasks()
        w = self.root.winfo_width()
        h = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (w // 2)
        y = (self.root.winfo_screenheight() // 2) - (h // 2)
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    def _build_ui(self):
        """Xây dựng giao diện"""
        # Style
        style = ttk.Style()
        style.theme_use("clam")

        # Cấu hình style cho progress bar
        style.configure(
            "Custom.Horizontal.TProgressbar",
            troughcolor="#16213e",
            background="#e94560",
            thickness=22,
        )

        # ===== HEADER =====
        header = tk.Frame(self.root, bg="#16213e", height=70)
        header.pack(fill="x")
        header.pack_propagate(False)

        tk.Label(
            header,
            text="📦  GIẢI NÉN HÀNG LOẠT  📦",
            font=("Segoe UI", 18, "bold"),
            fg="#e94560",
            bg="#16213e",
        ).pack(expand=True)

        # ===== CHỌN THƯ MỤC =====
        folder_frame = tk.Frame(self.root, bg="#1a1a2e", pady=15, padx=20)
        folder_frame.pack(fill="x")

        tk.Label(
            folder_frame,
            text="📁 Thư mục chứa file ZIP:",
            font=("Segoe UI", 11),
            fg="#a8a8b3",
            bg="#1a1a2e",
            anchor="w",
        ).pack(fill="x")

        entry_frame = tk.Frame(folder_frame, bg="#1a1a2e")
        entry_frame.pack(fill="x", pady=(5, 0))

        self.entry = tk.Entry(
            entry_frame,
            textvariable=self.folder_path,
            font=("Segoe UI", 11),
            bg="#0f3460",
            fg="#ffffff",
            insertbackground="#ffffff",
            relief="flat",
            bd=0,
        )
        self.entry.pack(side="left", fill="x", expand=True, ipady=8, padx=(0, 8))

        self.btn_browse = tk.Button(
            entry_frame,
            text="  Chọn...  ",
            font=("Segoe UI", 10, "bold"),
            bg="#e94560",
            fg="white",
            activebackground="#c81e45",
            activeforeground="white",
            relief="flat",
            cursor="hand2",
            command=self._browse_folder,
        )
        self.btn_browse.pack(side="right", ipady=6)

        # ===== TÙY CHỌN =====
        opt_frame = tk.Frame(self.root, bg="#1a1a2e", padx=20)
        opt_frame.pack(fill="x")

        self.var_subfolder = tk.BooleanVar(value=True)
        tk.Checkbutton(
            opt_frame,
            text="Giải nén vào thư mục con (tên = tên file ZIP)",
            variable=self.var_subfolder,
            font=("Segoe UI", 10),
            fg="#a8a8b3",
            bg="#1a1a2e",
            selectcolor="#0f3460",
            activebackground="#1a1a2e",
            activeforeground="#e94560",
        ).pack(anchor="w")

        self.var_delete = tk.BooleanVar(value=False)
        tk.Checkbutton(
            opt_frame,
            text="Xóa file ZIP sau khi giải nén thành công",
            variable=self.var_delete,
            font=("Segoe UI", 10),
            fg="#a8a8b3",
            bg="#1a1a2e",
            selectcolor="#0f3460",
            activebackground="#1a1a2e",
            activeforeground="#e94560",
        ).pack(anchor="w")

        # ===== NÚT BẮT ĐẦU =====
        btn_frame = tk.Frame(self.root, bg="#1a1a2e", pady=12)
        btn_frame.pack(fill="x")

        self.btn_start = tk.Button(
            btn_frame,
            text="⚡  BẮT ĐẦU GIẢI NÉN",
            font=("Segoe UI", 13, "bold"),
            bg="#e94560",
            fg="white",
            activebackground="#c81e45",
            activeforeground="white",
            relief="flat",
            cursor="hand2",
            command=self._start_unzip,
        )
        self.btn_start.pack(ipady=8, ipadx=30)

        # ===== PROGRESS =====
        prog_frame = tk.Frame(self.root, bg="#1a1a2e", padx=20)
        prog_frame.pack(fill="x", pady=(5, 0))

        self.lbl_status = tk.Label(
            prog_frame,
            text="Sẵn sàng...",
            font=("Segoe UI", 10),
            fg="#53c28b",
            bg="#1a1a2e",
            anchor="w",
        )
        self.lbl_status.pack(fill="x")

        self.progress = ttk.Progressbar(
            prog_frame,
            style="Custom.Horizontal.TProgressbar",
            orient="horizontal",
            mode="determinate",
        )
        self.progress.pack(fill="x", pady=(5, 0))

        # ===== LOG =====
        log_frame = tk.Frame(self.root, bg="#1a1a2e", padx=20, pady=10)
        log_frame.pack(fill="both", expand=True)

        tk.Label(
            log_frame,
            text="📋 Nhật ký:",
            font=("Segoe UI", 10),
            fg="#a8a8b3",
            bg="#1a1a2e",
            anchor="w",
        ).pack(fill="x")

        self.log_text = tk.Text(
            log_frame,
            font=("Consolas", 9),
            bg="#0a0a1a",
            fg="#a8a8b3",
            relief="flat",
            wrap="word",
            state="disabled",
            height=10,
        )
        self.log_text.pack(fill="both", expand=True, pady=(5, 0))

        # Tag màu cho log
        self.log_text.tag_configure("success", foreground="#53c28b")
        self.log_text.tag_configure("error", foreground="#e94560")
        self.log_text.tag_configure("info", foreground="#4fc3f7")

    def _browse_folder(self):
        """Mở dialog chọn thư mục"""
        path = filedialog.askdirectory(title="Chọn thư mục chứa file ZIP")
        if path:
            self.folder_path.set(path)
            # Đếm file ZIP
            zips = [f for f in os.listdir(path) if f.lower().endswith(".zip")]
            self._log(f"Tìm thấy {len(zips)} file ZIP trong thư mục.", "info")

    def _log(self, msg, tag=None):
        """Ghi log vào Text widget"""
        self.log_text.config(state="normal")
        timestamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{timestamp}] {msg}\n"
        if tag:
            self.log_text.insert("end", line, tag)
        else:
            self.log_text.insert("end", line)
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def _start_unzip(self):
        """Bắt đầu giải nén trên thread riêng"""
        folder = self.folder_path.get().strip()
        if not folder or not os.path.isdir(folder):
            self._log("❌ Vui lòng chọn thư mục hợp lệ!", "error")
            return

        if self.is_running:
            return

        # Tìm tất cả file ZIP
        zip_files = [
            f for f in os.listdir(folder) if f.lower().endswith(".zip")
        ]

        if not zip_files:
            self._log("⚠️ Không tìm thấy file ZIP nào trong thư mục!", "error")
            return

        self.is_running = True
        self.btn_start.config(state="disabled", bg="#555555")
        self.btn_browse.config(state="disabled")

        thread = threading.Thread(
            target=self._unzip_worker,
            args=(folder, zip_files),
            daemon=True,
        )
        thread.start()

    def _unzip_worker(self, folder, zip_files):
        """Worker thread giải nén"""
        total = len(zip_files)
        success = 0
        failed = 0

        self.root.after(0, lambda: self._log(
            f"🚀 Bắt đầu giải nén {total} file...", "info"
        ))
        self.root.after(0, lambda: self.progress.configure(maximum=total, value=0))

        for i, zf in enumerate(zip_files, 1):
            zip_path = os.path.join(folder, zf)

            # Xác định thư mục đích
            if self.var_subfolder.get():
                dest = os.path.join(folder, os.path.splitext(zf)[0])
                os.makedirs(dest, exist_ok=True)
            else:
                dest = folder

            try:
                with zipfile.ZipFile(zip_path, "r") as z:
                    z.extractall(dest)

                msg_ok = f"✅ [{i}/{total}] {zf} → {os.path.basename(dest)}/"
                self.root.after(0, lambda m=msg_ok: self._log(m, "success"))
                success += 1

                # Xóa file ZIP nếu được chọn
                if self.var_delete.get():
                    os.remove(zip_path)
                    self.root.after(0, lambda f=zf: self._log(
                        f"🗑️ Đã xóa {f}", "info"
                    ))

            except zipfile.BadZipFile:
                msg_err = f"❌ [{i}/{total}] {zf} — File ZIP bị hỏng!"
                self.root.after(0, lambda m=msg_err: self._log(m, "error"))
                failed += 1
            except Exception as e:
                msg_err = f"❌ [{i}/{total}] {zf} — Lỗi: {e}"
                self.root.after(0, lambda m=msg_err: self._log(m, "error"))
                failed += 1

            # Cập nhật progress bar
            self.root.after(0, lambda v=i: self.progress.configure(value=v))
            self.root.after(0, lambda v=i, t=total: self.lbl_status.config(
                text=f"Đang xử lý: {v}/{t}"
            ))

        # Hoàn thành
        summary = f"🏁 Hoàn thành! Thành công: {success}, Thất bại: {failed}"
        self.root.after(0, lambda: self._log(summary, "success" if failed == 0 else "error"))
        self.root.after(0, lambda: self.lbl_status.config(text="Hoàn thành! ✨"))
        self.root.after(0, self._reset_buttons)

    def _reset_buttons(self):
        """Kích hoạt lại các nút"""
        self.is_running = False
        self.btn_start.config(state="normal", bg="#e94560")
        self.btn_browse.config(state="normal")


if __name__ == "__main__":
    root = tk.Tk()
    app = UnzipApp(root)
    root.mainloop()
