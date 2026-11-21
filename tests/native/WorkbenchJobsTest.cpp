#include "WorkbenchBroker.h"
#include <atomic>
#include <cstdarg>
#include <future>
#include <iostream>

using ngb::Json;
namespace fs = std::filesystem;
namespace {
std::string catalogue;
std::atomic<long long> now{1000};
class Gate {
    std::mutex mutex_;
    std::condition_variable changed_;
    bool open_ = true, entered_ = false;
  public:
    void Arm() {
        std::lock_guard<std::mutex> lock(mutex_);
        open_ = entered_ = false;
    }
    void Enter() {
        std::unique_lock<std::mutex> lock(mutex_);
        if (open_) return;
        entered_ = true;
        changed_.notify_all();
        if (!changed_.wait_for(lock, std::chrono::seconds(4), [&] { return open_; }))
            throw std::runtime_error("I/O gate was not released by its caller");
    }
    void WaitForEntry() {
        std::unique_lock<std::mutex> lock(mutex_);
        if (!changed_.wait_for(lock, std::chrono::seconds(4), [&] { return entered_; }))
            throw std::runtime_error("I/O did not reach the expected gate");
    }
    void Release() {
        std::lock_guard<std::mutex> lock(mutex_);
        open_ = true;
        changed_.notify_all();
    }
};
Gate reading, writing, listing;
std::atomic<bool> failSync{false};
void Require(bool check, const char *message) {
    if (!check) throw std::runtime_error(message);
}
class Fixture {
  public:
    fs::path m_root;
    Fixture() {
        char path[] = "workbench-jobs-XXXXXX";
        if (!mkdtemp(path)) throw std::runtime_error("Cannot create test directory");
        m_root = fs::absolute(path);
        fs::create_directory(m_root / "private");
        setenv("NGB_LOG_DIR", (m_root / "logs").c_str(), 1);
        std::ofstream(m_root / "top.v") << "module top; endmodule\n";
    }
    ~Fixture() {
        std::error_code ignored;
        fs::remove_all(m_root, ignored);
    }
};
}

namespace ngb {
const EmbeddedAsset *findEmbeddedAsset(const std::string &route) {
    static const EmbeddedAsset asset{"src/contracts/workbench_commands.json",
        reinterpret_cast<const unsigned char *>(catalogue.data()), catalogue.size()};
    return route == asset.route ? &asset : nullptr;
}
}
// Pause actual directory listing, regular-file read and atomic export at their OS boundaries.
extern "C" int __real_open(const char *, int, ...);
extern "C" int __wrap_open(const char *path, int flags, ...) {
    if (flags & O_DIRECTORY) listing.Enter();
    bool takesMode = (flags & O_CREAT) != 0;
#ifdef O_TMPFILE
    takesMode = takesMode || (flags & O_TMPFILE) == O_TMPFILE;
#endif
    if (takesMode) {
        va_list args;
        va_start(args, flags);
        const auto mode = va_arg(args, mode_t);
        va_end(args);
        return __real_open(path, flags, mode);
    }
    return __real_open(path, flags);
}
extern "C" ssize_t __real_read(int, void *, size_t);
extern "C" ssize_t __wrap_read(int fd, void *buffer, size_t count) {
    const auto bytes = __real_read(fd, buffer, count);
    reading.Enter();
    return bytes;
}
extern "C" int __real_fsync(int);
extern "C" int __wrap_fsync(int fd) {
    writing.Enter();
    if (failSync) { errno = EIO; return -1; }
    return __real_fsync(fd);
}

