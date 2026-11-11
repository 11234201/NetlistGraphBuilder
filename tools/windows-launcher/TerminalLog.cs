using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace NetlistGraphBuilderLauncher
{
    internal static class TerminalLog
    {
        private static readonly object Gate = new object();
        private static readonly int Pid = Process.GetCurrentProcess().Id;
        private static readonly string DirectoryPath;
        private static readonly string RunPath;
        private static readonly string ErrorPath;
        private static readonly long Limit;
        private static bool enabled = true;
        private static long runSize;
        private static long errorSize;

        static TerminalLog()
        {
            long configured;
            Limit = long.TryParse(Environment.GetEnvironmentVariable("NGB_LOG_MAX_BYTES"), out configured) &&
                configured >= 1024 && configured <= 67108864 ? configured : 2097152;
            try
            {
                string configuredDirectory = Environment.GetEnvironmentVariable("NGB_LOG_DIR");
                DirectoryPath = Path.GetFullPath(String.IsNullOrEmpty(configuredDirectory) ? Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "netlist_graph_builder", "logs") : configuredDirectory);
                string prefix = "windows-" + DateTime.UtcNow.Ticks + "-" + Pid;
                RunPath = Path.Combine(DirectoryPath, prefix + ".run.jsonl");
                ErrorPath = Path.Combine(DirectoryPath, prefix + ".error.jsonl");
                Directory.CreateDirectory(DirectoryPath);
                using (File.Create(RunPath)) { }
                using (File.Create(ErrorPath)) { }
            }
            catch (Exception error) { Disable(error); }
            Write("info", "log.ready", "Terminal logging initialized", new Dictionary<string, object> { { "run", RunPath }, { "error", ErrorPath } });
        }

        internal static void Initialize() { }

        internal static void Write(string level, string eventName, string message, Dictionary<string, object> details = null, bool console = true)
        {
            lock (Gate)
            {
                string line = Record(level, eventName, message, details);
                if (enabled)
                {
                    try
                    {
                        Append(RunPath, ref runSize, line);
                        if (level == "error") Append(ErrorPath, ref errorSize, line);
                    }
                    catch (Exception error) { Disable(error); }
                }
                if (console || !enabled) Stderr(line);
            }
        }

        internal static void Error(string eventName, string message, Exception error = null)
        {
            var details = new Dictionary<string, object>();
            if (error != null) details["error"] = new Dictionary<string, object> {
                { "name", error.GetType().Name }, { "message", Clip(error.Message, 4096) },
                { "stack", Clip(error.ToString(), 8192) }, { "code", error.HResult }
            };
            Write("error", eventName, message, details);
        }

        internal static void Request(string method, string target, int status)
        {
            Write(status >= 500 ? "error" : status >= 400 ? "warning" : "info", "http.response", "HTTP response",
                new Dictionary<string, object> { { "method", Clip(method, 32) }, { "path", Clip((target ?? "/").Split('?', '#')[0], 4096) }, { "status", status } }, false);
        }

        internal static bool Contains(string path)
        {
            if (String.IsNullOrEmpty(DirectoryPath)) return false;
            return path.Equals(DirectoryPath, StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith(DirectoryPath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        private static string Clip(string text, int limit) { return text == null ? "" : text.Length > limit ? text.Substring(0, limit) : text; }

        private static string Record(string level, string eventName, string message, Dictionary<string, object> details)
        {
            return new JavaScriptSerializer().Serialize(new Dictionary<string, object> {
                { "time", DateTime.UtcNow.ToString("o") }, { "level", level }, { "runtime", "windows" },
                { "pid", Pid }, { "event", eventName }, { "message", Clip(message, 4096) }, { "details", details }
            }) + "\n";
        }

        private static void Append(string path, ref long size, string line)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(line);
            if (size > 0 && size + bytes.Length > Limit)
            {
                if (File.Exists(path + ".1")) File.Delete(path + ".1");
                File.Move(path, path + ".1");
                size = 0;
            }
            using (var file = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read)) file.Write(bytes, 0, bytes.Length);
            size += bytes.Length;
        }

        private static void Stderr(string line) { try { Console.Error.Write(line); Console.Error.Flush(); } catch (IOException) { } }

        private static void Disable(Exception error)
        {
            if (!enabled) return;
            enabled = false;
            Stderr(Record("error", "log.write_failed", "File logging unavailable; continuing on stderr",
                new Dictionary<string, object> { { "error", Clip(error.ToString(), 4096) } }));
        }
    }
}
