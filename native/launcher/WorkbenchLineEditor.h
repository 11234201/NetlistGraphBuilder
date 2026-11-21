#pragma once
#include "WorkbenchBroker.h"
#include <termios.h>
#include <poll.h>
#include <unistd.h>

namespace ngb {
// Owned by the server's main thread so signal-driven shutdown restores the
// original terminal settings even while the input thread is blocked in read.
class WorkbenchTerminalMode {
    termios original_{};
    bool enabled_ = false;

  public:
    explicit WorkbenchTerminalMode(bool interactive) {
        if (!interactive || !isatty(STDIN_FILENO) || tcgetattr(STDIN_FILENO, &original_))
            return;
        auto mode = original_;
        mode.c_lflag &= ~(ICANON | ECHO);
        mode.c_cc[VMIN] = 1;
        mode.c_cc[VTIME] = 0;
        enabled_ = tcsetattr(STDIN_FILENO, TCSANOW, &mode) == 0;
    }
    ~WorkbenchTerminalMode() {
        if (enabled_)
            tcsetattr(STDIN_FILENO, TCSANOW, &original_);
    }
    bool Enabled() const {
        return enabled_;
    }
};

inline void PrintWorkbenchTerminal(const std::string &text) {
    std::fwrite(text.data(), 1, text.size(), stderr);
    std::fflush(stderr);
}
inline std::string TerminalPathQuote(const std::string &name) {
    std::string quoted;
    for (char c : name) {
        if (std::strchr(" \"'\\", c))
            quoted += '\\';
        quoted += c;
    }
    return quoted;
}

inline void CompleteWorkbenchPath(WorkbenchBroker &broker, const std::string &cwd, const std::string &prompt,
                                  std::string &line) {
    std::string prefix;
    size_t begin = 0;
    char quote = 0;
    for (size_t i = 0; i < line.size(); i++) {
        char c = line[i];
        if (quote && c == quote) {
            quote = 0;
            continue;
        }
        if (!quote && (c == '\'' || c == '"')) {
            quote = c;
            continue;
        }
        if (!quote && std::isspace(static_cast<unsigned char>(c))) {
            begin = i + 1;
            prefix.clear();
            continue;
        }
        if (c == '\\' && i + 1 < line.size() && std::strchr(" \"'\\", line[i + 1]))
            c = line[++i];
        prefix += c;
    }
    auto result =
        broker
            .Handle({{"op", "command"}, {"version", 1}, {"cwd", cwd}, {"argv", {"fs", "complete", prefix}}},
                    true)
            .at("result");
    const auto &entries = result.at("entries");
    if (entries.empty()) {
        PrintWorkbenchTerminal("\a");
        return;
    }
    const auto slash = prefix.rfind('/');
    const auto parent = slash == std::string::npos ? std::string() : prefix.substr(0, slash + 1);
    std::vector<std::string> candidates;
    for (const auto &entry : entries) {
        auto name = Field(entry, "name");
        if (std::any_of(name.begin(), name.end(), [](unsigned char c) { return c < 32 || c == 127; }))
            continue;
        candidates.push_back(parent + name + (entry.value("directory", false) ? "/" : ""));
    }
    if (candidates.empty()) {
        PrintWorkbenchTerminal("\a");
        return;
    }
    if (result.value("total", size_t(0)) <= entries.size()) {
        auto common = candidates.front();
        for (const auto &candidate : candidates) {
            size_t i = 0;
            while (i < common.size() && i < candidate.size() && common[i] == candidate[i])
                ++i;
            common.resize(i);
        }
        // A partial UTF-8 sequence is never a valid path completion.
        if (common.size() < candidates.front().size())
            while (!common.empty() &&
                   (static_cast<unsigned char>(candidates.front()[common.size()]) & 0xc0) == 0x80)
                common.pop_back();
        if (common.size() > prefix.size()) {
            line.replace(begin, std::string::npos, TerminalPathQuote(common));
            PrintWorkbenchTerminal("\r\x1b[2K" + prompt + line);
            return;
        }
    }
    PrintWorkbenchTerminal("\n");
    for (const auto &candidate : candidates)
        PrintWorkbenchTerminal(TerminalPathQuote(candidate) + "\n");
    PrintWorkbenchTerminal(prompt + line);
}
inline bool ReadWorkbenchLine(WorkbenchBroker &broker, const std::string &cwd, const std::string &prompt,
                              bool terminal, std::string &line) {
    PrintWorkbenchTerminal(prompt);
    if (!terminal)
        return static_cast<bool>(std::getline(std::cin, line));
    line.clear();
    for (;;) {
        unsigned char c;
        const auto n = read(STDIN_FILENO, &c, 1);
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0)
            return false;
        if (c == '\n' || c == '\r') {
            PrintWorkbenchTerminal("\n");
            return true;
        }
        if (c == '\t') {
            try {
                CompleteWorkbenchPath(broker, cwd, prompt, line);
            } catch (const std::exception &e) {
                PrintWorkbenchTerminal("\n" + WorkbenchFailure(e).dump() + "\n" + prompt + line);
            }
        } else if (c == 127 || c == 8) {
            if (!line.empty()) {
                size_t first = line.size() - 1;
                while (first && (static_cast<unsigned char>(line[first]) & 0xc0) == 0x80)
                    --first;
                line.resize(first);
                PrintWorkbenchTerminal("\r\x1b[2K" + prompt + line);
            }
        } else if (c == 21) {
            line.clear();
            PrintWorkbenchTerminal("\r\x1b[2K" + prompt);
        } else if (c == 4 && line.empty())
            return false;
        else if (c ==
                 27) { // Discard terminal function-key sequences instead of inserting them into a command.
            pollfd key = {STDIN_FILENO, POLLIN, 0};
            unsigned char next;
            if (poll(&key, 1, 20) > 0 && read(STDIN_FILENO, &next, 1) == 1 && (next == '[' || next == 'O')) {
                while (poll(&key, 1, 20) > 0 && read(STDIN_FILENO, &next, 1) == 1) {
                    if (next >= 0x40 && next <= 0x7e)
                        break;
                }
            }
        } else if (c >= 32 && line.size() < 65536) {
            line += static_cast<char>(c);
            PrintWorkbenchTerminal(std::string(1, static_cast<char>(c)));
        }
    }
}
} // namespace ngb
