using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Launcher
{
    private static int progress;

    [STAThread]
    private static int Main()
    {
        try
        {
            string folder;
            using (var cancel = new CancellationTokenSource())
            {
                Task<string> prepare = Task.Run(() => Prepare(cancel.Token));
                Task.WhenAny(prepare, Task.Delay(600)).GetAwaiter().GetResult();
                if (!prepare.IsCompleted) ShowProgress(prepare, cancel);
                folder = prepare.GetAwaiter().GetResult();
                cancel.Token.ThrowIfCancellationRequested();
            }
            var start = new ProcessStartInfo(Path.Combine(folder, "blog-shorts.exe"));
            start.UseShellExecute = false;
            start.WorkingDirectory = folder;
            start.EnvironmentVariables["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"] = Path.Combine(folder, "webview");
            start.EnvironmentVariables["SHORTS_NODE"] = Path.Combine(folder, "node.exe");
            using (Process app = Process.Start(start)) { }
            return 0;
        }
        catch (OperationCanceledException) { return 0; }
        catch (Exception e)
        {
            MessageBox.Show("앱을 열 수 없습니다.\n\n" + e.Message, "Blog Shorts",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private sealed class ThemedProgressBar : ProgressBar
    {
        public ThemedProgressBar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent.BackColor);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            float radius = Height / 2f;
            using (var track = new Pen(BackColor, Height - 1))
            using (var fill = new Pen(ForeColor, Height - 1))
            {
                track.StartCap = track.EndCap = fill.StartCap = fill.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                e.Graphics.DrawLine(track, radius, radius, Width - radius, radius);
                if (Value > 0)
                    e.Graphics.DrawLine(fill, radius, radius, radius + (Width - Height) * Value / Maximum, radius);
            }
        }
    }

    private static bool LightTheme()
    {
        try
        {
            return !Object.Equals(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1), 0);
        }
        catch (System.Security.SecurityException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    private static void ShowProgress(Task<string> prepare, CancellationTokenSource cancel)
    {
        Application.EnableVisualStyles();
        using (var form = new Form())
        using (var bar = new ThemedProgressBar())
        using (var brandFont = new Font("Segoe UI", 12, FontStyle.Bold))
        using (var brand = new Label())
        using (var close = new Button())
        using (var label = new Label())
        using (var timer = new System.Windows.Forms.Timer())
        {
            form.Text = "Blog Shorts";
            form.StartPosition = FormStartPosition.CenterScreen;
            bool light = LightTheme(), contrast = SystemInformation.HighContrast;
            form.FormBorderStyle = FormBorderStyle.None;
            form.ClientSize = new Size(350, 124);
            form.BackColor = contrast ? SystemColors.Window : (light ? Color.White : Color.FromArgb(36, 38, 46));
            form.ForeColor = contrast ? SystemColors.WindowText : (light ? Color.FromArgb(25, 28, 36) : Color.FromArgb(240, 241, 246));
            form.Font = SystemFonts.MessageBoxFont;
            form.Paint += delegate(object sender, PaintEventArgs e) {
                ControlPaint.DrawBorder(e.Graphics, form.ClientRectangle, bar.BackColor, ButtonBorderStyle.Solid);
            };
            brand.SetBounds(22, 14, 190, 30);
            brand.Font = brandFont;
            brand.Text = "Blog Shorts";
            close.SetBounds(296, 10, 42, 32);
            close.FlatStyle = FlatStyle.Flat;
            close.FlatAppearance.BorderSize = 0;
            close.Text = "×";
            close.Font = brandFont;
            close.AccessibleName = "닫기";
            close.Click += delegate { form.Close(); };
            bool finished = false;
            form.FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (!finished) cancel.Cancel();
            };
            label.Text = "앱 실행에 필요한 파일을 준비하고 있습니다…";
            label.SetBounds(22, 54, 306, 24);
            bar.AccessibleName = "파일 준비 진행률";
            bar.SetBounds(22, 90, 306, 8);
            bar.BackColor = contrast ? SystemColors.WindowText : (light ? Color.FromArgb(217, 220, 230) : Color.FromArgb(73, 78, 91));
            bar.ForeColor = contrast ? SystemColors.Highlight : (light ? Color.FromArgb(48, 77, 225) : Color.FromArgb(172, 185, 255));
            form.Controls.Add(brand);
            form.Controls.Add(close);
            form.Controls.Add(label);
            form.Controls.Add(bar);
            timer.Interval = 120;
            timer.Tick += delegate {
                int value = Volatile.Read(ref progress);
                if (bar.Value != value) { bar.Value = value; bar.Invalidate(); }
                if (prepare.IsCompleted) { finished = true; form.Close(); }
            };
            timer.Start();
            Application.Run(form);
        }
    }

    private static FileStream OpenLock(string file, CancellationToken token)
    {
        var clock = Stopwatch.StartNew();
        while (true)
        {
            token.ThrowIfCancellationRequested();
            try { return File.Open(file, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None); }
            catch (IOException e)
            {
                int code = e.HResult & 0xffff;
                if ((code != 32 && code != 33) || clock.Elapsed.TotalMinutes > 10) throw;
                Thread.Sleep(150);
            }
        }
    }

    private static string Prepare(CancellationToken token)
    {
        var assembly = Assembly.GetExecutingAssembly();
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrWhiteSpace(local) || !Path.IsPathRooted(local))
            local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string root = Path.Combine(local, "Blog Shorts", "runtime",
            assembly.GetName().Version.ToString(3) + "-" + Package.Hash.Substring(0, 12));
        Directory.CreateDirectory(root);
        using (OpenLock(Path.Combine(root, "prepare.lock"), token))
        using (var stream = assembly.GetManifestResourceStream("runtime.zip"))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, true))
        {
            foreach (string folder in Directory.GetDirectories(root, "ready-*"))
            {
                if (Complete(folder, zip)) return folder;
            }

            stream.Position = 0;
            using (var sha = SHA256.Create())
            {
                string hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
                if (!String.Equals(hash, Package.Hash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("파일이 손상되었습니다. blog-shorts.zip을 다시 내려받아 압축을 풀어 주세요.");
            }
            // The lock also covers earlier launches interrupted during extraction.
            foreach (string leftover in Directory.GetDirectories(root, "partial-*"))
                Directory.Delete(leftover, true);
            string id = Guid.NewGuid().ToString("N").Substring(0, 12);
            string stage = Path.Combine(root, "partial-" + id);
            string ready = Path.Combine(root, "ready-" + id);
            Directory.CreateDirectory(stage);
            try
            {
                // Inherit Microsoft's required read/execute ACLs on the fixed runtime only.
                var webview = Directory.CreateDirectory(Path.Combine(stage, "webview"));
                var acl = webview.GetAccessControl();
                foreach (string sid in new[] { "S-1-15-2-1", "S-1-15-2-2" })
                    acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),
                        FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                        PropagationFlags.None, AccessControlType.Allow));
                webview.SetAccessControl(acl);

                long total = 0, written = 0;
                foreach (var entry in zip.Entries) total += entry.Length;
                byte[] buffer = new byte[131072];
                foreach (var entry in zip.Entries)
                {
                    string target = EntryPath(stage, entry);
                    if (entry.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (Stream input = entry.Open())
                    using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        int n;
                        while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            token.ThrowIfCancellationRequested();
                            output.Write(buffer, 0, n);
                            written += n;
                            Volatile.Write(ref progress, (int)(100 * written / total));
                        }
                        if (output.Length != entry.Length) throw new InvalidDataException(entry.FullName);
                    }
                }
                Directory.Move(stage, ready);
                return ready;
            }
            finally
            {
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
    }

    private static string EntryPath(string root, ZipArchiveEntry entry)
    {
        string path = Path.GetFullPath(Path.Combine(root, entry.FullName));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(entry.FullName);
        return path;
    }

    private static bool Complete(string folder, ZipArchive zip)
    {
        foreach (var entry in zip.Entries)
        {
            if (entry.Name.Length == 0) continue;
            var file = new FileInfo(EntryPath(folder, entry));
            if (!file.Exists || file.Length != entry.Length) return false;
        }
        return true;
    }
}
