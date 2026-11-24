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

internal static class Launcher
{
    private static int progress;

    [STAThread]
    private static int Main()
    {
        try
        {
            Task<string> prepare = Task.Run((Func<string>)Prepare);
            Task.WhenAny(prepare, Task.Delay(600)).GetAwaiter().GetResult();
            if (!prepare.IsCompleted) ShowProgress(prepare);
            string folder = prepare.GetAwaiter().GetResult();
            var start = new ProcessStartInfo(Path.Combine(folder, "blog-shorts.exe"));
            start.UseShellExecute = false;
            start.WorkingDirectory = folder;
            start.EnvironmentVariables["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"] = Path.Combine(folder, "webview");
            start.EnvironmentVariables["SHORTS_NODE"] = Path.Combine(folder, "node.exe");
            using (Process app = Process.Start(start)) { }
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("앱을 열 수 없습니다.\n\n" + e.Message, "Blog Shorts",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void ShowProgress(Task<string> prepare)
    {
        Application.EnableVisualStyles();
        using (var form = new Form())
        using (var bar = new ProgressBar())
        using (var label = new Label())
        using (var timer = new System.Windows.Forms.Timer())
        {
            form.Text = "Blog Shorts";
            form.StartPosition = FormStartPosition.CenterScreen;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.ControlBox = false;
            form.ClientSize = new Size(340, 90);
            form.Font = SystemFonts.MessageBoxFont;
            label.Text = "앱 실행에 필요한 파일을 준비하고 있습니다…";
            label.SetBounds(20, 17, 300, 23);
            bar.SetBounds(20, 49, 300, 12);
            form.Controls.Add(label);
            form.Controls.Add(bar);
            timer.Interval = 120;
            timer.Tick += delegate {
                bar.Value = Volatile.Read(ref progress);
                if (prepare.IsCompleted) form.Close();
            };
            timer.Start();
            Application.Run(form);
        }
    }

    private static FileStream OpenLock(string file)
    {
        var clock = Stopwatch.StartNew();
        while (true)
        {
            try { return File.Open(file, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None); }
            catch (IOException e)
            {
                int code = e.HResult & 0xffff;
                if ((code != 32 && code != 33) || clock.Elapsed.TotalMinutes > 10) throw;
                Thread.Sleep(150);
            }
        }
    }

    private static string Prepare()
    {
        var assembly = Assembly.GetExecutingAssembly();
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrWhiteSpace(local) || !Path.IsPathRooted(local))
            local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string root = Path.Combine(local, "Blog Shorts", "runtime",
            assembly.GetName().Version.ToString(3) + "-" + Package.Hash.Substring(0, 12));
        Directory.CreateDirectory(root);
        using (OpenLock(Path.Combine(root, "prepare.lock")))
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
                    throw new InvalidDataException("파일이 손상되었습니다. blog-shorts.exe를 다시 다운로드하세요.");
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
