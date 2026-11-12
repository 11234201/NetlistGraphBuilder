#pragma once

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <dirent.h>
#include <map>
#include <regex>
#include <signal.h>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace ngb {

struct LogRetentionResult {
    int m_retentionDays = 14;
    std::size_t m_deletedFiles = 0, m_failedFiles = 0;
    unsigned long long m_deletedBytes = 0;
    std::string m_error;

    void Failed(const std::string& path, int errorCode) {
        if (errorCode == ENOENT) return; // Concurrent cleanup is harmless.
        ++m_failedFiles;
        if (m_error.empty()) m_error = path + ": " + std::strerror(errorCode);
    }
};

class LogRetention {
public:
    static LogRetentionResult Cleanup(const std::string& directory, const char* configured) {
        LogRetentionResult result;
        const std::string value = configured ? configured : "";
        if (!value.empty() && value.size() <= 4 && value.find_first_not_of("0123456789") == std::string::npos &&
            std::atoi(value.c_str()) <= 3650) result.m_retentionDays = std::atoi(value.c_str());
        if (!result.m_retentionDays) return result;
        const std::time_t cutoff = std::time(0) - result.m_retentionDays * 86400LL;
        const std::regex pattern("^(bash|node|python|native|windows)-[0-9]{1,20}-([1-9][0-9]{0,9})\\.(run|error)\\.jsonl(\\.1)?$");
        std::map<std::string, Group> groups;
        DIR* scan = opendir(directory.c_str());
        if (!scan) { result.Failed(directory, errno); return result; }
        int scanError = 0;
        for (;;) {
            errno = 0;
            const dirent* entry = readdir(scan);
            if (!entry) { scanError = errno; break; }
            const std::string name = entry->d_name;
            std::smatch match;
            if (!std::regex_match(name, match, pattern)) continue;
            const long long pid = std::strtoll(match[2].str().c_str(), 0, 10);
            if (pid > 2147483647) continue;
            Group& group = groups[name.substr(0, name.find('.'))];
            group.m_pid = static_cast<pid_t>(pid);
            group.m_paths.push_back(directory + "/" + name);
        }
        closedir(scan);
        // An incomplete listing could hide a recent sibling in an otherwise old group.
        if (scanError) { result.Failed(directory, scanError); return result; }
        for (const auto& item : groups) {
            const Group& group = item.second;
            if (!IsInactive(group.m_pid)) continue;
            bool preserve = false;
            std::vector<unsigned long long> sizes;
            for (const auto& path : group.m_paths) {
                struct stat info;
                if (lstat(path.c_str(), &info) != 0) { result.Failed(path, errno); preserve = true; break; }
                if (!S_ISREG(info.st_mode) || info.st_mtime >= cutoff) { preserve = true; break; }
                sizes.push_back(static_cast<unsigned long long>(info.st_size));
            }
            if (preserve || !IsInactive(group.m_pid)) continue;
            for (std::size_t index = 0; index < group.m_paths.size(); ++index) {
                const std::string& path = group.m_paths[index];
                // unlink never descends into a directory or follows a final symlink.
                if (unlink(path.c_str()) != 0) result.Failed(path, errno);
                else { ++result.m_deletedFiles; result.m_deletedBytes += sizes[index]; }
            }
        }
        return result;
    }

private:
    struct Group {
        pid_t m_pid = 0;
        std::vector<std::string> m_paths;
    };

    static bool IsInactive(pid_t pid) {
        return kill(pid, 0) != 0 && errno == ESRCH;
    }
};

} // namespace ngb
