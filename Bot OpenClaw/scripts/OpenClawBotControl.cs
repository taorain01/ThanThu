using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Threading;
using System.Windows.Forms;

namespace OpenClawDiscordControl
{
    internal static class BotRuntime
    {
        internal const string TaskName = "OpenClaw Discord Bot";
        internal const string BotEntryPath = @"C:\Bot Discord\Bot OpenClaw\src\index.js";
        internal const string LogDirectory = @"C:\Bot Discord\Bot OpenClaw\logs";

        internal static List<int> FindProcessIds()
        {
            List<int> ids = new List<int>();
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
            {
                foreach (ManagementObject process in searcher.Get())
                {
                    string commandLine = Convert.ToString(process["CommandLine"]);
                    if (commandLine.IndexOf(BotEntryPath, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        ids.Add(Convert.ToInt32(process["ProcessId"]));
                    }
                    process.Dispose();
                }
            }
            return ids;
        }

        internal static bool RunScheduledTaskCommand(string arguments, out string error)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = Path.Combine(Environment.SystemDirectory, "schtasks.exe");
            info.Arguments = arguments;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;

            using (Process process = Process.Start(info))
            {
                if (!process.WaitForExit(10000))
                {
                    process.Kill();
                    error = "Task Scheduler không phản hồi trong 10 giây.";
                    return false;
                }

                error = process.StandardError.ReadToEnd().Trim();
                if (process.ExitCode != 0 && error.Length == 0)
                {
                    error = process.StandardOutput.ReadToEnd().Trim();
                }
                return process.ExitCode == 0;
            }
        }
    }

    internal sealed class StatusDot : Control
    {
        internal StatusDot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Size = new Size(18, 18);
        }

