using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

namespace NetlistGraphBuilderLauncher
{
    internal static class Program
    {
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(string filename, IntPtr file, uint flags);

        [DllImport("kernel32", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PythonMain(int argc, IntPtr argv);

        private static int Main(string[] args)
        {
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                string runtime = Path.Combine(root, "runtime");
                string library = File.ReadAllText(Path.Combine(runtime, "version.txt")).Trim();
                if (!System.Text.RegularExpressions.Regex.IsMatch(library, @"^python3[0-9]+\.dll$"))
                    throw new InvalidDataException("Invalid packaged runtime version.");
                string script = Path.Combine(root, "app", "tools", "serve.py");
                if (!File.Exists(script) || !File.Exists(Path.Combine(root, "app", "index.html")))
                    throw new FileNotFoundException("Release package is incomplete.");

                // Search dependencies beside this DLL and in System32. Never use the caller's PATH.
                IntPtr module = LoadLibraryEx(Path.Combine(runtime, library), IntPtr.Zero, 0x100 | 0x800);
                if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr entry = GetProcAddress(module, "Py_Main");
                if (entry == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                var run = (PythonMain)Marshal.GetDelegateForFunctionPointer(entry, typeof(PythonMain));
                Environment.SetEnvironmentVariable("NGB_WINDOWS_PACKAGE_RUNTIME", "1");
                string[] prefix = {Environment.GetCommandLineArgs()[0], "-I", "-B", "-u", "-X", "utf8", script};
                string[] words = new string[prefix.Length + args.Length];
                prefix.CopyTo(words, 0);
                args.CopyTo(words, prefix.Length);
                IntPtr argv = Marshal.AllocHGlobal((words.Length + 1) * IntPtr.Size);
                IntPtr[] values = new IntPtr[words.Length];
                try
                {
                    for (int i = 0; i < words.Length; i++)
                    {
                        values[i] = Marshal.StringToHGlobalUni(words[i]);
                        Marshal.WriteIntPtr(argv, i * IntPtr.Size, values[i]);
                    }
                    Marshal.WriteIntPtr(argv, words.Length * IntPtr.Size, IntPtr.Zero);
                    return run(words.Length, argv);
                }
                finally
                {
                    foreach (IntPtr value in values) if (value != IntPtr.Zero) Marshal.FreeHGlobal(value);
                    Marshal.FreeHGlobal(argv);
                }
            }
            catch (Exception error)
            {
                TerminalLog.Initialize();
                TerminalLog.Error("startup.failed", "Could not start the packaged workbench", error);
                return 1;
            }
        }
    }
}
