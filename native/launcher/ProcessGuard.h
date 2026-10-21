#pragma once

#include <cerrno>
#include <cstdlib>
#include <fcntl.h>
#include <fstream>
#include <sstream>
#include <string>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace ngb {

inline std::string ReadProcessStartTicks(int pid) {
    std::ifstream input(("/proc/" + std::to_string(pid) + "/stat").c_str());
    std::string line;
    std::getline(input, line);
    const std::size_t end = line.rfind(')');
    if (end == std::string::npos) return "";
    std::istringstream fields(line.substr(end + 2));
    std::string value;
    for (int field = 3; field <= 22; ++field) {
        if (!(fields >> value)) return "";
        if (field == 3 && (value == "Z" || value == "X")) return "";
    }
    return value;
}

inline bool IsSameExecutable(int pid) {
    struct stat ownInfo, processInfo;
    return stat("/proc/self/exe", &ownInfo) == 0 &&
        stat(("/proc/" + std::to_string(pid) + "/exe").c_str(), &processInfo) == 0 &&
        ownInfo.st_dev == processInfo.st_dev && ownInfo.st_ino == processInfo.st_ino;
}

inline bool HasExactStateArgument(int pid, const std::string& statePath) {
    std::ifstream input(("/proc/" + std::to_string(pid) + "/cmdline").c_str(), std::ios::binary);
    std::vector<std::string> arguments;
    std::string value;
    while (std::getline(input, value, '\0')) arguments.push_back(value);
    if (arguments.size() < 2 || arguments[1] == "stop" || arguments[1] == "status") return false;
    for (std::size_t index = 1; index + 1 < arguments.size(); ++index) {
        if (arguments[index] != "--state-file") continue;
        std::string path = arguments[index + 1];
        if (path.empty()) return false;
        if (path[0] != '/') {
            char cwd[4096];
            const ssize_t size = readlink(("/proc/" + std::to_string(pid) + "/cwd").c_str(), cwd, sizeof(cwd) - 1);
            if (size < 0) return false;
            cwd[size] = '\0';
            path = std::string(cwd) + "/" + path;
        }
        char canonical[4096];
        return realpath(path.c_str(), canonical) && statePath == canonical;
    }
    return false;
}

// A persistent lock inode is intentional: unlinking it would let concurrent
// starters lock different files with the same name. The descriptor is CLOEXEC.
class StateFileLock {
public:
    StateFileLock() : descriptor_(-1) {}
    ~StateFileLock() { if (descriptor_ >= 0) close(descriptor_); }
    bool Acquire(const std::string& path, std::string* error) {
        if (path.empty()) return true;
        descriptor_ = open((path + ".lock").c_str(), O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
        struct stat info;
        if (descriptor_ < 0 || fstat(descriptor_, &info) != 0 || !S_ISREG(info.st_mode) ||
            info.st_uid != getuid() || flock(descriptor_, LOCK_EX | LOCK_NB) != 0) {
            *error = "State file is locked or unsafe: " + path;
            return false;
        }
        return true;
    }
private:
    StateFileLock(const StateFileLock&);
    StateFileLock& operator=(const StateFileLock&);
    int descriptor_;
};
} // namespace ngb
