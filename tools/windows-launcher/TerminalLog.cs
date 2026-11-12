using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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
            if (enabled)
            {
                var result = Cleanup();
                bool failed = (int)result["failedFiles"] != 0;
                Write(failed ? "error" : "info", failed ? "log.cleanup_failed" : "log.cleanup",
                    "Old terminal log cleanup completed", result, failed);
            }
        }

        internal static void Initialize() { }

        [DllImport("kernel32.dll", EntryPoint = "DeleteFileW", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteLogFile(string path);

        private sealed class CleanupGroup
        {
            internal int Pid;
            internal readonly List<string> Paths = new List<string>();
        }

        private static bool IsInactive(int pid)
        {
            try { using (Process process = Process.GetProcessById(pid)) return process.HasExited; }
            catch (ArgumentException) { return true; }
            catch (Exception) { return false; } // Access denied / unknown: keep the logs.
        }

        private static Dictionary<string, object> Cleanup()
        {
            string configured = Environment.GetEnvironmentVariable("NGB_LOG_RETENTION_DAYS") ?? "";
            int days;
            if (!Regex.IsMatch(configured, @"\A[0-9]{1,4}\z") || !Int32.TryParse(configured, out days) || days > 3650) days = 14;
            var result = new Dictionary<string, object> { { "retentionDays", days }, { "deletedFiles", 0 },
                { "deletedBytes", 0L }, { "failedFiles", 0 } };
            if (days == 0) return result;
            DateTime cutoff = DateTime.UtcNow.AddDays(-days);
            var pattern = new Regex(@"\A(bash|node|python|native|windows)-[0-9]{1,20}-([1-9][0-9]{0,9})\.(run|error)\.jsonl(\.1)?\z");
            var groups = new Dictionary<string, CleanupGroup>();
            Action<Exception> failed = delegate(Exception error)
            {
                if (error is FileNotFoundException || error is DirectoryNotFoundException) return;
                result["failedFiles"] = (int)result["failedFiles"] + 1;
                if (!result.ContainsKey("error")) result["error"] = Clip(error.ToString(), 4096);
            };
            Mutex cleanupGate = null;
            bool acquired = false;
            try
            {
                // Windows can accept two DeleteFile calls before either deletion completes.
                // Serialize launchers for this directory; the other startup simply skips this pass.
                string mutexKey;
                using (var hash = SHA256.Create())
                    mutexKey = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(
                        DirectoryPath.TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant()))).Replace("-", "");
                cleanupGate = new Mutex(false, @"Local\NetlistGraphBuilder.LogCleanup." + mutexKey);
                try { acquired = cleanupGate.WaitOne(0); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) { result["skipped"] = "cleanup_in_progress"; return result; }
                foreach (string path in Directory.GetFileSystemEntries(DirectoryPath))
                {
                    string name = Path.GetFileName(path);
                    Match match = pattern.Match(name);
                    int pid;
                    if (!match.Success || !Int32.TryParse(match.Groups[2].Value, out pid)) continue;
                    string key = name.Split('.')[0];
                    CleanupGroup group;
                    if (!groups.TryGetValue(key, out group)) groups[key] = group = new CleanupGroup { Pid = pid };
                    group.Paths.Add(path);
                }
                foreach (CleanupGroup group in groups.Values)
                {
                    if (!IsInactive(group.Pid)) continue;
                    bool preserve = false;
                    var sizes = new List<long>();
                    foreach (string path in group.Paths)
                    {
                        try
                        {
                            FileAttributes attributes = File.GetAttributes(path);
                            if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) { preserve = true; break; }
                            var info = new FileInfo(path);
                            if (info.LastWriteTimeUtc >= cutoff) { preserve = true; break; }
                            sizes.Add(info.Length);
                        }
                        catch (Exception error) { failed(error); preserve = true; break; }
                    }
                    if (preserve || !IsInactive(group.Pid)) continue;
                    for (int index = 0; index < group.Paths.Count; ++index)
                    {
                        try
                        {
                            // File.Delete silently succeeds when another launcher already removed it.
                            // Count only deletions performed by this process.
                            if (!DeleteLogFile(group.Paths[index]))
                            {
                                int code = Marshal.GetLastWin32Error();
                                if (code == 2 || code == 3) continue;
                                throw new Win32Exception(code, "Cannot remove " + group.Paths[index] + " (Win32 " + code + ")");
                            }
                            result["deletedFiles"] = (int)result["deletedFiles"] + 1;
                            result["deletedBytes"] = (long)result["deletedBytes"] + sizes[index];
                        }
                        catch (Exception error) { failed(error); }
                    }
                }
            }
            catch (Exception error) { failed(error); }
            finally
            {
                if (acquired) cleanupGate.ReleaseMutex();
                if (cleanupGate != null) cleanupGate.Dispose();
            }
            return result;
        }

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
