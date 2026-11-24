#pragma once
#include "WorkbenchBroker.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <thread>
#include <sstream>
#include <iostream>
#include <functional>
#include "WorkbenchLineEditor.h"

namespace ngb {
class WorkbenchEndpoint {
    std::string directory_, socket_;
    int fd_ = -1;

  public:
    WorkbenchEndpoint() {
        char path[] = "/tmp/ngb-session-XXXXXX";
        if (!mkdtemp(path))
            throw WorkbenchError("CONTROL_FAILED", "Cannot create private session directory");
        directory_ = path;
        socket_ = directory_ + "/control";
        sockaddr_un addr{};
        addr.sun_family = AF_UNIX;
        std::strcpy(addr.sun_path, socket_.c_str());
        fd_ = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
        if (fd_ < 0 || bind(fd_, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) || listen(fd_, 16)) {
            Cleanup();
            throw WorkbenchError("CONTROL_FAILED", "Cannot create private control socket");
        }
    }
    ~WorkbenchEndpoint() {
        Cleanup();
    }
    void Cleanup() {
        if (fd_ >= 0) {
            close(fd_);
            fd_ = -1;
        }
        unlink(socket_.c_str());
        unlink((directory_ + "/state.json").c_str());
        rmdir(directory_.c_str());
    }
    int Descriptor() const {
        return fd_;
    }
    const std::string &Path() const {
        return socket_;
    }
    const std::string &Directory() const {
        return directory_;
    }
};
inline Json ReadWorkbenchRequest(int fd, const std::string &request, bool admin) {
    auto end = request.find("\r\n\r\n");
    std::istringstream header(request.substr(0, end));
    std::string line;
    std::getline(header, line);
    std::map<std::string, std::string> fields;
    while (std::getline(header, line)) {
        auto colon = line.find(':');
        if (colon == std::string::npos)
            continue;
        auto key = line.substr(0, colon);
        std::transform(key.begin(), key.end(), key.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        auto value = line.substr(colon + 1);
        while (!value.empty() && (value[0] == ' ' || value[0] == '\t'))
            value.erase(0, 1);
        if (!value.empty() && value.back() == '\r')
            value.pop_back();
        fields[key] = value;
    }
    if (!admin && (fields["origin"] != "http://" + fields["host"] ||
                   fields["content-type"].find("application/json") != 0))
        throw WorkbenchError("ACCESS_DENIED", "Invalid request origin or method");
    if (!fields.count("content-length"))
        throw WorkbenchError("INVALID_ARGUMENT", "Content length required");
    size_t n = std::stoull(fields["content-length"]);
    if (n > 32 * 1024 * 1024)
        throw WorkbenchError("REQUEST_LIMIT", "Request too large");
    std::string body = request.substr(end + 4);
    char buf[32768];
    while (body.size() < n) {
        auto cnt = recv(fd, buf, std::min(sizeof(buf), n - body.size()), 0);
        if (cnt <= 0)
            throw WorkbenchError("READ_FAILED", "Incomplete request");
        body.append(buf, cnt);
    }
    return Json::parse(body);
}
inline Json WorkbenchCall(const std::string &path, const Json &body, int expectedPid = 0) {
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    if (path.size() >= sizeof(addr.sun_path))
        throw WorkbenchError("NO_CONTROL", "Control path is too long");
    std::strcpy(addr.sun_path, path.c_str());
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    try {
        if (fd < 0 || connect(fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)))
            throw WorkbenchError("NO_CONTROL", "Cannot connect to session control socket");
        if (expectedPid) {
            struct ucred peer;
            socklen_t length = sizeof(peer);
            if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &length) || peer.pid != expectedPid ||
                peer.uid != getuid())
                throw WorkbenchError("OWNER_MISMATCH", "Control socket owner mismatch");
        }
        timeval timeout = {10, 0};
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        const auto data = body.dump(),
                   req = "POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: " +
                         std::to_string(data.size()) + "\r\n\r\n" + data;
        size_t sent = 0;
        while (sent < req.size()) {
            auto n = send(fd, req.data() + sent, req.size() - sent, MSG_NOSIGNAL);
            if (n <= 0)
                throw WorkbenchError("WRITE_FAILED", "Control write failed");
            sent += n;
        }
        std::string raw;
        char buf[16384];
        for (;;) {
            auto n = recv(fd, buf, sizeof(buf), 0);
            if (!n)
                break;
            if (n < 0 || raw.size() > 32 * 1024 * 1024)
                throw WorkbenchError("READ_FAILED", "Control read failed");
            raw.append(buf, n);
        }
        auto end = raw.find("\r\n\r\n");
        if (end == std::string::npos)
            throw WorkbenchError("READ_FAILED", "Incomplete control response");
        auto result = Json::parse(raw.substr(end + 4));
        close(fd);
        return result;
    } catch (...) {
        if (fd >= 0)
            close(fd);
        throw;
    }
}
inline Json ExecuteWorkbench(const std::function<Json(const Json &)> &run, const Json &argv, const WorkbenchCommand &cmd,
                             std::string &page, std::string &cwd) {
    Json command = {{"version", 1},
                      {"op", "command"},
                      {"argv", argv},
                      {"page", page},
                      {"cwd", cwd},
                      {"id", Field(cmd.m_options, "request-id", WorkbenchToken())}};
    auto reply = run(command);
    auto deadline = WorkbenchNow() + std::stoll(Field(cmd.m_options, "timeout", "90000"));
    auto timedOut = [&]() {
        reply["jobStatus"] = reply.at("status");
        reply["status"] = "failed";
        reply["error"] = {{"code", "WAIT_TIMEOUT"}, {"message", "Timed out waiting for " + Field(reply, "requestId", page)}};
        return reply;
    };
    while (cmd.m_name == "page wait" && Field(reply, "status") == "waiting" &&
           !cmd.m_options.value("async", false)) {
        if (WorkbenchNow() >= deadline)
            return timedOut();
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        reply = run(command);
    }
    const std::set<std::string> pending = {"reading", "queued", "delivered", "executing", "writing"};
    while (!cmd.m_options.value("async", false) && cmd.m_name != "job status" && cmd.m_name != "job cancel" &&
           pending.count(Field(reply, "status"))) {
        if (WorkbenchNow() > deadline)
            return timedOut();
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        reply = run({{"version", 1}, {"op", "status"}, {"id", reply["requestId"]}});
    }
    if (Field(reply, "status") == "committed") {
        if (cmd.m_name == "page use")
            page = Field(reply, "page");
        if (cmd.m_name == "fs cd")
            cwd = Field(reply["result"], "path");
    }
    return reply;
}
inline std::string TclEscape(const std::string &s) {
    if (s.empty())
        return "{}";
    std::string v;
    for (char c : s) {
        if (c == '\n')
            v += "\\n";
        else if (c == '\r')
            v += "\\r";
        else if (c == '\t')
            v += "\\t";
        else {
            if (std::strchr(" \\{}[]$\";", c))
                v += '\\';
            v += c;
        }
    }
    return v;
}
inline std::string WorkbenchTcl(const Json &x) {
    if (x.is_string())
        return x.get<std::string>();
    if (x.is_null())
        return "";
    if (!x.is_structured())
        return x.dump();
    std::string v;
    for (auto it = x.begin(); it != x.end(); ++it) {
        if (!v.empty())
            v += ' ';
        if (x.is_object())
            v += TclEscape(it.key()) + " ";
        v += TclEscape(WorkbenchTcl(it.value()));
    }
    return v;
}
inline std::string ReadWorkbenchStdin(size_t limit) {
    std::string text;
    char buffer[65536];
    while (std::cin.read(buffer, sizeof(buffer)) || std::cin.gcount()) {
        if (text.size() + static_cast<size_t>(std::cin.gcount()) > limit)
            throw WorkbenchError("FILE_LIMIT", "Input too large");
        text.append(buffer, std::cin.gcount());
    }
    return text;
}
inline unsigned HexDigit(char value) {
    if (value >= '0' && value <= '9')
        return value - '0';
    if (value >= 'a' && value <= 'f')
        return value - 'a' + 10;
    if (value >= 'A' && value <= 'F')
        return value - 'A' + 10;
    throw WorkbenchError("INVALID_ARGUMENT", "Invalid Tcl argument");
}
struct PromptOptions {
    bool m_json = false;
    bool m_remember = false;
};

