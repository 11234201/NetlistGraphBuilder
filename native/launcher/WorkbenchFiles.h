#pragma once
#include "../vendor/nlohmann/json.hpp"
#include <filesystem>
#include <fstream>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/random.h>
#include <array>
#include <set>

namespace ngb {
using Json = nlohmann::json;
namespace fs = std::filesystem;
struct WorkbenchError : std::runtime_error {
    std::string m_code;
    Json m_files;
    explicit WorkbenchError(std::string code, std::string message)
        : std::runtime_error(message), m_code(std::move(code)) {}
};
inline std::string WorkbenchToken() {
    unsigned char bytes[16];
    size_t filled = 0;
    while (filled < sizeof(bytes)) {
        auto n = getrandom(bytes + filled, sizeof(bytes) - filled, 0);
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0)
            throw WorkbenchError("RANDOM_FAILED", "Cannot initialize workbench identity");
        filled += n;
    }
    const char digits[] = "0123456789abcdef";
    std::string value;
    for (auto b : bytes) {
        value += digits[b >> 4];
        value += digits[b & 15];
    }
    return value;
}
inline Json WorkbenchFailure(const std::exception &e) {
    auto known = dynamic_cast<const WorkbenchError *>(&e);
    auto io = dynamic_cast<const fs::filesystem_error *>(&e);
    std::string code = known                                                      ? known->m_code
                       : io && io->code() == std::errc::no_such_file_or_directory ? "ENOENT"
                                                                                  : "COMMAND_FAILED";
    if (io && io->code() == std::errc::permission_denied)
        code = "EACCES";
    Json error = {{"code", code}, {"message", e.what()}};
    if (known && known->m_files.is_array())
        error["files"] = known->m_files;
    return {{"version", 1}, {"status", "failed"}, {"error", std::move(error)}};
}
inline WorkbenchError ExportFailure(const char *operation, int errorNumber) {
    const char *code = "WRITE_FAILED";
    switch (errorNumber) {
    case EEXIST:
        code = "EEXIST";
        break;
    case EFBIG:
        code = "EFBIG";
        break;
    case ENOSPC:
        code = "ENOSPC";
        break;
    case EDQUOT:
        code = "EDQUOT";
        break;
    case EROFS:
        code = "EROFS";
        break;
    case EACCES:
        code = "EACCES";
        break;
    case EPERM:
        code = "EPERM";
        break;
    case EIO:
        code = "EIO";
        break;
    }
    return WorkbenchError(code, std::string(operation) + ": " +
                                    std::error_code(errorNumber, std::generic_category()).message());
}
class WorkbenchFiles {
    std::vector<fs::path> roots_;
    fs::path state_, privateDir_, logDir_;
    bool Protected(const fs::path &path) const {
        return path == state_ || path == state_.string() + ".lock" ||
               path == state_.string() + ".tmp." + std::to_string(getpid()) || Within(path, privateDir_) ||
               (!logDir_.empty() && Within(path, logDir_));
    }
    static bool Within(const fs::path &path, const fs::path &root) {
        auto rel = path.lexically_relative(root);
        return !rel.empty() && *rel.begin() != "..";
    }
    fs::path Check(const fs::path &input, bool browser) const {
        auto path = fs::canonical(input);
        if (Protected(path) || (browser && std::none_of(roots_.begin(), roots_.end(), [&](const auto &root) {
                                    return Within(path, root);
                                })))
            throw WorkbenchError("ACCESS_DENIED", "Path is outside the available files");
        return path;
    }
    static struct stat InspectInput(int fd) {
        struct stat info;
        if (fstat(fd, &info))
            throw WorkbenchError("READ_FAILED", "Cannot inspect input: " +
                                    std::error_code(errno, std::generic_category()).message());
        return info;
    }

