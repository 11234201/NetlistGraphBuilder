#include "embedded_assets.hpp"
#include "ProcessGuard.h"

#include <arpa/inet.h>
#include <atomic>
#include <poll.h>
#include <cerrno>
#include <chrono>
#include <cctype>
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
    std::string m_processStartTicks;
};

struct ServerContext {
    std::string startupJson;
    std::atomic<int> m_activeClients{0};
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
    signal(SIGCHLD, SIG_IGN);
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

bool ReadUnicodeEscape(const std::string& value, std::size_t begin, unsigned int* code) {
    if (begin + 4 > value.size()) return false;
    *code = 0;
    for (std::size_t index = begin; index < begin + 4; ++index) {
        const char digit = value[index];
        int number = digit >= '0' && digit <= '9' ? digit - '0' :
            digit >= 'a' && digit <= 'f' ? digit - 'a' + 10 :
            digit >= 'A' && digit <= 'F' ? digit - 'A' + 10 : -1;
        if (number < 0) return false;
        *code = (*code << 4) | static_cast<unsigned int>(number);
    }
    return true;
}

bool DecodeJsonString(const std::string& value, std::string* decoded) {
    std::string result;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (value[index] != '\\') {
            if (static_cast<unsigned char>(value[index]) < 0x20) return false;
            result += value[index];
            continue;
        }
        if (index + 1 >= value.size()) return false;
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
            case 'u': {
                unsigned int code = 0;
                if (!ReadUnicodeEscape(value, index + 1, &code)) return false;
                index += 4;
                if (code >= 0xd800 && code <= 0xdbff) {
                    unsigned int low = 0;
                    if (value.substr(index + 1, 2) != "\\u" ||
                        !ReadUnicodeEscape(value, index + 3, &low) || low < 0xdc00 || low > 0xdfff) return false;
                    code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
                    index += 6;
                } else if (code >= 0xdc00 && code <= 0xdfff) return false;
                if (code == 0) return false;
                if (code < 0x80) result += static_cast<char>(code);
                else {
                    if (code >= 0x10000) result += static_cast<char>(0xf0 | (code >> 18));
                    if (code >= 0x800) result += static_cast<char>((code < 0x10000 ? 0xe0 : 0x80) | ((code >> 12) & 0x3f));
                    result += static_cast<char>((code < 0x800 ? 0xc0 : 0x80) | ((code >> 6) & 0x3f));
                    result += static_cast<char>(0x80 | (code & 0x3f));
                }
                break;
            }
            default: return false;
        }
    }
    *decoded = result;
    return true;
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
    if (path.empty()) return path;
    char buffer[4096];
    if (realpath(path.c_str(), buffer)) return buffer;
    const std::size_t slash = path.find_last_of('/');
    const std::string parent = slash == std::string::npos ? "." : path.substr(0, slash + 1);
    if (realpath(parent.c_str(), buffer)) return std::string(buffer) + "/" + basenameOf(path);
    if (path[0] == '/') return path;
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
           << ",\"owner\":\"" << jsonEscape(state.owner) << "\""
           << ",\"processStartTicks\":\"" << jsonEscape(state.m_processStartTicks) << "\"}\n";
    return output.str();
}

