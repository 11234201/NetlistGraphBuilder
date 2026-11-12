#include "LogRetention.h"

#include <fstream>
#include <iostream>
#include <stdexcept>
#include <utime.h>

namespace {
bool failScan = false, yieldedCandidate = false, failDelete = false, concurrentDelete = false;
const char* logName = "native-1-2147483647.error.jsonl";
}

// Inject OS failures at the boundary, without changing the production cleanup API.
extern "C" dirent* __real_readdir(DIR*);
extern "C" int __real_unlink(const char*);
extern "C" dirent* __wrap_readdir(DIR* scan) {
    if (!failScan) return __real_readdir(scan);
    if (yieldedCandidate) { errno = EIO; return 0; }
    dirent* entry;
    while ((entry = __real_readdir(scan)) != 0) {
        if (std::string(entry->d_name) == logName) { yieldedCandidate = true; return entry; }
    }
    return 0;
}
extern "C" int __wrap_unlink(const char* path) {
    if (failDelete) { errno = EACCES; return -1; }
    if (concurrentDelete) { __real_unlink(path); errno = ENOENT; return -1; }
    return __real_unlink(path);
}

namespace {
class Fixture {
public:
    std::string m_directory;
    Fixture() {
        const char* temporary = std::getenv("TMPDIR");
        std::string pattern = std::string(temporary ? temporary : "/tmp") + "/ngb-retention-native-XXXXXX";
        std::vector<char> buffer(pattern.begin(), pattern.end());
        buffer.push_back(0);
        const char* created = mkdtemp(buffer.data());
        if (!created) throw std::runtime_error("mkdtemp failed");
        m_directory = created;
    }
    ~Fixture() {
        failScan = failDelete = concurrentDelete = false;
        DIR* scan = opendir(m_directory.c_str());
        if (scan) {
            while (dirent* entry = readdir(scan)) {
                if (std::string(entry->d_name) != "." && std::string(entry->d_name) != "..")
                    unlink((m_directory + "/" + entry->d_name).c_str());
            }
            closedir(scan);
        }
        rmdir(m_directory.c_str());
    }
    std::string Seed(const std::string& name, int days) {
        const std::string path = m_directory + "/" + name;
        { std::ofstream output(path); output << "{}\n"; if (!output) throw std::runtime_error("write failed"); }
        struct utimbuf times;
        times.actime = times.modtime = std::time(0) - days * 86400LL;
        if (utime(path.c_str(), &times) != 0) throw std::runtime_error("utime failed");
        return path;
    }
};

void Require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
}

int main() {
    try {
        Fixture fixture;
        const std::string old = fixture.Seed(logName, 30);
        const std::string recent = fixture.Seed("native-1-2147483647.run.jsonl", 1);
        failScan = true;
        const auto partial = ngb::LogRetention::Cleanup(fixture.m_directory, "14");
        Require(yieldedCandidate && partial.m_failedFiles == 1 && partial.m_deletedFiles == 0 &&
                access(old.c_str(), F_OK) == 0, "incomplete listing must not delete an old sibling");
        failScan = false;
        unlink(recent.c_str());
        failDelete = true;
        const auto failed = ngb::LogRetention::Cleanup(fixture.m_directory, "14");
        Require(failed.m_failedFiles == 1 && failed.m_deletedFiles == 0 && !failed.m_error.empty() &&
                access(old.c_str(), F_OK) == 0, "deletion failure must retain evidence and diagnostics");
        failDelete = false;
        concurrentDelete = true;
        const auto raced = ngb::LogRetention::Cleanup(fixture.m_directory, "14");
        Require(raced.m_failedFiles == 0 && raced.m_deletedFiles == 0 && raced.m_deletedBytes == 0 &&
                access(old.c_str(), F_OK) != 0, "concurrent removal must not count twice or report a failure");
        concurrentDelete = false;
        fixture.Seed(logName, 30);
        const auto success = ngb::LogRetention::Cleanup(fixture.m_directory, "14");
        Require(success.m_failedFiles == 0 && success.m_deletedFiles == 1 && success.m_deletedBytes == 3,
                "cleanup must remain usable after transient failures");
        std::cout << "Native retention failure and concurrent cleanup checks passed\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
