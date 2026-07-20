using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace NetlistGraphBuilderLauncher
{
    internal static class Program
    {
        private static readonly string AppRoot = Path.GetFullPath(
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
        private static volatile bool running = true;
        private static TcpListener listener;

        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            if (!File.Exists(Path.Combine(AppRoot, "index.html")))
            {
                Console.Error.WriteLine("Release package is incomplete: app\\index.html was not found.");
                return 2;
            }

            bool openBrowser = true;
            bool explicitPort = false;
            int port = 4173;
            for (int index = 0; index < args.Length; index++)
            {
                if (args[index] == "--no-browser")
                {
                    openBrowser = false;
                }
                else if (args[index] == "--port" && index + 1 < args.Length)
                {
                    int parsedPort;
                    if (!int.TryParse(args[++index], out parsedPort) || parsedPort < 1 || parsedPort > 65535)
                    {
                        Console.Error.WriteLine("Invalid --port value.");
                        return 2;
                    }
                    port = parsedPort;
                    explicitPort = true;
                }
            }

            listener = StartListener(port, explicitPort, out port);
            if (listener == null) return 1;

            string url = "http://127.0.0.1:" + port + "/";
            Console.Title = "Netlist Graph Builder";
            Console.WriteLine("Netlist Graph Builder is running at " + url);
            Console.WriteLine("Keep this window open. Press Ctrl+C to stop.");
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
            {
                eventArgs.Cancel = true;
                running = false;
                listener.Stop();
            };

            if (openBrowser) OpenBrowser(url);

            while (running)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { HandleClient(client); });
                }
                catch (SocketException)
                {
                    if (running) throw;
                }
                catch (ObjectDisposedException)
                {
                    if (running) throw;
                }
            }
            return 0;
        }

        private static TcpListener StartListener(int requestedPort, bool explicitPort, out int selectedPort)
        {
            int attempts = explicitPort ? 1 : 20;
            for (int offset = 0; offset < attempts; offset++)
            {
                int candidate = requestedPort + offset;
                try
                {
                    TcpListener candidateListener = new TcpListener(IPAddress.Loopback, candidate);
                    candidateListener.Start();
                    selectedPort = candidate;
                    return candidateListener;
                }
                catch (SocketException)
                {
                    if (explicitPort)
                    {
                        Console.Error.WriteLine("Port " + candidate + " is already in use.");
                    }
                }
            }

            selectedPort = requestedPort;
            Console.Error.WriteLine("Could not find an available local port.");
            return null;
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not open the default browser: " + error.Message);
                Console.Error.WriteLine("Open this address manually: " + url);
            }
        }

        private static void HandleClient(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    NetworkStream stream = client.GetStream();
                    StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true);
                    string requestLine = reader.ReadLine();
                    if (String.IsNullOrWhiteSpace(requestLine)) return;

                    string header;
                    do
                    {
                        header = reader.ReadLine();
                    } while (!String.IsNullOrEmpty(header));

                    string[] requestParts = requestLine.Split(' ');
                    if (requestParts.Length < 2 || (requestParts[0] != "GET" && requestParts[0] != "HEAD"))
                    {
                        WriteTextResponse(stream, 405, "Method Not Allowed", "Method not allowed", false);
                        return;
                    }

                    string relativePath;
                    if (!TryResolveRequestPath(requestParts[1], out relativePath))
                    {
                        WriteTextResponse(stream, 403, "Forbidden", "Forbidden", requestParts[0] == "HEAD");
                        return;
                    }

                    string filePath = Path.GetFullPath(Path.Combine(
                        AppRoot,
                        relativePath.Replace('/', Path.DirectorySeparatorChar)));
                    string rootPrefix = AppRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    if (!filePath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(filePath))
                    {
                        WriteTextResponse(stream, 404, "Not Found", "Not found", requestParts[0] == "HEAD");
                        return;
                    }

                    byte[] content = File.ReadAllBytes(filePath);
                    WriteResponse(
                        stream,
                        200,
                        "OK",
                        GetMimeType(Path.GetExtension(filePath)),
                        content,
                        requestParts[0] == "HEAD");
                }
                catch (IOException)
                {
                    // The browser may close a speculative connection before reading the response.
                }
                catch (Exception error)
                {
                    try
                    {
                        WriteTextResponse(client.GetStream(), 500, "Internal Server Error", error.Message, false);
                    }
                    catch
                    {
                        // Ignore a secondary failure while closing the request.
                    }
                }
            }
        }

        private static bool TryResolveRequestPath(string rawTarget, out string relativePath)
        {
            relativePath = null;
            Uri uri;
            if (!Uri.TryCreate("http://127.0.0.1" + rawTarget, UriKind.Absolute, out uri)) return false;

            string decoded;
            try
            {
                decoded = Uri.UnescapeDataString(uri.AbsolutePath).Replace('\\', '/');
            }
            catch (UriFormatException)
            {
                return false;
            }

            decoded = decoded.TrimStart('/');
            if (decoded.Length == 0) decoded = "index.html";
            string[] segments = decoded.Split('/');
            foreach (string segment in segments)
            {
                if (segment == "..") return false;
            }
            relativePath = decoded;
            return true;
        }

        private static void WriteTextResponse(
            Stream stream,
            int status,
            string reason,
            string message,
            bool headOnly)
        {
            WriteResponse(
                stream,
                status,
                reason,
                "text/plain; charset=utf-8",
                Encoding.UTF8.GetBytes(message),
                headOnly);
        }

        private static void WriteResponse(
            Stream stream,
            int status,
            string reason,
            string contentType,
            byte[] content,
            bool headOnly)
        {
            string headers = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + content.Length + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(headers);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (!headOnly) stream.Write(content, 0, content.Length);
            stream.Flush();
        }

        private static string GetMimeType(string extension)
        {
            switch ((extension ?? "").ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml; charset=utf-8";
                case ".v":
                case ".sv":
                case ".txt":
                case ".log": return "text/plain; charset=utf-8";
                default: return "application/octet-stream";
            }
        }
    }
}