  public:
    WorkbenchFiles(std::vector<std::string> roots, fs::path state, fs::path dir, fs::path logs)
        : state_(fs::weakly_canonical(std::move(state))), privateDir_(fs::canonical(std::move(dir))),
          logDir_(std::move(logs)) {
        if (roots.empty())
            roots.push_back(fs::current_path());
        for (const auto &root : roots) {
            auto path = fs::canonical(root);
            if (!fs::is_directory(path))
                throw WorkbenchError("NOT_DIRECTORY", "Invalid browse root");
            roots_.push_back(path);
        }
    }
    Json Roots() const {
        Json result = Json::array();
        for (const auto &root : roots_)
            result.push_back(root.string());
        return result;
    }
    Json Read(const fs::path &path, bool browser) const {
        auto canonical = Check(path, browser);
        int fd = open(canonical.c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK | O_NOFOLLOW);
        if (fd < 0)
            throw WorkbenchError(errno == EACCES ? "EACCES" : "READ_FAILED",
                                 "Cannot open " + path.filename().string());
        try {
            Check("/proc/self/fd/" + std::to_string(fd), browser);
            const auto before = InspectInput(fd);
            if (!S_ISREG(before.st_mode) || before.st_size > 16 * 1024 * 1024)
                throw WorkbenchError("FILE_LIMIT", "Expected a regular file under 16 MiB");
            std::string text;
            std::array<char, 65536> buf;
            for (;;) {
                auto n = read(fd, buf.data(), buf.size());
                if (n == 0)
                    break;
                if (n < 0 && errno == EINTR)
                    continue;
                if (n < 0)
                    throw WorkbenchError("READ_FAILED", "Cannot read input");
                if (text.size() + n > static_cast<size_t>(before.st_size))
                    throw WorkbenchError("FILE_CHANGED", "Input changed");
                text.append(buf.data(), n);
            }
            const auto after = InspectInput(fd);
            if (text.size() != static_cast<size_t>(before.st_size) || after.st_size != before.st_size ||
                after.st_mtim.tv_sec != before.st_mtim.tv_sec || after.st_mtim.tv_nsec != before.st_mtim.tv_nsec ||
                after.st_ctim.tv_sec != before.st_ctim.tv_sec || after.st_ctim.tv_nsec != before.st_ctim.tv_nsec)
                throw WorkbenchError("FILE_CHANGED", "Input changed");
            Json result = {{"name", path.filename().string()}, {"text", std::move(text)}};
            close(fd);
            return result;
        } catch (...) {
            close(fd);
            throw;
        }
    }
    Json List(fs::path path, std::string filter, int number, bool browser = true, bool prefix = false) const {
        path = Check(path.empty() ? roots_[0] : path, browser);
        if (number < 1)
            throw WorkbenchError("INVALID_ARGUMENT", "Invalid page number");
        std::vector<std::pair<bool, std::string>> entries;
        auto lower = [](std::string s) {
            for (char &c : s)
                if (c >= 'A' && c <= 'Z')
                    c += 'a' - 'A';
            return s;
        };
        if (!prefix)
            filter = lower(filter);
        // Enumerate the same opened directory that passed the second root check.
        // Holding the descriptor also pins it if an ancestor changes during enumeration.
        struct OpenDirectory {
            int m_fd;
            ~OpenDirectory() {
                if (m_fd >= 0)
                    close(m_fd);
            }
        };
        const OpenDirectory directory{open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)};
        if (directory.m_fd < 0)
            throw fs::filesystem_error("Cannot open directory", path,
                                       std::error_code(errno, std::generic_category()));
        const fs::path descriptorPath = "/proc/self/fd/" + std::to_string(directory.m_fd);
        path = Check(descriptorPath, browser);
        for (const auto &e : fs::directory_iterator(descriptorPath)) {
            auto type = e.symlink_status().type();
            auto name = e.path().filename().string();
            if ((type != fs::file_type::directory && type != fs::file_type::regular) ||
                Protected(path / name))
                continue;
            if (prefix ? name.compare(0, filter.size(), filter) != 0
                       : lower(name).find(filter) == std::string::npos)
                continue;
            entries.emplace_back(type != fs::file_type::directory, name);
            if (entries.size() > 50000)
                throw WorkbenchError("DIRECTORY_LIMIT", "Narrow the directory filter");
        }
        std::sort(entries.begin(), entries.end());
        Json page = Json::array();
        for (size_t i = (size_t(number) - 1) * 100; i < entries.size() && page.size() < 100; i++)
            page.push_back({{"name", entries[i].second}, {"directory", !entries[i].first}});
        return {{"path", path.string()},
                {"roots", Roots()},
                {"entries", page},
                {"number", number},
                {"total", entries.size()}};
    }
    Json Output(fs::path path, const std::string &text, bool overwrite) const {
        path = fs::canonical(path.parent_path()) / path.filename();
        if (Protected(path))
            throw WorkbenchError("ACCESS_DENIED", "Protected output");
        const auto tmp = path.parent_path() / (".ngb-export-" + WorkbenchToken());
        int fd = open(tmp.c_str(), O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0600);
        if (fd < 0)
            throw ExportFailure("Cannot prepare export", errno);
        try {
            size_t pos = 0;
            while (pos < text.size()) {
                auto n = write(fd, text.data() + pos, text.size() - pos);
                if (n < 0 && errno == EINTR)
                    continue;
                if (n <= 0)
                    throw ExportFailure("Cannot complete export", n == 0 ? EIO : errno);
                pos += n;
            }
            if (fsync(fd))
                throw ExportFailure("Cannot sync export", errno);
            const int closeResult = close(fd);
            fd = -1;
            if (closeResult < 0)
                throw ExportFailure("Cannot finish export", errno);
            if (overwrite ? rename(tmp.c_str(), path.c_str()) : link(tmp.c_str(), path.c_str()))
                throw ExportFailure("Cannot install export", errno);
            unlink(tmp.c_str());
            return {{"path", path.string()}, {"bytes", text.size()}};
        } catch (...) {
            if (fd >= 0)
                close(fd);
            unlink(tmp.c_str());
            throw;
        }
    }
};
} // namespace ngb