        internal Color DotColor { get; set; }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (SolidBrush glow = new SolidBrush(Color.FromArgb(50, DotColor)))
            using (SolidBrush dot = new SolidBrush(DotColor))
            {
                e.Graphics.FillEllipse(glow, 0, 0, Width, Height);
                e.Graphics.FillEllipse(dot, 4, 4, Width - 8, Height - 8);
            }
        }
    }

    internal sealed class ControlForm : Form
    {
        private readonly Color background = Color.FromArgb(10, 19, 32);
        private readonly Color card = Color.FromArgb(18, 31, 49);
        private readonly Color muted = Color.FromArgb(145, 164, 184);
        private readonly Color green = Color.FromArgb(49, 208, 170);
        private readonly Color red = Color.FromArgb(255, 107, 107);
        private readonly StatusDot statusDot = new StatusDot();
        private readonly Label statusTitle = new Label();
        private readonly Label statusDetail = new Label();
        private readonly Button startButton;
        private readonly Button stopButton;
        private readonly System.Windows.Forms.Timer refreshTimer = new System.Windows.Forms.Timer();

        internal ControlForm()
        {
            Text = "OpenClaw Discord Bot";
            Icon = SystemIcons.Application;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 410);
            MinimumSize = new Size(576, 449);
            MaximumSize = new Size(576, 449);
            BackColor = background;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10F, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;

            Panel accent = new Panel();
            accent.BackColor = green;
            accent.Dock = DockStyle.Top;
            accent.Height = 6;
            Controls.Add(accent);

            Label eyebrow = MakeLabel("OPENCLAW / DISCORD CONTROL", 32, 30, 490, 22, muted, 9F, FontStyle.Bold);
            Label title = MakeLabel("Điều khiển bot", 32, 54, 490, 42, Color.White, 24F, FontStyle.Bold);
            title.Font = new Font("Bahnschrift SemiBold", 24F, FontStyle.Bold);
            Controls.Add(eyebrow);
            Controls.Add(title);

            Panel statusCard = new Panel();
            statusCard.Location = new Point(32, 112);
            statusCard.Size = new Size(496, 104);
            statusCard.BackColor = card;
            Controls.Add(statusCard);

            statusDot.Location = new Point(22, 28);
            statusCard.Controls.Add(statusDot);

            statusTitle.Location = new Point(55, 20);
            statusTitle.Size = new Size(410, 30);
            statusTitle.Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold);
            statusTitle.ForeColor = Color.White;
            statusCard.Controls.Add(statusTitle);

            statusDetail.Location = new Point(56, 53);
            statusDetail.Size = new Size(410, 35);
            statusDetail.ForeColor = muted;
            statusCard.Controls.Add(statusDetail);

            startButton = MakeButton("Bật bot", 32, 240, 155, green, Color.FromArgb(5, 36, 31));
            stopButton = MakeButton("Tắt bot", 202, 240, 155, red, Color.FromArgb(53, 20, 24));
            Button refreshButton = MakeButton("Làm mới", 372, 240, 156, Color.FromArgb(86, 112, 140), card);
            Controls.Add(startButton);
            Controls.Add(stopButton);
            Controls.Add(refreshButton);

            Button logButton = MakeButton("Mở thư mục log", 32, 306, 496, Color.FromArgb(39, 59, 80), Color.White);
            Controls.Add(logButton);

            Label footer = MakeLabel(
                "Bot chạy nền qua Task Scheduler · Không mở cửa sổ console",
                32,
                370,
                496,
                22,
                muted,
                9F,
                FontStyle.Regular);
            footer.TextAlign = ContentAlignment.MiddleCenter;
            Controls.Add(footer);

            startButton.Click += delegate { StartBot(); };
            stopButton.Click += delegate { StopBot(); };
            refreshButton.Click += delegate { RefreshStatus(); };
            logButton.Click += delegate { OpenLogDirectory(); };

            refreshTimer.Interval = 2000;
            refreshTimer.Tick += delegate { RefreshStatus(); };
            refreshTimer.Start();
            Shown += delegate { RefreshStatus(); };
        }

        private Label MakeLabel(
            string text,
            int x,
            int y,
            int width,
            int height,
            Color color,
            float size,
            FontStyle style)
        {
            Label label = new Label();
            label.Text = text;
            label.Location = new Point(x, y);
            label.Size = new Size(width, height);
            label.ForeColor = color;
            label.Font = new Font("Segoe UI", size, style);
            return label;
        }

        private Button MakeButton(string text, int x, int y, int width, Color backColor, Color foreColor)
        {
            Button button = new Button();
            button.Text = text;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 48);
            button.BackColor = backColor;
            button.ForeColor = foreColor;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 0;
            button.Font = new Font("Segoe UI Semibold", 10.5F, FontStyle.Bold);
            button.Cursor = Cursors.Hand;
            return button;
        }

        private void RefreshStatus()
        {
            try
            {
                List<int> processIds = BotRuntime.FindProcessIds();
                bool running = processIds.Count > 0;
                statusDot.DotColor = running ? green : red;
                statusDot.Invalidate();
                statusTitle.Text = running ? "Bot đang chạy" : "Bot đang tắt";
                statusDetail.Text = running
                    ? string.Format("PID {0} · Discord bridge đang hoạt động", string.Join(", ", processIds))
                    : "Sẵn sàng bật thủ công khi bạn cần";
                startButton.Enabled = !running;
                stopButton.Enabled = running;
            }
            catch (Exception error)
            {
                statusDot.DotColor = red;
                statusDot.Invalidate();
                statusTitle.Text = "Không đọc được trạng thái";
                statusDetail.Text = error.Message;
            }
        }

        private void StartBot()
        {
            Cursor = Cursors.WaitCursor;
            string error;
            bool success = BotRuntime.RunScheduledTaskCommand(
                string.Format("/Run /TN \"{0}\"", BotRuntime.TaskName),
                out error);
            Thread.Sleep(900);
            Cursor = Cursors.Default;
            RefreshStatus();
            if (!success)
            {
                MessageBox.Show(error, "Không bật được bot", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopBot()
        {
            Cursor = Cursors.WaitCursor;
            string error;
            bool success = BotRuntime.RunScheduledTaskCommand(
                string.Format("/End /TN \"{0}\"", BotRuntime.TaskName),
                out error);
            Thread.Sleep(700);
            Cursor = Cursors.Default;
            RefreshStatus();
            if (!success)
            {
                MessageBox.Show(error, "Không tắt được bot", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenLogDirectory()
        {
            Directory.CreateDirectory(BotRuntime.LogDirectory);
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = BotRuntime.LogDirectory;
            info.UseShellExecute = true;
            Process.Start(info);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControlForm());
        }
    }
}
