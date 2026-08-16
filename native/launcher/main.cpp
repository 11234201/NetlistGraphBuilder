#include "embedded_assets.hpp"

#include <arpa/inet.h>
#include <cerrno>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <netinet/in.h>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/prctl.h>
#include <thread>
#include <unistd.h>

namespace {

const char* kStartupEndpoint = "/__ngb_startup__.json";
volatile std::sig_atomic_t g_stopRequested = 0;

struct InputFile {
    std::string name;
    std::string text;
};

struct StartOptions {
    int port = 0;
    bool openBrowser = true;
    bool replaceExisting = false;
    bool watchParent = false;
    std::string stateFile;
    std::string netlistPath;
    std::string timingPath;
    std::string cellConfigPath;
    std::string module;
    std::string focus;
    int faninDepth = -1;
    int fanoutDepth = -1;
};

struct StateRecord {
    int pid = 0;
    int port = 0;
    std::string url;
    std::string stateFile;
    std::string owner;
};

struct ServerContext {
    std::string startupJson;
};

void signalHandler(int) {
    g_stopRequested = 1;
}

void installSignalHandlers() {
    struct sigaction action;
    std::memset(&action, 0, sizeof(action));
    action.sa_handler = signalHandler;
    sigemptyset(&action.sa_mask);
    action.sa_flags = 0;
    sigaction(SIGINT, &action, 0);
    sigaction(SIGTERM, &action, 0);
    signal(SIGPIPE, SIG_IGN);
}

void enableParentDeathCleanup() {
    const pid_t parent = getppid();
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0) {
        std::cerr << "Warning: cannot enable parent-death cleanup: " << std::strerror(errno) << std::endl;
        return;
    }
    if (getppid() != parent) g_stopRequested = 1;
}

std::string jsonEscape(const std::string& value) {
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (std::size_t index = 0; index < value.size(); ++index) {
        const unsigned char character = static_cast<unsigned char>(value[index]);
        switch (character) {
            case '"': output << "\\\""; break;
            case '\\': output << "\\\\"; break;
            case '\b': output << "\\b"; break;
            case '\f': output << "\\f"; break;
            case '\n': output << "\\n"; break;
            case '\r': output << "\\r"; break;
            case '\t': output << "\\t"; break;
            default:
                if (character < 0x20) {
                    output << "\\u" << std::setw(4) << static_cast<int>(character);
                } else {
                    output << value[index];
                }
        }
    }
    return output.str();
}

std::string jsonUnescape(const std::string& value) {
    std::string result;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (value[index] != '\\' || index + 1 >= value.size()) {
            result += value[index];
            continue;
        }
        const char escaped = value[++index];
        switch (escaped) {
            case '"': result += '"'; break;
            case '\\': result += '\\'; break;
            case '/': result += '/'; break;
            case 'b': result += '\b'; break;
            case 'f': result += '\f'; break;
            case 'n': result += '\n'; break;
            case 'r': result += '\r'; break;
            case 't': result += '\t'; break;
            default: result += escaped; break;
        }
    }
    return result;
}

