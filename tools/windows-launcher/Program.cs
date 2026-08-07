using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace NetlistGraphBuilderLauncher
{
    internal static class Program
    {
        private static readonly string AppRoot = Path.GetFullPath(
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
        private static volatile bool running = true;
        private static TcpListener listener;
        private static string startupManifestJson = "{\"version\":1,\"inputs\":{},\"target\":{}}";

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
            string netlistPath = null;
            string timingPath = null;
            string cellConfigPath = null;
            string moduleName = null;
            string focusName = null;
            int? faninDepth = null;
            int? fanoutDepth = null;
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if (argument == "--no-browser" || argument == "--no-open")
                {
                    openBrowser = false;
                }
                else if (argument == "--help" || argument == "-h")
                {
                    PrintHelp();
                    return 0;
                }
                else if (argument == "--port")
                {
                    if (!RequireValue(args, ref index, argument)) return 2;
                    int parsedPort;
                    if (!int.TryParse(args[index], out parsedPort) || parsedPort < 1 || parsedPort > 65535)
                    {
                        Console.Error.WriteLine("Invalid --port value.");
                        return 2;
                    }
                    port = parsedPort;
                    explicitPort = true;
                }
                else if (argument == "--fanin-depth" || argument == "--fanout-depth")
                {
                    if (!RequireValue(args, ref index, argument)) return 2;
                    int depth;
                    if (!int.TryParse(args[index], out depth) || depth < 0 || depth > 99)
                    {
                        Console.Error.WriteLine("Invalid " + argument + " value; expected 0 to 99.");
                        return 2;
                    }
                    if (argument == "--fanin-depth") faninDepth = depth; else fanoutDepth = depth;
                }
                else if (argument == "--netlist" || argument == "--timing" || argument == "--cell-config" ||
                         argument == "--module" || argument == "--focus")
                {
                    if (!RequireValue(args, ref index, argument)) return 2;
                    string value = args[index];
                    if (argument == "--netlist") netlistPath = value;
                    else if (argument == "--timing") timingPath = value;
                    else if (argument == "--cell-config") cellConfigPath = value;
                    else if (argument == "--module") moduleName = value;
                    else focusName = value;
                }
                else
                {
                    Console.Error.WriteLine("Unknown option: " + argument);
                    return 2;
                }
            }

            Dictionary<string, object> manifest;
            try
            {
                manifest = CreateStartupManifest(netlistPath, timingPath, cellConfigPath, moduleName, focusName, faninDepth, fanoutDepth);
                startupManifestJson = new JavaScriptSerializer().Serialize(manifest);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 2;
            }

            listener = StartListener(port, explicitPort, out port);
            if (listener == null) return 1;

            bool hasStartup = ((Dictionary<string, object>)manifest["inputs"]).Count > 0 ||
                ((Dictionary<string, object>)manifest["target"]).Count > 0;
            string url = "http://127.0.0.1:" + port + "/" + (hasStartup ? "?startup=1" : "");
            Console.Title = "Netlist Graph Builder";
            Console.WriteLine(CreateReadyJson(port, url, manifest));
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

        private static bool RequireValue(string[] args, ref int index, string argument)
        {
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                Console.Error.WriteLine(argument + " requires a value.");
                return false;
            }
            index++;
            return true;
        }

        private static void PrintHelp()
        {
            Console.WriteLine("Usage: NetlistGraphBuilder.exe [options]");
            Console.WriteLine("  --netlist <path>       structural Verilog to load");
            Console.WriteLine("  --timing <path>        Global/Local or LocResyn timing text");
            Console.WriteLine("  --cell-config <path>   versioned Cell Config JSON");
            Console.WriteLine("  --module <name>        module selected after loading");
            Console.WriteLine("  --focus <instance>     cell instance to focus");
            Console.WriteLine("  --fanin-depth <0-99>   focused fanin depth");
            Console.WriteLine("  --fanout-depth <0-99>  focused fanout depth");
            Console.WriteLine("  --port <1-65535>       localhost port");
            Console.WriteLine("  --no-open              do not open the default browser");
        }

        private static Dictionary<string, object> CreateStartupManifest(
            string netlistPath,
            string timingPath,
            string cellConfigPath,
            string moduleName,
            string focusName,
            int? faninDepth,
            int? fanoutDepth)
        {
            Dictionary<string, object> inputs = new Dictionary<string, object>();
            if (cellConfigPath != null)
            {
                Dictionary<string, object> input = ReadStartupInput(cellConfigPath, "--cell-config");
                ValidateCellConfig((string)input["text"]);
                inputs["cellConfig"] = input;
            }
            if (netlistPath != null) inputs["netlist"] = ReadStartupInput(netlistPath, "--netlist");
            if (timingPath != null) inputs["timing"] = ReadStartupInput(timingPath, "--timing");

            Dictionary<string, object> target = new Dictionary<string, object>();
            if (moduleName != null) target["module"] = moduleName;
            if (focusName != null) target["focus"] = focusName;
            if (faninDepth.HasValue) target["faninDepth"] = faninDepth.Value;
            if (fanoutDepth.HasValue) target["fanoutDepth"] = fanoutDepth.Value;
            return new Dictionary<string, object> {
                { "version", 1 }, { "inputs", inputs }, { "target", target }
            };
        }

        private static Dictionary<string, object> ReadStartupInput(string path, string option)
        {
            string absolute = Path.GetFullPath(path);
            try
            {
                return new Dictionary<string, object> {
                    { "name", Path.GetFileName(absolute) }, { "text", File.ReadAllText(absolute, Encoding.UTF8) }
                };
            }
            catch (Exception error)
            {
                throw new ArgumentException("Cannot read " + option + " file " + absolute + ": " + error.Message);
            }
        }

        private static void ValidateCellConfig(string text)
        {
            Dictionary<string, object> value;
            try
            {
                value = new JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>;
            }
            catch (Exception error)
            {
                throw new ArgumentException("Invalid --cell-config JSON: " + error.Message);
            }
            object kind;
            object version;
            object cellsValue;
            if (value == null || !value.TryGetValue("kind", out kind) || Convert.ToString(kind) != "netlist-cell-config" ||
                !value.TryGetValue("version", out version) || Convert.ToInt32(version) != 1 ||
                !value.TryGetValue("cells", out cellsValue) || !(cellsValue is Dictionary<string, object>))
            {
                throw new ArgumentException("Invalid --cell-config schema: expected netlist-cell-config version 1.");
            }
            foreach (string key in value.Keys)
                if (key != "kind" && key != "version" && key != "cells")
                    throw new ArgumentException("Invalid --cell-config schema field: " + key + ".");
            HashSet<string> gateKinds = new HashSet<string>(new[] {
                "AND", "OR", "MUX", "INV", "NAND", "NOR", "XOR", "XNOR", "BUF", "REGISTER", "BLACKBOX"
            });
            HashSet<string> directions = new HashSet<string>(new[] { "input", "output", "inout", "unknown" });
            foreach (KeyValuePair<string, object> cell in (Dictionary<string, object>)cellsValue)
            {
                Dictionary<string, object> definition = cell.Value as Dictionary<string, object>;
                object gateValue;
                object pinsValue;
                if (definition == null || !definition.TryGetValue("gateKind", out gateValue) ||
                    !gateKinds.Contains(Convert.ToString(gateValue).ToUpperInvariant()) ||
                    !definition.TryGetValue("pins", out pinsValue) || !(pinsValue is Dictionary<string, object>))
                {
                    throw new ArgumentException("Invalid --cell-config definition for " + cell.Key + ".");
                }
                foreach (string key in definition.Keys)
                    if (key != "displayName" && key != "gateKind" && key != "pins")
                        throw new ArgumentException("Invalid --cell-config field for " + cell.Key + ": " + key + ".");
                foreach (object direction in ((Dictionary<string, object>)pinsValue).Values)
                {
                    if (!directions.Contains(Convert.ToString(direction)))
                        throw new ArgumentException("Invalid --cell-config pin direction for " + cell.Key + ".");
                }
            }
        }

        private static string CreateReadyJson(int port, string url, Dictionary<string, object> manifest)
        {
            Dictionary<string, object> inputs = (Dictionary<string, object>)manifest["inputs"];
            Dictionary<string, object> target = (Dictionary<string, object>)manifest["target"];
            Dictionary<string, object> startup = new Dictionary<string, object>();
            foreach (string kind in new[] { "netlist", "timing", "cellConfig" })
            {
                startup[kind] = inputs.ContainsKey(kind)
                    ? ((Dictionary<string, object>)inputs[kind])["name"] : null;
            }
            foreach (string key in new[] { "module", "focus", "faninDepth", "fanoutDepth" })
                startup[key] = target.ContainsKey(key) ? target[key] : null;
            return new JavaScriptSerializer().Serialize(new Dictionary<string, object> {
                { "event", "ready" }, { "host", "127.0.0.1" }, { "port", port }, { "url", url }, { "startup", startup }
            });
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

                    if (relativePath == "__ngb_startup__.json")
                    {
                        WriteResponse(stream, 200, "OK", "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes(startupManifestJson), requestParts[0] == "HEAD");
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