bool writeStateFile(const StateRecord& state, std::string* error) {
    const std::string temporary = state.stateFile + ".tmp." + std::to_string(static_cast<long long>(getpid()));
    const int descriptor = open(temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (descriptor < 0) {
        if (error) *error = "Cannot write state file " + state.stateFile + ": " + std::strerror(errno);
        return false;
    }
    const std::string contents = stateJson(state);
    std::size_t offset = 0;
    while (offset < contents.size()) {
        const ssize_t count = write(descriptor, contents.data() + offset, contents.size() - offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break;
        offset += static_cast<std::size_t>(count);
    }
    const bool complete = offset == contents.size();
    const int closed = close(descriptor);
    if (!complete || closed != 0) {
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

std::size_t FindJsonValue(const std::string& json, const std::string& key) {
    const std::string marker = "\"" + key + "\"";
    const std::size_t position = json.find(marker);
    if (position == std::string::npos) return position;
    std::size_t begin = position + marker.size();
    while (begin < json.size() && std::isspace(static_cast<unsigned char>(json[begin]))) ++begin;
    if (begin >= json.size() || json[begin++] != ':') return std::string::npos;
    while (begin < json.size() && std::isspace(static_cast<unsigned char>(json[begin]))) ++begin;
    return begin;
}

bool extractJsonNumber(const std::string& json, const std::string& key, int* value) {
    const std::size_t begin = FindJsonValue(json, key);
    if (begin == std::string::npos) return false;
    std::size_t end = begin;
    while (end < json.size() && json[end] >= '0' && json[end] <= '9') ++end;
    if (end < json.size() && json[end] != ',' && json[end] != '}' &&
        !std::isspace(static_cast<unsigned char>(json[end]))) return false;
    return begin != end && parseInteger(json.substr(begin, end - begin), 0, 2147483647, value);
}

bool extractJsonString(const std::string& json, const std::string& key, std::string* value) {
    std::size_t begin = FindJsonValue(json, key);
    if (begin == std::string::npos || begin >= json.size() || json[begin++] != '"') return false;
    std::string encoded;
    bool escaped = false;
    for (std::size_t index = begin; index < json.size(); ++index) {
        const char character = json[index];
        if (!escaped && character == '"') {
            return DecodeJsonString(encoded, value);
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
    int version = 0;
    if (!extractJsonNumber(content, "version", &version) || version != 1 ||
        !extractJsonNumber(content, "pid", &state->pid) || state->pid <= 1 ||
        !extractJsonNumber(content, "port", &state->port) ||
        state->port < 1 || state->port > 65535 ||
        !extractJsonString(content, "url", &state->url) ||
        !extractJsonString(content, "stateFile", &state->stateFile) ||
        !extractJsonString(content, "owner", &state->owner) || state->owner.empty() ||
        absolutePath(state->stateFile) != absolutePath(path)) {
        if (error) *error = "Invalid Netlist Graph Builder state file: " + path;
        return false;
    }
    if (FindJsonValue(content, "processStartTicks") != std::string::npos &&
        (!extractJsonString(content, "processStartTicks", &state->m_processStartTicks) ||
         state->m_processStartTicks.empty() || state->m_processStartTicks.find_first_not_of("0123456789") != std::string::npos)) {
        if (error) *error = "Invalid processStartTicks in state file: " + path;
        return false;
    }
    return true;
}

bool processBelongsToState(const StateRecord& state) {
    const std::string startTicks = ngb::ReadProcessStartTicks(state.pid);
    return !startTicks.empty() && ngb::IsSameExecutable(state.pid) &&
        ngb::HasExactStateArgument(state.pid, absolutePath(state.stateFile)) &&
        (state.m_processStartTicks.empty() || state.m_processStartTicks == startTicks);
}

bool processExists(int pid) {
    if (pid <= 0) return false;
    if (ngb::ReadProcessStartTicks(pid).empty()) return false;
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
        if (!processBelongsToState(state)) return 3;
        kill(state.pid, SIGKILL);
        waitForProcessExit(state.pid, 1000);
    }
    if (processExists(state.pid)) {
        if (!quiet) std::cerr << "Process did not exit after SIGTERM" << std::endl;
        return 5;
    }
    StateRecord current;
    if (readStateFile(statePath, &current, 0) && current.owner == state.owner && current.pid == state.pid) {
        unlink(statePath.c_str());
    }
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
    timeval timeout = {2, 0};
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    std::string header;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (header.size() < sizeof(buffer) && header.find("\r\n\r\n") == std::string::npos) {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
        if (remaining <= 0) break;
        pollfd ready = {descriptor, POLLIN, 0};
        if (poll(&ready, 1, static_cast<int>(remaining)) <= 0) break;
        const ssize_t count = recv(descriptor, buffer, sizeof(buffer) - header.size(), 0);
        if (count <= 0) break;
        header.append(buffer, static_cast<std::size_t>(count));
    }
    if (header.find("\r\n\r\n") == std::string::npos) {
        sendResponse(descriptor, 400, "text/plain; charset=utf-8", "Incomplete request\n", false, true);
        close(descriptor);
        return;
    }
    std::istringstream request(header);
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
    bool hasStartup = false;
    std::string error;
    const std::string startupJson = createStartupManifest(options, &hasStartup, &error);
    if (!error.empty()) {
        std::cerr << error << std::endl;
        return 2;
    }
    if (options.replaceExisting && stopState(options.stateFile, false, false) != 0) return 3;
    ngb::StateFileLock stateLock;
    if (!stateLock.Acquire(options.stateFile, &error)) {
        std::cerr << error << std::endl;
        return 3;
    }
    if (!options.stateFile.empty() && access(options.stateFile.c_str(), F_OK) == 0 && !options.replaceExisting) {
        StateRecord existing;
        std::string stateError;
        if (!readStateFile(options.stateFile, &existing, &stateError)) {
            std::cerr << "State file already exists and is invalid; remove it or use a new path: "
                      << options.stateFile << std::endl;
            return 2;
        }
        if (processExists(existing.pid)) {
            std::cerr << "A Netlist Graph Builder session is already running for state file: "
                      << options.stateFile << std::endl;
            return 3;
        }
        unlink(options.stateFile.c_str());
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
    state.m_processStartTicks = ngb::ReadProcessStartTicks(state.pid);
    if (!state.stateFile.empty() && !writeStateFile(state, &error)) {
        close(listener);
        std::cerr << error << std::endl;
        return 1;
    }

    installSignalHandlers();
    if (options.watchParent) enableParentDeathCleanup();
    std::cerr << "Starting Netlist Graph Builder preview server..." << std::endl;
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
    if (!state.stateFile.empty()) std::cerr << "State file: " << state.stateFile << std::endl;

    if (options.openBrowser) openBrowser(state.url);
    const std::shared_ptr<ServerContext> context(new ServerContext);
    context->startupJson = startupJson;
    while (!g_stopRequested) {
        pollfd ready = {listener, POLLIN, 0};
        const int readyCount = poll(&ready, 1, 250);
        if (readyCount <= 0) {
            if (readyCount < 0 && errno != EINTR) break;
            continue;
        }
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
        if (context->m_activeClients.fetch_add(1) >= 32) {
            context->m_activeClients.fetch_sub(1);
            close(client);
            continue;
        }
        try {
            std::thread([client, context]() {
                handleClient(client, context);
                context->m_activeClients.fetch_sub(1);
            }).detach();
        } catch (...) {
            context->m_activeClients.fetch_sub(1);
            close(client);
        }
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