std::string basenameOf(const std::string& path) {
    const std::size_t slash = path.find_last_of("/\\");
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

bool readTextFile(const std::string& path, std::string* text, std::string* error) {
    std::ifstream stream(path.c_str(), std::ios::in | std::ios::binary);
    if (!stream) {
        if (error) *error = "Cannot read " + path + ": " + std::strerror(errno);
        return false;
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    if (!stream.good() && !stream.eof()) {
        if (error) *error = "Cannot read " + path;
        return false;
    }
    *text = buffer.str();
    return true;
}

std::string absolutePath(const std::string& path) {
    if (path.empty() || path[0] == '/') return path;
    char buffer[4096];
    if (!getcwd(buffer, sizeof(buffer))) return path;
    return std::string(buffer) + "/" + path;
}

bool parseInteger(const std::string& value, int minimum, int maximum, int* result) {
    char* end = 0;
    errno = 0;
    const long parsed = std::strtol(value.c_str(), &end, 10);
    if (errno != 0 || end == value.c_str() || *end != '\0' || parsed < minimum || parsed > maximum) {
        return false;
    }
    *result = static_cast<int>(parsed);
    return true;
}

bool readInput(const std::string& path, InputFile* result, std::string* error) {
    if (path.empty()) return false;
    if (!readTextFile(path, &result->text, error)) return false;
    result->name = basenameOf(path);
    return true;
}

std::string createStartupManifest(const StartOptions& options, bool* hasStartup, std::string* error) {
    InputFile netlist;
    InputFile timing;
    InputFile cellConfig;
    bool hasNetlist = false;
    bool hasTiming = false;
    bool hasCellConfig = false;
    if (!options.netlistPath.empty()) {
        if (!readInput(options.netlistPath, &netlist, error)) return std::string();
        hasNetlist = true;
    }
    if (!options.timingPath.empty()) {
        if (!readInput(options.timingPath, &timing, error)) return std::string();
        hasTiming = true;
    }
    if (!options.cellConfigPath.empty()) {
        if (!readInput(options.cellConfigPath, &cellConfig, error)) return std::string();
        hasCellConfig = true;
    }

    std::ostringstream output;
    output << "{\"version\":1,\"inputs\":{";
    bool first = true;
    if (hasCellConfig) {
        output << "\"cellConfig\":{\"name\":\"" << jsonEscape(cellConfig.name)
               << "\",\"text\":\"" << jsonEscape(cellConfig.text) << "\"}";
        first = false;
    }
    if (hasNetlist) {
        if (!first) output << ',';
        output << "\"netlist\":{\"name\":\"" << jsonEscape(netlist.name)
               << "\",\"text\":\"" << jsonEscape(netlist.text) << "\"}";
        first = false;
    }
    if (hasTiming) {
        if (!first) output << ',';
        output << "\"timing\":{\"name\":\"" << jsonEscape(timing.name)
               << "\",\"text\":\"" << jsonEscape(timing.text) << "\"}";
    }
    output << "},\"target\":{";
    first = true;
    if (!options.module.empty()) {
        output << "\"module\":\"" << jsonEscape(options.module) << "\"";
        first = false;
    }
    if (!options.focus.empty()) {
        if (!first) output << ',';
        output << "\"focus\":\"" << jsonEscape(options.focus) << "\"";
        first = false;
    }
    if (options.faninDepth >= 0) {
        if (!first) output << ',';
        output << "\"faninDepth\":" << options.faninDepth;
        first = false;
    }
    if (options.fanoutDepth >= 0) {
        if (!first) output << ',';
        output << "\"fanoutDepth\":" << options.fanoutDepth;
    }
    output << "}}";
    *hasStartup = hasNetlist || hasTiming || hasCellConfig || !options.module.empty() ||
        !options.focus.empty() || options.faninDepth >= 0 || options.fanoutDepth >= 0;
    return output.str();
}

std::string buildUrl(int port, bool hasStartup) {
    std::ostringstream output;
    output << "http://127.0.0.1:" << port << "/";
    if (hasStartup) output << "?startup=1";
    return output.str();
}

std::string makeOwnerToken() {
    std::ostringstream output;
    output << static_cast<long long>(getpid()) << '-'
           << static_cast<long long>(std::time(0)) << '-'
           << reinterpret_cast<std::uintptr_t>(&output);
    return output.str();
}

std::string stateJson(const StateRecord& state) {
    std::ostringstream output;
    output << "{\"version\":1"
           << ",\"pid\":" << state.pid
           << ",\"port\":" << state.port
           << ",\"url\":\"" << jsonEscape(state.url) << "\""
           << ",\"stateFile\":\"" << jsonEscape(state.stateFile) << "\""
           << ",\"owner\":\"" << jsonEscape(state.owner) << "\"}\n";
    return output.str();
}

bool writeStateFile(const StateRecord& state, std::string* error) {
    const std::string temporary = state.stateFile + ".tmp." + std::to_string(static_cast<long long>(getpid()));
    std::ofstream stream(temporary.c_str(), std::ios::out | std::ios::binary | std::ios::trunc);
    if (!stream) {
        if (error) *error = "Cannot write state file " + state.stateFile + ": " + std::strerror(errno);
        return false;
    }
    stream << stateJson(state);
    stream.close();
    if (!stream) {
        if (error) *error = "Cannot finish state file " + state.stateFile;
        unlink(temporary.c_str());
        return false;
    }
    if (rename(temporary.c_str(), state.stateFile.c_str()) != 0) {
        if (error) *error = "Cannot install state file " + state.stateFile + ": " + std::strerror(errno);
        unlink(temporary.c_str());
        return false;
    }
    return true;
}

bool extractJsonNumber(const std::string& json, const std::string& key, int* value) {
    const std::string marker = "\"" + key + "\":";
    const std::size_t position = json.find(marker);
    if (position == std::string::npos) return false;
    std::size_t begin = position + marker.size();
    std::size_t end = begin;
    while (end < json.size() && json[end] >= '0' && json[end] <= '9') ++end;
    return begin != end && parseInteger(json.substr(begin, end - begin), 0, 2147483647, value);
}

bool extractJsonString(const std::string& json, const std::string& key, std::string* value) {
    const std::string marker = "\"" + key + "\":\"";
    const std::size_t position = json.find(marker);
    if (position == std::string::npos) return false;
    std::size_t begin = position + marker.size();
    std::string encoded;
    bool escaped = false;
    for (std::size_t index = begin; index < json.size(); ++index) {
        const char character = json[index];
        if (!escaped && character == '"') {
            *value = jsonUnescape(encoded);
            return true;
        }
        if (!escaped && character == '\\') escaped = true;
        else escaped = false;
        encoded += character;
    }
    return false;
}

bool readStateFile(const std::string& path, StateRecord* state, std::string* error) {
    std::string content;
    if (!readTextFile(path, &content, error)) return false;
    if (!extractJsonNumber(content, "pid", &state->pid) ||
        !extractJsonNumber(content, "port", &state->port) ||
        !extractJsonString(content, "url", &state->url) ||
        !extractJsonString(content, "stateFile", &state->stateFile) ||
        !extractJsonString(content, "owner", &state->owner)) {
        if (error) *error = "Invalid Netlist Graph Builder state file: " + path;
        return false;
    }
    return true;
}

std::string readProcessCommandLine(int pid) {
    std::ostringstream path;
    path << "/proc/" << pid << "/cmdline";
    std::ifstream stream(path.str().c_str(), std::ios::in | std::ios::binary);
    if (!stream) return std::string();
    std::ostringstream content;
    content << stream.rdbuf();
    std::string commandLine = content.str();
    for (std::size_t index = 0; index < commandLine.size(); ++index) {
        if (commandLine[index] == '\0') commandLine[index] = ' ';
    }
    return commandLine;
}

bool processBelongsToState(const StateRecord& state) {
    const std::string commandLine = readProcessCommandLine(state.pid);
    if (commandLine.empty()) return false;
    const bool explicitStart = commandLine.find(" start") != std::string::npos;
    const bool legacyStart = commandLine.find("--netlist") != std::string::npos ||
        commandLine.find("--timing") != std::string::npos ||
        commandLine.find("--cell-config") != std::string::npos;
    return (explicitStart || legacyStart) &&
        commandLine.find("--state-file") != std::string::npos &&
        commandLine.find(basenameOf(state.stateFile)) != std::string::npos;
}

bool processExists(int pid) {
    if (pid <= 0) return false;
    if (kill(pid, 0) == 0) return true;
    return errno == EPERM;
}

bool waitForProcessExit(int pid, int timeoutMs) {
    const int intervalMs = 50;
    const int attempts = timeoutMs / intervalMs;
    for (int attempt = 0; attempt < attempts; ++attempt) {
        if (!processExists(pid)) return true;
        usleep(static_cast<useconds_t>(intervalMs * 1000));
    }
    return !processExists(pid);
}

int stopState(const std::string& statePath, bool force, bool quiet) {
    StateRecord state;
    std::string error;
    if (access(statePath.c_str(), F_OK) != 0 && errno == ENOENT) return 0;
    errno = 0;
    if (!readStateFile(statePath, &state, &error)) {
        if (errno == ENOENT) return 0;
        if (!quiet) std::cerr << error << std::endl;
        return 2;
    }
    if (!processExists(state.pid)) {
        unlink(statePath.c_str());
        return 0;
    }
    if (!processBelongsToState(state)) {
        if (!quiet) {
            std::cerr << "Refusing to stop PID " << state.pid
                      << ": process ownership could not be verified" << std::endl;
        }
        return 3;
    }
    if (kill(state.pid, SIGTERM) != 0 && errno != ESRCH) {
        if (!quiet) std::cerr << "Cannot stop PID " << state.pid << ": " << std::strerror(errno) << std::endl;
        return 4;
    }
    if (!waitForProcessExit(state.pid, 3000) && force) {
        kill(state.pid, SIGKILL);
        waitForProcessExit(state.pid, 1000);
    }
    if (processExists(state.pid)) {
        if (!quiet) std::cerr << "Process did not exit after SIGTERM" << std::endl;
        return 5;
    }
    unlink(statePath.c_str());
    return 0;
}

int createListener(int requestedPort, int* actualPort, std::string* error) {
    const int descriptor = socket(AF_INET, SOCK_STREAM, 0);
    if (descriptor < 0) {
        if (error) *error = "Cannot create socket: " + std::string(std::strerror(errno));
        return -1;
    }
    fcntl(descriptor, F_SETFD, FD_CLOEXEC);
    int reuse = 1;
    setsockopt(descriptor, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address;
    std::memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(static_cast<unsigned short>(requestedPort));
    if (bind(descriptor, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
        if (error) *error = "Cannot bind 127.0.0.1:" + std::to_string(requestedPort) + ": " + std::strerror(errno);
        close(descriptor);
        return -1;
    }
    if (listen(descriptor, 16) != 0) {
        if (error) *error = "Cannot listen: " + std::string(std::strerror(errno));
        close(descriptor);
        return -1;
    }

    socklen_t addressLength = sizeof(address);
    if (getsockname(descriptor, reinterpret_cast<sockaddr*>(&address), &addressLength) != 0) {
        if (error) *error = "Cannot determine bound port: " + std::string(std::strerror(errno));
        close(descriptor);
        return -1;
    }
    *actualPort = ntohs(address.sin_port);
    return descriptor;
}

int hexValue(char character) {
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
}

bool decodePath(const std::string& encoded, std::string* decoded, bool* forbidden) {
    *forbidden = false;
    std::string value;
    for (std::size_t index = 0; index < encoded.size(); ++index) {
        if (encoded[index] == '%') {
            if (index + 2 >= encoded.size()) return false;
            const int high = hexValue(encoded[index + 1]);
            const int low = hexValue(encoded[index + 2]);
            if (high < 0 || low < 0) return false;
            const char character = static_cast<char>((high << 4) | low);
            if (character == '\0') return false;
            value += character;
            index += 2;
        } else {
            value += encoded[index];
        }
    }
    if (value.find('\\') != std::string::npos) *forbidden = true;
    std::string segment;
    std::istringstream segments(value);
    while (std::getline(segments, segment, '/')) {
        if (segment == "..") *forbidden = true;
    }
    *decoded = value;
    return true;
}

std::string contentType(const std::string& route) {
    const std::size_t dot = route.find_last_of('.');
    const std::string extension = dot == std::string::npos ? std::string() : route.substr(dot);
    if (extension == ".html") return "text/html; charset=utf-8";
    if (extension == ".css") return "text/css; charset=utf-8";
    if (extension == ".js") return "text/javascript; charset=utf-8";
    if (extension == ".json") return "application/json; charset=utf-8";
    if (extension == ".svg") return "image/svg+xml; charset=utf-8";
    if (extension == ".v" || extension == ".sv") return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

bool sendAll(int descriptor, const char* data, std::size_t size) {
    std::size_t offset = 0;
    while (offset < size) {
        const ssize_t written = send(descriptor, data + offset, size - offset, 0);
        if (written < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        if (written == 0) return false;
        offset += static_cast<std::size_t>(written);
    }
    return true;
}

void sendResponse(int descriptor, int status, const std::string& type,
                  const std::string& body, bool headOnly, bool noStore) {
    const char* phrase = status == 200 ? "OK" : status == 403 ? "Forbidden" :
        status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Bad Request";
    std::ostringstream headers;
    headers << "HTTP/1.1 " << status << ' ' << phrase << "\r\n"
            << "Content-Type: " << type << "\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Cache-Control: " << (noStore ? "no-store" : "no-cache") << "\r\n"
            << "Connection: close\r\n\r\n";
    const std::string headerText = headers.str();
    sendAll(descriptor, headerText.c_str(), headerText.size());
    if (!headOnly && !body.empty()) sendAll(descriptor, body.data(), body.size());
}

void handleClient(int descriptor, const std::shared_ptr<ServerContext>& context) {
    char buffer[16384];
    const ssize_t received = recv(descriptor, buffer, sizeof(buffer) - 1, 0);
    if (received <= 0) {
        close(descriptor);
        return;
    }
    buffer[received] = '\0';
    std::istringstream request(std::string(buffer, static_cast<std::size_t>(received)));
    std::string method;
    std::string target;
    std::string version;
    request >> method >> target >> version;
    const bool headOnly = method == "HEAD";
    if ((method != "GET" && method != "HEAD") || version.find("HTTP/") != 0) {
        sendResponse(descriptor, method == "GET" || method == "HEAD" ? 400 : 405,
                     "text/plain; charset=utf-8", "Bad request\n", headOnly, true);
        close(descriptor);
        return;
    }

    const std::size_t query = target.find('?');
    const std::string encodedPath = target.substr(0, query);
    std::string path;
    bool forbidden = false;
    if (!decodePath(encodedPath, &path, &forbidden)) {
        sendResponse(descriptor, 400, "text/plain; charset=utf-8", "Bad request\n", headOnly, true);
        close(descriptor);
        return;
    }
    if (forbidden) {
        sendResponse(descriptor, 403, "text/plain; charset=utf-8", "Forbidden\n", headOnly, true);
        close(descriptor);
        return;
    }
    if (path == kStartupEndpoint) {
        sendResponse(descriptor, 200, "application/json; charset=utf-8", context->startupJson,
                     headOnly, true);
        close(descriptor);
        return;
    }
    if (path.empty() || path == "/") path = "/index.html";
    while (!path.empty() && path[0] == '/') path.erase(path.begin());
    const ngb::EmbeddedAsset* asset = ngb::findEmbeddedAsset(path);
    if (!asset) {
        sendResponse(descriptor, 404, "text/plain; charset=utf-8", "Not found\n", headOnly, true);
        close(descriptor);
        return;
    }
    std::string body(reinterpret_cast<const char*>(asset->data), asset->size);
    sendResponse(descriptor, 200, contentType(path), body, headOnly, false);
    close(descriptor);
}

void openBrowser(const std::string& url) {
    const pid_t child = fork();
    if (child == 0) {
        execlp("xdg-open", "xdg-open", url.c_str(), static_cast<char*>(0));
        _exit(127);
    }
    if (child < 0) std::cerr << "Could not open browser: " << std::strerror(errno) << std::endl;
}

void printUsage(const char* command) {
    std::cout
        << "Usage: " << command << " <start|stop|status> [options]\n\n"
        << "Start options:\n"
        << "  --netlist <path>       structural Verilog to load\n"
        << "  --timing <path>        timing text to load\n"
        << "  --cell-config <path>   versioned Cell Config JSON\n"
        << "  --module <name>        initial module\n"
        << "  --focus <instance>     initial focused cell\n"
        << "  --fanin-depth <0-99>   focused fanin depth\n"
        << "  --fanout-depth <0-99>  focused fanout depth\n"
        << "  --port <0-65535>       localhost port; 0 selects an idle port\n"
        << "  --state-file <path>    managed session state file\n"
        << "  --replace              stop the verified session in state-file first\n"
        << "  --parent-death         stop when the launching EDA process exits\n"
        << "  --no-open              do not open a browser\n"
        << "  --open                 open the default Linux browser\n\n"
        << "Stop/status options:\n"
        << "  --state-file <path>    session state file to stop or inspect\n"
        << "  --force                use SIGKILL after a bounded SIGTERM wait\n\n"
        << "For development, options without a subcommand are treated as 'start'.\n";
}

int printLicenses() {
    const ngb::EmbeddedAsset* license = ngb::findEmbeddedAsset("vendor/elkjs-0.11.1/LICENSE.md");
    std::cout << "Netlist Graph Builder native launcher\n"
              << "Embedded dependency: ELK.js 0.11.1 (EPL-2.0)\n\n";
    if (!license) {
        std::cerr << "Embedded ELK.js license is missing" << std::endl;
        return 1;
    }
    std::cout.write(reinterpret_cast<const char*>(license->data), license->size);
    return 0;
}

bool requireValue(int argc, char** argv, int* index, std::string* value, std::string* error) {
    if (*index + 1 >= argc) {
        *error = std::string(argv[*index]) + " requires a value";
        return false;
    }
    *value = argv[++(*index)];
    if (value->empty() || value->at(0) == '-') {
        *error = std::string(argv[*index - 1]) + " requires a value";
        return false;
    }
    return true;
}

bool parseStartOptions(int argc, char** argv, int first, StartOptions* options, std::string* error) {
    for (int index = first; index < argc; ++index) {
        const std::string argument = argv[index];
        std::string value;
        if (argument == "--help" || argument == "-h") {
            printUsage(argv[0]);
            std::exit(0);
        } else if (argument == "--no-open" || argument == "--no-browser") {
            options->openBrowser = false;
        } else if (argument == "--open") {
            options->openBrowser = true;
        } else if (argument == "--replace") {
            options->replaceExisting = true;
        } else if (argument == "--parent-death") {
            options->watchParent = true;
        } else if (argument == "--port") {
            if (!requireValue(argc, argv, &index, &value, error) ||
                !parseInteger(value, 0, 65535, &options->port)) {
                *error = "--port must be an integer from 0 to 65535";
                return false;
            }
        } else if (argument == "--state-file") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->stateFile = absolutePath(value);
        } else if (argument == "--netlist") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->netlistPath = absolutePath(value);
        } else if (argument == "--timing") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->timingPath = absolutePath(value);
        } else if (argument == "--cell-config") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->cellConfigPath = absolutePath(value);
        } else if (argument == "--module") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->module = value;
        } else if (argument == "--focus") {
            if (!requireValue(argc, argv, &index, &value, error)) return false;
            options->focus = value;
        } else if (argument == "--fanin-depth") {
            if (!requireValue(argc, argv, &index, &value, error) ||
                !parseInteger(value, 0, 99, &options->faninDepth)) {
                *error = "--fanin-depth must be an integer from 0 to 99";
                return false;
            }
        } else if (argument == "--fanout-depth") {
            if (!requireValue(argc, argv, &index, &value, error) ||
                !parseInteger(value, 0, 99, &options->fanoutDepth)) {
                *error = "--fanout-depth must be an integer from 0 to 99";
                return false;
            }
        } else {
            *error = "Unknown option: " + argument;
            return false;
        }
    }
    if (options->replaceExisting && options->stateFile.empty()) {
        *error = "--replace requires --state-file";
        return false;
    }
    return true;
}

int runStart(const StartOptions& options) {
    if (!options.stateFile.empty() && access(options.stateFile.c_str(), F_OK) == 0 && !options.replaceExisting) {
        StateRecord existing;
        std::string stateError;
        if (!readStateFile(options.stateFile, &existing, &stateError)) {
            std::cerr << "State file already exists and is invalid; remove it or use a new path: "
                      << options.stateFile << std::endl;
            return 2;
        }
        if (processExists(existing.pid) && processBelongsToState(existing)) {
            std::cerr << "A Netlist Graph Builder session is already running for state file: "
                      << options.stateFile << std::endl;
            return 3;
        }
        unlink(options.stateFile.c_str());
    }
    if (options.replaceExisting) {
        const int result = stopState(options.stateFile, false, true);
        if (result != 0) {
            std::cerr << "Cannot replace existing Netlist Graph Builder session" << std::endl;
            return result;
        }
    }

    bool hasStartup = false;
    std::string error;
    const std::string startupJson = createStartupManifest(options, &hasStartup, &error);
    if (!error.empty()) {
        std::cerr << error << std::endl;
        return 2;
    }

    int actualPort = 0;
    const int listener = createListener(options.port, &actualPort, &error);
    if (listener < 0) {
        std::cerr << error << std::endl;
        return 1;
    }

    StateRecord state;
    state.pid = static_cast<int>(getpid());
    state.port = actualPort;
    state.url = buildUrl(actualPort, hasStartup);
    state.stateFile = options.stateFile;
    state.owner = makeOwnerToken();
    if (!state.stateFile.empty() && !writeStateFile(state, &error)) {
        close(listener);
        std::cerr << error << std::endl;
        return 1;
    }

    installSignalHandlers();
    if (options.watchParent) enableParentDeathCleanup();
    std::cout << "Starting Netlist Graph Builder preview server..." << std::endl;
    std::cout << "{\"event\":\"ready\",\"host\":\"127.0.0.1\",\"port\":"
              << actualPort << ",\"url\":\"" << jsonEscape(state.url)
              << "\",\"startup\":{"
              << "\"netlist\":" << (options.netlistPath.empty() ? "null" : "\"" + jsonEscape(basenameOf(options.netlistPath)) + "\"")
              << ",\"timing\":" << (options.timingPath.empty() ? "null" : "\"" + jsonEscape(basenameOf(options.timingPath)) + "\"")
              << ",\"cellConfig\":" << (options.cellConfigPath.empty() ? "null" : "\"" + jsonEscape(basenameOf(options.cellConfigPath)) + "\"")
              << ",\"module\":" << (options.module.empty() ? "null" : "\"" + jsonEscape(options.module) + "\"")
              << ",\"focus\":" << (options.focus.empty() ? "null" : "\"" + jsonEscape(options.focus) + "\"")
              << ",\"faninDepth\":" << (options.faninDepth < 0 ? "null" : std::to_string(options.faninDepth))
              << ",\"fanoutDepth\":" << (options.fanoutDepth < 0 ? "null" : std::to_string(options.fanoutDepth))
              << "}}" << std::endl;
    if (!state.stateFile.empty()) std::cout << "State file: " << state.stateFile << std::endl;

    if (options.openBrowser) openBrowser(state.url);
    const std::shared_ptr<ServerContext> context(new ServerContext);
    context->startupJson = startupJson;
    while (!g_stopRequested) {
        sockaddr_in clientAddress;
        socklen_t clientLength = sizeof(clientAddress);
        const int client = accept(listener, reinterpret_cast<sockaddr*>(&clientAddress), &clientLength);
        if (client < 0) {
            if (errno == EINTR) continue;
            if (g_stopRequested) break;
            std::cerr << "Accept failed: " << std::strerror(errno) << std::endl;
            close(listener);
            if (!state.stateFile.empty()) unlink(state.stateFile.c_str());
            return 1;
        }
        std::thread(handleClient, client, context).detach();
    }
    close(listener);
    if (!state.stateFile.empty()) {
        StateRecord current;
        if (readStateFile(state.stateFile, &current, 0) && current.pid == state.pid && current.owner == state.owner) {
            unlink(state.stateFile.c_str());
        }
    }
    return 0;
}

int runStatus(const std::string& statePath) {
    StateRecord state;
    std::string error;
    if (!readStateFile(statePath, &state, &error)) {
        std::cerr << error << std::endl;
        return 2;
    }
    std::cout << stateJson(state);
    std::cout << (processExists(state.pid) && processBelongsToState(state) ? "status=running\n" : "status=stale\n");
    return 0;
}

int runCommand(int argc, char** argv) {
    if (argc < 2) {
        printUsage(argv[0]);
        return 2;
    }
    std::string command = argv[1];
    if (command == "--help" || command == "-h") {
        printUsage(argv[0]);
        return 0;
    }
    if (command == "--licenses") return printLicenses();
    if (command != "start" && command != "stop" && command != "status") {
        command = "start";
    }

    if (command == "start") {
        const int first = (std::string(argv[1]) == "start") ? 2 : 1;
        StartOptions options;
        std::string error;
        if (!parseStartOptions(argc, argv, first, &options, &error)) {
            std::cerr << error << std::endl;
            return 2;
        }
        return runStart(options);
    }

    std::string stateFile;
    bool force = false;
    for (int index = 2; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--state-file") {
            if (index + 1 >= argc) {
                std::cerr << "--state-file requires a value" << std::endl;
                return 2;
            }
            stateFile = absolutePath(argv[++index]);
        } else if (argument == "--force") {
            force = true;
        } else if (argument == "--help" || argument == "-h") {
            printUsage(argv[0]);
            return 0;
        } else {
            std::cerr << "Unknown option: " << argument << std::endl;
            return 2;
        }
    }
    if (stateFile.empty()) {
        std::cerr << "--state-file is required for " << command << std::endl;
        return 2;
    }
    if (command == "status") return runStatus(stateFile);
    return stopState(stateFile, force, false);
}

}  // namespace

int main(int argc, char** argv) {
    return runCommand(argc, argv);
}
