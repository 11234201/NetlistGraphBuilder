#pragma once

#include "LogRetention.h"

#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <mutex>
#include <sstream>
#include <string>
#include <streambuf>
#include <sys/stat.h>
#include <unistd.h>

namespace ngb {

class TerminalLog {
public:
    static TerminalLog& Instance() {
        // Worker threads may still be winding down during process teardown.
        static TerminalLog* logger = new TerminalLog();
        return *logger;
    }

    static std::string Quote(const std::string& value) {
        std::string result = "\"";
        const std::string bounded = value.substr(0, 4096);
        for (std::size_t index = 0; index < bounded.size(); ++index) {
            const unsigned char character = bounded[index];
            if (character == '"' || character == '\\') { result += '\\'; result += character; }
            else if (character < 32) {
                char escaped[7]; std::snprintf(escaped, sizeof(escaped), "\\u%04x", character); result += escaped;
            } else if (character >= 128) {
                const std::size_t count = character >= 0xc2 && character <= 0xdf ? 2 :
                    character >= 0xe0 && character <= 0xef ? 3 : character >= 0xf0 && character <= 0xf4 ? 4 : 0;
                bool valid = count && index + count <= bounded.size();
                for (std::size_t next = 1; valid && next < count; ++next)
                    valid = (static_cast<unsigned char>(bounded[index + next]) & 0xc0) == 0x80;
                if (valid && count >= 3) {
                    const unsigned char second = bounded[index + 1];
                    valid = !(character == 0xe0 && second < 0xa0) && !(character == 0xed && second >= 0xa0) &&
                        !(character == 0xf0 && second < 0x90) && !(character == 0xf4 && second >= 0x90);
                }
                if (valid) { result.append(bounded, index, count); index += count - 1; }
                else result += "\\ufffd";
            } else result += character;
        }
        return result + '"';
    }

    void Write(const std::string& level, const std::string& event, const std::string& message,
               const std::string& details = "{}", bool console = true) {
        std::lock_guard<std::mutex> guard(mutex_);
        const std::string line = Record(level, event, message, details);
        if (enabled_) {
            if (!Append(runPath_, runSize_, line) || (level == "error" && !Append(errorPath_, errorSize_, line))) Disable();
        }
        if (console || !enabled_) Stderr(line);
    }

    void Error(const std::string& event, const std::string& message, int errorCode = 0) {
        Write("error", event, message, "{\"code\":" + std::to_string(errorCode) + "}");
    }

    void Request(const std::string& method, const std::string& target, int status) {
        Write(status >= 500 ? "error" : status >= 400 ? "warning" : "info", "http.response", "HTTP response",
              "{\"method\":" + Quote(method) + ",\"path\":" + Quote(target.substr(0, target.find_first_of("?#"))) +
              ",\"status\":" + std::to_string(status) + "}", false);
    }

private:
    std::mutex mutex_;
    bool enabled_ = true;
    std::string runPath_, errorPath_;
    std::size_t runSize_ = 0, errorSize_ = 0, limit_ = 2097152;