inline PromptOptions ReadPromptOptions(const Json &args) {
    PromptOptions result;
    result.m_remember = !args.empty();
    std::vector<std::string> words;
    for (size_t i = 0; i < args.size(); ++i) {
        const auto &arg = args[i].get_ref<const std::string &>();
        if (arg == "--json") result.m_json = true;
        if (arg == "--text") result.m_remember = false;
        if (arg.rfind("--", 0) != 0 && words.size() < 2) words.push_back(arg);
        i += WorkbenchValueCount(arg);
    }
    if (!words.empty() && (words[0] == "text set" || (words.size() == 2 && words[0] == "text" && words[1] == "set")))
        result.m_remember = false;
    return result;
}

inline int WorkbenchCli(int argc, char **argv) {
    bool tcl = false, encoded = false;
    bool jsonOutput = !isatty(STDOUT_FILENO);
    std::string command;
    std::string state, cwd = fs::current_path(), page;
    Json args = Json::array(), reply;
    try {
        for (int i = 2; i < argc; i++) {
            std::string arg = argv[i];
            if (arg == "--state-file" && i + 1 < argc)
                state = argv[++i];
            else if (arg == "--tcl")
                tcl = true;
            else if (arg == "--argv-stdin")
                encoded = true;
            else {
                args.push_back(arg);
                for (auto n = WorkbenchValueCount(arg); n && i + 1 < argc; --n)
                    args.push_back(argv[++i]);
            }
        }
        jsonOutput = jsonOutput || ReadPromptOptions(args).m_json;
        if (state.empty())
            throw WorkbenchError("INVALID_ARGUMENT", "A state file is required");
        if (encoded) {
            if (!args.empty())
                throw WorkbenchError("INVALID_ARGUMENT", "Tcl argument input cannot be mixed with command arguments");
            std::istringstream stream(ReadWorkbenchStdin(32 * 1024 * 1024 + 65536));
            std::string word;
            while (stream >> word) {
                if (args.size() >= 150 || word.empty() || word[0] != 'x' || word.size() % 2 != 1)
                    throw WorkbenchError("INVALID_ARGUMENT", "Invalid Tcl argument");
                std::string value;
                value.reserve(word.size() / 2);
                for (size_t j = 1; j < word.size(); j += 2)
                    value.push_back(static_cast<char>((HexDigit(word[j]) << 4) | HexDigit(word[j + 1])));
                args.push_back(value);
            }
        }
        for (size_t i = 0; i < args.size(); ++i) {
            if (auto count = WorkbenchValueCount(args[i].get<std::string>())) {
                i += count;
            } else if (args[i] == "--stdin") {
                if (encoded)
                    throw WorkbenchError("INVALID_ARGUMENT", "Standard input already supplies the Tcl arguments");
                args[i] = "--text";
                args.insert(args.begin() + ++i, ReadWorkbenchStdin(16 * 1024 * 1024));
            }
        }
        std::ifstream input(state);
        if (!input)
            throw WorkbenchError("NO_CONTROL", "Cannot read session state");
        Json cfg;
        input >> cfg;
        auto path = Field(cfg, "control");
        const auto parsed = ParseWorkbench(args);
        command = parsed.m_name;
        reply = ExecuteWorkbench([&](const Json &b) { return WorkbenchCall(path, b); }, args, parsed, page, cwd);
    } catch (const std::exception &e) {
        reply = WorkbenchFailure(e);
        const auto &error = reply.at("error");
        const Json details = {{"operation","cmd"}, {"code",error.at("code")}, {"error",error}};
        TerminalLog::Instance().Write("error", "workbench.client_failed", "Command failed",
                                      details.dump(-1, ' ', false, Json::error_handler_t::replace));
    }
    if (!tcl && !jsonOutput) std::cout << FormatWorkbenchReply(reply, command);
    else std::cout << (tcl ? WorkbenchTcl(reply) : reply.dump()) << std::endl;
    return !tcl && (reply.contains("error")) ? 1 : 0;
}
inline Json TerminalWords(const std::string &line) {
    Json words = Json::array();
    char quote = 0;
    bool started = false;
    std::string word;
    for (size_t i = 0; i < line.size(); i++) {
        char c = line[i];
        if (quote && c == quote) {
            quote = 0;
            continue;
        }
        if (!quote && (c == '"' || c == '\'')) {
            quote = c;
            started = true;
            continue;
        }
        if (!quote && std::isspace(static_cast<unsigned char>(c))) {
            if (started)
                words.push_back(word);
            word.clear();
            started = false;
            continue;
        }
        if (c == '\\' && i + 1 < line.size() && std::strchr(" \"'\\", line[i + 1]))
            c = line[++i];
        word += c;
        started = true;
    }
    if (quote)
        throw WorkbenchError("INVALID_ARGUMENT", "Unterminated quote");
    if (started)
        words.push_back(word);
    return words;
}
inline void WorkbenchTerminal(std::shared_ptr<WorkbenchBroker> broker, std::function<void()> stop,
                              bool terminal) {
    std::string page, cwd = fs::current_path(), line;
    std::deque<std::string> history;
    while (ReadWorkbenchLine(*broker, cwd, page.empty() ? "ngb> " : "ngb[" + page + "]> ", terminal, line, history)) {
        bool jsonOutput = false;
        std::string command;
        Json reply;
        try {
            auto args = TerminalWords(line);
            const auto options = ReadPromptOptions(args);
            jsonOutput = options.m_json;
            if (terminal && options.m_remember && (history.empty() || history.back() != line)) {
                if (history.size() == 100) history.pop_front();
                history.push_back(line);
            }
            if (args.empty())
                continue;
            if (args[0] == "quit") {
                if (args.size() != 1) throw WorkbenchError("INVALID_ARGUMENT", "quit takes no arguments");
                stop();
                return;
            }
            const auto parsed = ParseWorkbench(args);
            command = parsed.m_name;
            reply = ExecuteWorkbench([&](const Json &b) { return broker->Handle(b, true); }, args, parsed, page, cwd);
        } catch (const std::exception &e) {
            reply = WorkbenchFailure(e);
            const Json details = {{"operation", command.empty() ? "prompt" : command}, {"page", page},
                                  {"code", reply["error"]["code"]}, {"error", reply["error"]}};
            TerminalLog::Instance().Write("error", "workbench.prompt_failed", "Interactive command failed",
                details.dump(-1, ' ', false, Json::error_handler_t::replace), false);
        }
        PrintWorkbenchTerminal(jsonOutput ? reply.dump(-1, ' ', false, Json::error_handler_t::replace) + "\n"
                                          : FormatWorkbenchReply(reply, command));
    }
}
} // namespace ngb