int main(int argc, char **argv) {
    try {
        Require(argc == 2, "Provide the workbench catalogue");
        std::ifstream input(argv[1]);
        catalogue.assign(std::istreambuf_iterator<char>(input), {});
        Fixture fixture;
        auto &root = fixture.m_root;
        auto broker = std::make_shared<ngb::WorkbenchBroker>(
            ngb::WorkbenchFiles({root.string()}, root / "state", root / "private", root / "logs"),
            (root / "state").string(), "test", +[] { return now.load(); });
        auto join = [&] { return broker->Handle({{"op","join"},{"version",1},{"token",broker->m_pair}}, false); };
        auto a = join(), b = join();
        auto page = [&](const Json &identity, const std::string &op, Json fields = Json::object()) {
            fields.update(identity);
            fields.update(Json{{"op",op},{"version",1}});
            return broker->Handle(fields, false);
        };
        auto cmd = [&](const Json &args, const std::string &id, const Json &target) {
            return broker->Handle({{"op","command"},{"version",1},{"id",id},{"argv",args},
                                   {"page",target.at("page")},{"cwd",root.string()}}, true);
        };
        const auto changing = root / "changing.v";
        for (bool fromPage : {false, true}) {
            const auto owner = join();
            listing.Arm();
            auto scan = std::async(std::launch::async, [&] {
                try {
                    if (fromPage) page(owner, "list", {{"path",root.string()}});
                    else cmd({"fs","ls",root.string()}, "slow-ls", owner);
                    return std::string("completed");
                } catch (const ngb::WorkbenchError &error) { return error.m_code; }
            });
            listing.WaitForEntry();
            auto disconnect = std::async(std::launch::async, [&] {
                page(owner, "leave");
                return page(b,"pulse");
            });
            const auto ready = disconnect.wait_for(std::chrono::seconds(1));
            listing.Release();
            disconnect.get();
            Require(ready == std::future_status::ready, "Slow directory scan blocked another page or disconnect");
            Require(scan.get() == (fromPage ? "PAGE_UNAVAILABLE" : "completed"),
                    "Directory handles must belong to the connection that requested them");
        }
        const std::string original(128 * 1024, 'a');
        for (const std::string id : {"truncate", "rewrite"}) {
            std::ofstream(changing) << original;
            fs::last_write_time(changing, fs::last_write_time(changing) - std::chrono::hours(2));
            reading.Arm();
            auto importing = std::async(std::launch::async, [&] {
                return cmd({"design","open","changing.v"}, id, a);
            });
            reading.WaitForEntry();
            std::ofstream(changing) << std::string(id == "truncate" ? 20 : original.size(), 'b');
            reading.Release();
            auto result = importing.get();
            Require(result.at("error").at("code") == "FILE_CHANGED" && result.at("status") == "failed",
                    "concurrent regeneration must reject an incomplete or mixed source");
            Require(!page(a, "poll").contains("job"), "changed source must not reach the page");
        }
        reading.Arm();
        auto launched = cmd({"design","open","top.v","--async"}, "slow-read", a);
        Require(launched.at("status") == "reading", "async must return a receipt ahead of the file read");
        reading.WaitForEntry();
        auto cancelled = cmd({"job","cancel","slow-read"}, "cancel", a);
        Require(cancelled.at("status") == "cancelled", "file reads must be cancellable");
        reading.Release();

        const auto target = (root / "result.svg").string();
        cmd({"svg","export","--out",target}, "export", a);
        Require(page(a,"poll").at("job").at("id") == "export", "cancelled read cannot be delivered");
        Require(page(a,"grant",{{"id","export"}}).at("granted"), "export grant");
        writing.Arm();
        auto ack = [&] {
            return page(a,"ack",{{"id","export"},{"context",{{"documentVersion",17}}},
                                 {"result",{{"text","<svg/>"}}}});
        };
        auto first = std::async(std::launch::async, ack);
        writing.WaitForEntry();
        auto second = std::async(std::launch::async, ack);
        Require(page(a,"status",{{"id","export"}}).at("status") == "writing", "writing visible in status");
        Require(cmd({"module","list"}, "sibling", b).at("status") == "queued", "sibling page can enqueue");
        Require(page(b,"poll").at("job").at("id") == "sibling", "sibling page can receive work");
        try {
            cmd({"job","cancel","export"}, "cancel", a);
            throw std::runtime_error("export must not cancel after write starts");
        } catch (const ngb::WorkbenchError &error) {
            Require(error.m_code == "ALREADY_EXECUTING", "wrong cancellation diagnostic");
        }
        writing.Release();
        auto receipt = first.get();
        Require(receipt.at("status") == "committed" && receipt.at("documentVersion") == 17 &&
                second.get() == receipt && fs::file_size(target) == 6, "duplicate ack must commit exactly once");

        cmd({"svg","export","--out",target,"--overwrite"}, "bad-write", a);
        page(a,"poll");
        page(a,"grant",{{"id","bad-write"}});
        failSync = true;
        auto failed = page(a,"ack",{{"id","bad-write"},{"result",{{"text","discarded"}}}});
        failSync = false;
        Require(failed.at("error").at("code") == "EIO" && fs::file_size(target) == 6,
                "failure must retain existing export");
        size_t logged = 0;
        std::set<std::string> readFailures;
        for (const auto &entry : fs::directory_iterator(root / "logs")) {
            if (entry.path().filename().string().find(".error.jsonl") == std::string::npos) continue;
            std::ifstream log(entry.path());
            for (std::string line; std::getline(log,line);) {
                auto details = Json::parse(line).at("details");
                const auto id = details.value("requestId", "");
                if (id == "truncate" || id == "rewrite")
                    Require(details.at("operation") == "design open" && details.at("page") == a.at("page") &&
                            details.at("error").at("code") == "FILE_CHANGED" && readFailures.insert(id).second,
                            "each changed input must log one scoped original error");
                if (details.value("requestId","") != "bad-write") continue;
                Require(details.at("operation") == "svg export" && details.at("page") == a.at("page") &&
                        details.at("error").at("code") == "EIO", "export failure log lost its scope");
                ++logged;
            }
        }
        Require(logged == 1 && readFailures.size() == 2, "one owning diagnostic per read or export failure");
        for (int i = 0; i < 16; ++i) {
            now += 40000;
            page(a,"pulse");
        }
        try {
            page(a,"status",{{"id","export"}});
            throw std::runtime_error("browser-only use must expire old receipts");
        } catch (const ngb::WorkbenchError &error) {
            Require(error.m_code == "REQUEST_EXPIRED", "wrong expiry diagnostic");
        }

        cmd({"svg","export","--out",target,"--overwrite"}, "final-export", a);
        page(a,"poll");
        page(a,"grant",{{"id","final-export"}});
        writing.Arm();
        auto acknowledged = std::async(std::launch::async, [&] {
            return page(a,"ack",{{"id","final-export"},{"context",{{"documentVersion",21}}},
                                 {"result",{{"text","<svg>done</svg>"}}}});
        });
        writing.WaitForEntry();
        reading.Arm();
        cmd({"design","open","top.v","--async"}, "last-read", a);
        reading.WaitForEntry();
        broker->BeginShutdown();
        Require(broker->HasPendingFileWork(), "shutdown must drain active I/O");
        Require(broker->Handle({{"op","identity"},{"version",1}}, true).at("pid") == getpid(),
                "shutdown must preserve process identity");
        try {
            join();
            throw std::runtime_error("shutdown must not accept new work");
        } catch (const ngb::WorkbenchError &error) {
            Require(error.m_code == "SERVICE_STOPPING", "wrong shutdown diagnostic");
        }
        writing.Release();
        auto finalReceipt = acknowledged.get();
        Require(finalReceipt.at("status") == "committed" && finalReceipt.at("documentVersion") == 21 &&
                fs::file_size(target) == 15, "shutdown must finish an acknowledged export");
        Require(broker->HasPendingFileWork(), "cancelled reader still owns its I/O");
        reading.Release();
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (broker->HasPendingFileWork() && std::chrono::steady_clock::now() < deadline)
            std::this_thread::yield();
        Require(!broker->HasPendingFileWork(), "shutdown must release workers when I/O completes");
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