    TerminalLog() {
        const char* configured = std::getenv("NGB_LOG_DIR");
        const char* state = std::getenv("XDG_STATE_HOME");
        const char* home = std::getenv("HOME");
        const std::string directory = configured && *configured ? configured :
            (state && *state ? std::string(state) : std::string(home && *home ? home : "/tmp") + "/.local/state") + "/netlist_graph_builder/logs";
        const char* maximum = std::getenv("NGB_LOG_MAX_BYTES");
        if (maximum) {
            char* end = 0; const long size = std::strtol(maximum, &end, 10);
            if (*maximum && end && !*end && size >= 1024 && size <= 67108864) limit_ = static_cast<std::size_t>(size);
        }
        const auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        const std::string prefix = directory + "/native-" + std::to_string(stamp) + "-" + std::to_string(getpid());
        runPath_ = prefix + ".run.jsonl"; errorPath_ = prefix + ".error.jsonl";
        if (!MakeDirectory(directory) || !Create(runPath_) || !Create(errorPath_)) Disable();
        Write("info", "log.ready", "Terminal logging initialized",
              "{\"run\":" + Quote(runPath_) + ",\"error\":" + Quote(errorPath_) + "}");
        if (enabled_) {
            const LogRetentionResult result = LogRetention::Cleanup(directory, std::getenv("NGB_LOG_RETENTION_DAYS"));
            Write(result.m_failedFiles ? "error" : "info", result.m_failedFiles ? "log.cleanup_failed" : "log.cleanup",
                  "Old terminal log cleanup completed", "{\"retentionDays\":" + std::to_string(result.m_retentionDays) +
                  ",\"deletedFiles\":" + std::to_string(result.m_deletedFiles) + ",\"deletedBytes\":" +
                  std::to_string(result.m_deletedBytes) + ",\"failedFiles\":" + std::to_string(result.m_failedFiles) +
                  ",\"error\":" + Quote(result.m_error) + "}", result.m_failedFiles != 0);
        }
    }

    static bool MakeDirectory(const std::string& path) {
        for (std::size_t index = 1; index <= path.size(); ++index) {
            if (index < path.size() && path[index] != '/') continue;
            if (mkdir(path.substr(0, index).c_str(), 0700) != 0 && errno != EEXIST) return false;
        }
        return true;
    }

    static bool Create(const std::string& path) {
        const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
        if (fd < 0) return false;
        return close(fd) == 0;
    }

    bool Append(const std::string& path, std::size_t& size, const std::string& line) {
        if (size && size + line.size() > limit_) {
            if (rename(path.c_str(), (path + ".1").c_str()) != 0) return false;
            size = 0;
        }
        const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC | O_NOFOLLOW, 0600);
        if (fd < 0) return false;
        std::size_t offset = 0;
        while (offset < line.size()) {
            const ssize_t count = write(fd, line.data() + offset, line.size() - offset);
            if (count < 0 && errno == EINTR) continue;
            if (count <= 0) { const int failure = errno; close(fd); errno = failure; return false; }
            offset += static_cast<std::size_t>(count);
        }
        size += line.size();
        return close(fd) == 0;
    }

    static std::string Record(const std::string& level, const std::string& event,
                              const std::string& message, const std::string& details) {
        const std::time_t now = std::time(0); std::tm utc; gmtime_r(&now, &utc);
        char time[32]; std::strftime(time, sizeof(time), "%Y-%m-%dT%H:%M:%SZ", &utc);
        return "{\"time\":" + Quote(time) + ",\"level\":" + Quote(level) + ",\"runtime\":\"native\",\"pid\":" +
            std::to_string(getpid()) + ",\"event\":" + Quote(event) + ",\"message\":" + Quote(message) + ",\"details\":" + details + "}\n";
    }

    static void Stderr(const std::string& line) { std::fwrite(line.data(), 1, line.size(), stderr); std::fflush(stderr); }

    void Disable() {
        if (!enabled_) return;
        const int errorCode = errno;
        enabled_ = false;
        Stderr(Record("error", "log.write_failed", "File logging unavailable; continuing on stderr",
                      "{\"code\":" + std::to_string(errorCode) + ",\"error\":" + Quote(std::strerror(errorCode)) + "}"));
    }
};

// Capture legacy launcher diagnostics without changing their command semantics.
class TerminalErrorBuffer : public std::streambuf {
protected:
    int overflow(int character) override {
        if (character == traits_type::eof()) return traits_type::not_eof(character);
        if (character == '\n') sync();
        else if (Pending().size() < 4096) Pending() += static_cast<char>(character);
        return character;
    }
    int sync() override {
        std::string& pending = Pending();
        if (!pending.empty()) {
            TerminalLog::Instance().Write(pending.find("Warning:") == 0 ? "warning" : "error", "launcher.diagnostic", pending);
            pending.clear();
        }
        return 0;
    }
private:
    static std::string& Pending() { static thread_local std::string pending; return pending; }
};

} // namespace ngb
