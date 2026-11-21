#pragma once
#include "WorkbenchFiles.h"
#include "embedded_assets.hpp"
#include "TerminalLog.h"
#include <mutex>
#include <map>
#include <chrono>
#include <deque>
#include <condition_variable>
#include <memory>
#include <thread>

namespace ngb {
inline long long WorkbenchNow() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
inline std::string Field(const Json &value, const std::string &key, const std::string &fallback = "") {
    return value.contains(key) && value.at(key).is_string() ? value.at(key).get<std::string>() : fallback;
}
inline Json Completed(Json result, Json page = nullptr) {
    return {{"version", 1}, {"protocolVersion", 1}, {"status", "committed"},
            {"page", page}, {"pageId", page},       {"result", std::move(result)}};
}
struct WorkbenchCommand {
    std::string m_name;
    Json m_args = Json::array(), m_options = Json::object();
};
inline const Json &CommandCatalogue() {
    static const auto catalogue = []() {
        auto asset = findEmbeddedAsset("src/contracts/workbench_commands.json");
        if (!asset)
            throw WorkbenchError("CATALOGUE_MISSING", "Missing command catalogue");
        return Json::parse(asset->data, asset->data + asset->size);
    }();
    return catalogue;
}
inline bool FileCommand(const std::string &n) {
    static const std::set<std::string> inputs = {
        "design open", "design add",   "aig open",     "aig add",     "timing open",
        "timing add",  "files import", "liberty load", "golden load", "cell-config import"};
    return inputs.count(n);
}
inline const std::set<std::string> &WorkbenchValueOptions() {
    static const std::set<std::string> options = {
        "--page", "--side", "--request-id", "--timeout", "--page-number", "--filter",     "--action",
        "--dir",  "--view", "--name",       "--text",    "--out",         "--on-conflict"};
    return options;
}
inline WorkbenchCommand ParseWorkbench(const Json &argv) {
    if (!argv.is_array() || argv.size() > 150)
        throw WorkbenchError("INVALID_ARGUMENT", "Invalid argument list");
    WorkbenchCommand c;
    std::vector<std::string> words;
    const auto &options = WorkbenchValueOptions();
    const std::set<std::string> flags = {"--overwrite", "--download", "--available", "--json", "--async"};
    for (size_t i = 0; i < argv.size(); i++) {
        if (!argv.at(i).is_string())
            throw WorkbenchError("INVALID_ARGUMENT", "Expected string arguments");
        std::string arg = argv.at(i);

        if ((flags.count(arg) || options.count(arg)) && c.m_options.contains(arg.substr(2)))
            throw WorkbenchError("INVALID_ARGUMENT", "Repeated option " + arg);
        if (flags.count(arg))
            c.m_options[arg.substr(2)] = true;
        else if (options.count(arg) && i + 1 < argv.size() && argv.at(i + 1).is_string()) {
            c.m_options[arg.substr(2)] = argv.at(++i);
            if (arg != "--filter" && c.m_options.at(arg.substr(2)) == "")
                throw WorkbenchError("INVALID_ARGUMENT", "Empty option " + arg);
        } else if (arg.rfind("--", 0) == 0)
            throw WorkbenchError("INVALID_ARGUMENT", "Invalid option " + arg);
        else
            words.push_back(arg);
    }
    if (words.empty())
        throw WorkbenchError("INVALID_ARGUMENT", "Command required");
    auto positive = [](const std::string &s) {
        return !s.empty() && s.size() <= 8 && s.front() != '0' &&
               s.find_first_not_of("0123456789") == std::string::npos;
    };
    if (c.m_options.contains("timeout") && !positive(Field(c.m_options, "timeout")))
        throw WorkbenchError("INVALID_ARGUMENT", "Invalid timeout");
    if (c.m_options.contains("page-number") &&
        (!positive(Field(c.m_options, "page-number")) || Field(c.m_options, "page-number").size() > 7))
        throw WorkbenchError("INVALID_ARGUMENT", "Invalid page number");
    const auto &catalog = CommandCatalogue();
    size_t used = 1;
    c.m_name = words[0];
    if (catalog["aliases"].contains(c.m_name))
        c.m_name = catalog["aliases"][c.m_name];
    else if (words.size() > 1 && std::none_of(catalog["commands"].begin(), catalog["commands"].end(),
                                              [&](const Json &d) { return d["name"] == c.m_name; })) {
        c.m_name += " " + words[1];
        used++;
    }
    const auto &name = c.m_name;
    auto def = std::find_if(catalog["commands"].begin(), catalog["commands"].end(),
                            [&](const Json &d) { return d["name"] == name; });
    if (def == catalog["commands"].end() || def->at("capability") != "v1")
        throw WorkbenchError("UNAVAILABLE", "Unavailable command " + name);
    const auto side = Field(c.m_options, "side");
    if (!side.empty() && side != "A" && side != "B")
        throw WorkbenchError("INVALID_ARGUMENT", "Expected side A or B");
    if (!side.empty() && !def->contains("compareSide") && !(name == "commands" && c.m_options.value("available", false)))
        throw WorkbenchError("INVALID_SIDE", "This command does not target a Compare side");
    const std::string grammar = Field(*def, "syntax");
    const std::set<std::string> global = {"page", "side", "request-id", "timeout", "json", "async"};
    for (auto it = c.m_options.begin(); it != c.m_options.end(); ++it) {
        const auto &key = it.key();
        if (global.count(key) || grammar.find("--" + key) != std::string::npos)
            continue;
        if (FileCommand(name) && (key == "text" || key == "name"))
            continue;
        if (name == "svg export" && (key == "out" || key == "download" || key == "overwrite"))
            continue;
        throw WorkbenchError("INVALID_ARGUMENT", "Option not valid for " + name + ": --" + key);
    }
    if (c.m_options.contains("view") &&
        !std::set<std::string>{"logic", "standard", "search-first"}.count(Field(c.m_options, "view")))
        throw WorkbenchError("INVALID_ARGUMENT", "Invalid AIG view");
    if (c.m_options.contains("on-conflict") &&
        !std::set<std::string>{"abort", "replace"}.count(Field(c.m_options, "on-conflict")))
        throw WorkbenchError("INVALID_ARGUMENT", "Expected abort or replace");
    for (; used < words.size(); used++)
        c.m_args.push_back(words[used]);
    if (c.m_options.contains("text")) {
        const auto &text = c.m_options.at("text").get_ref<const std::string &>();
        if (!FileCommand(name) || !c.m_args.empty() || text.empty() || text.size() > 16 * 1024 * 1024)
            throw WorkbenchError("INVALID_ARGUMENT", "Expected a single text input");
        c.m_args.push_back(Field(c.m_options, "name", "pasted input"));
    }
    if (c.m_options.contains("out") || c.m_options.contains("download")) {
        if (name != "svg export" || !c.m_args.empty() ||
            (c.m_options.contains("out") && c.m_options.contains("download")))
            throw WorkbenchError("INVALID_ARGUMENT", "Choose one export destination");
        c.m_args.push_back(Field(c.m_options, "out", "download"));
    }
    const std::set<std::string> many = {"design open", "design add",   "timing open", "timing add",
                                        "aig add",     "files import", "files choose"};
    const std::set<std::string> one = {"page info",   "page use",    "page wait",   "job status",
                                       "job wait",    "job cancel",  "fs cd",       "fs complete",
                                       "module open", "search find", "timing show", "svg export"};
    size_t min =
        name == "page rename" ? 2 : (many.count(name) || one.count(name) || FileCommand(name) ? 1 : 0);
    size_t max = many.count(name) ? 64 : name == "help" ? 2 : name == "fs ls" ? 1 : min;
    if (c.m_args.size() < min || c.m_args.size() > max)
        throw WorkbenchError("INVALID_ARGUMENT", def->at("syntax"));
    if (name != "fs complete" && std::find(c.m_args.begin(), c.m_args.end(), Json("")) != c.m_args.end())
        throw WorkbenchError("INVALID_ARGUMENT", def->at("syntax"));
    return c;
}
class WorkbenchBroker : public std::enable_shared_from_this<WorkbenchBroker> {
    struct Page {
        std::string m_id, m_name, m_resume, m_connection;
        bool m_online = false;
        long long m_seen = 0;
        Json m_context = Json::object();
        std::deque<std::string> m_handleOrder;
        std::map<std::string, std::string> m_pathsByHandle, m_handlesByPath;
    };
    struct Job {
        std::string m_id, m_page, m_selector, m_key, m_phase, m_output;
        bool m_finished = false, m_overwrite = false, m_preparing = false;
        long long m_documentVersion = 0;
        long long m_at = 0;
        Json m_payload, m_inputs, m_side, m_result, m_error;
    };
    std::vector<std::string> order_;
    std::map<std::string, Job> jobs_;
    std::deque<std::string> expiredOrder_;
    std::set<std::string> expired_;
    std::map<std::string, Page> pages_;
    unsigned serial_ = 0;
    std::mutex mutex_;
    std::condition_variable changed_;
    bool stopping_ = false;
    std::set<std::string> waitingConnections_;
    WorkbenchFiles files_;
    std::string statePath_, owner_;
    long long (*now_)();
    size_t retainedKeyBytes_ = 0;
    bool Active(const Page &p) const {
        return p.m_online && now_() - p.m_seen < 45000;
    }
    Json Describe(const Page &p) const {
        Json r = p.m_context;
        r.update(Json{{"id", p.m_id}, {"name", p.m_name}, {"online", Active(p)}});
        return r;
    }
    Page *SelectPage(const std::string &key, Json &failure) {
        Page *selected = nullptr;
        Json live = Json::array();
        for (auto &kv : pages_) {
            if (!Active(kv.second)) continue;
            live.push_back(kv.first);
            if (key.empty() || key == kv.first || key == kv.second.m_name)
                selected = &kv.second;
        }
        if (selected && (!key.empty() || live.size() == 1)) return selected;
        const auto code = !key.empty() ? "PAGE_UNAVAILABLE" : live.empty() ? "PAGE_NOT_CONNECTED" : "PAGE_REQUIRED";
        failure = {{"version", 1}, {"status", "failed"},
                   {"error", {{"code", code}, {"message", "Choose a connected page"}, {"candidates", live}}}};
        return nullptr;
    }
    void Finish(Job &j, std::string phase, Json result = nullptr, Json error = nullptr) {
        if (j.m_phase != "writing")
            j.m_documentVersion = pages_.at(j.m_page).m_context.value("documentVersion", 0LL);
        j.m_phase = std::move(phase);
        j.m_result = std::move(result);
        j.m_error = std::move(error);
        j.m_finished = true;
        j.m_payload = nullptr;
        j.m_inputs = nullptr;
        j.m_at = now_();
        changed_.notify_all();
    }
    static void RefreshContext(Page &page, const Json &message) {
        auto it = message.find("context");
        if (it == message.end() || !it->is_object())
            return;
        for (const char *field : {"source", "mode"})
            if (it->contains(field))
                page.m_context[field] = Field(*it, field);
        const auto picker = Field(*it, "pickerState");
        page.m_context["pickerState"] = picker == "open" || picker == "selected" || picker == "busy" ? picker : "closed";
        if (it->contains("documentVersion") && it->at("documentVersion").is_number_integer())
            page.m_context["documentVersion"] = it->at("documentVersion");
    }
    bool RejectStale(Job &job, const Page &page) {
        const auto version = page.m_context.value("documentVersion", 0LL);
        if (!job.m_documentVersion || !version || version == job.m_documentVersion)
            return false;
        static const std::set<std::string> queries = {"design info", "module list", "search find",
                                                      "timing show"};
        if (queries.count(Field(job.m_payload, "name")))
            return false;
        Finish(job, "failed", nullptr,
               {{"code", "STALE_DOCUMENT"}, {"message", "Target document changed before command execution"}});
        return true;
    }
    void RequireAvailablePageName(const std::string &name, const Page *current = nullptr) const {
        if (name.empty())
            throw WorkbenchError("NAME_CONFLICT", "Page name cannot be empty");
        if (name.size() > 1 && name.front() == 'p' &&
            name.find_first_not_of("0123456789", 1) == std::string::npos)
            throw WorkbenchError("NAME_CONFLICT", "Page IDs are reserved");
        for (const auto &entry : pages_)
            if (&entry.second != current && entry.second.m_name == name)
                throw WorkbenchError("NAME_CONFLICT", "Page name in use");
    }
    void Disconnect(Page &p) {
        p.m_online = false;
        changed_.notify_all();
        p.m_handleOrder.clear();
        p.m_pathsByHandle.clear();
        p.m_handlesByPath.clear();
        for (auto &kv : jobs_)
            if (kv.second.m_page == p.m_id && !kv.second.m_finished && kv.second.m_phase != "writing")
                Finish(kv.second, kv.second.m_phase == "executing" ? "unknown" : "cancelled", nullptr,
                       {{"code", "PAGE_UNAVAILABLE"}, {"message", "Page disconnected"}});
    }
    Job *NextDelivery(Page &page) {
        for (const auto &id : order_) {
            auto &job = jobs_.at(id);
            if (job.m_page != page.m_id || job.m_finished)
                continue;
            if (job.m_phase != "queued" && job.m_phase != "delivered")
                return nullptr;
            if (RejectStale(job, page))
                continue;
            job.m_phase = "delivered";
            return &job;
        }
        return nullptr;
    }
    Json Poll(Page &page, const Json &message, std::unique_lock<std::mutex> &lock) {
        RefreshContext(page, message);
        auto *job = NextDelivery(page);
        const auto duration = std::clamp(message.value("waitMs", 0LL), 0LL, 8000LL);
        const auto connection = page.m_connection;
        // The listener admits 32 clients. At most half may wait idle so commands,
        // file delivery and normal HTTP requests can still make progress.
        if (!job && duration > 0 && waitingConnections_.size() < 16 &&
            waitingConnections_.insert(connection).second) {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(duration);
            try {
                while (!job) {
                    const auto wake = changed_.wait_until(lock, deadline);
                    if (!page.m_online || page.m_connection != connection)
                        throw WorkbenchError("PAGE_UNAVAILABLE", "Page connection expired");
                    job = NextDelivery(page);
                    if (wake == std::cv_status::timeout)
                        break;
                }
            } catch (...) {
                waitingConnections_.erase(connection);
                throw;
            }
            waitingConnections_.erase(connection);
        }
        if (job)
            return {{"job", job->m_payload}, {"name", page.m_name}};
        return {{"name", page.m_name}};
    }
    void Prune() {
        const auto now = now_();
        order_.erase(std::remove_if(order_.begin(), order_.end(),
                                    [&](const std::string &id) {
                                        const auto &job = jobs_.at(id);
                                        if (!job.m_finished || job.m_preparing || now - job.m_at <= 600000)
                                            return false;
                                        retainedKeyBytes_ -= job.m_key.size();
                                        jobs_.erase(id);
                                        expired_.insert(id);
                                        expiredOrder_.push_back(id);
                                        return true;
                                    }),
                     order_.end());
        while (expiredOrder_.size() > 4096) {
            expired_.erase(expiredOrder_.front());
            expiredOrder_.pop_front();
        }
    }
    Job &Lookup(const std::string &id) {
        Prune();
        if (expired_.count(id))
            throw WorkbenchError("REQUEST_EXPIRED", "The receipt retention period has ended");
        auto it = jobs_.find(id);
        if (it == jobs_.end())
            throw WorkbenchError("UNKNOWN_REQUEST", "Unknown request");
        return it->second;
    }
    Json Receipt(const Job &j) {
        Json r = {{"version", 1},
                  {"protocolVersion", 1},
                  {"requestId", j.m_id},
                  {"page", j.m_page.empty() ? Json(nullptr) : Json(j.m_page)},
                  {"pageId", j.m_page.empty() ? Json(nullptr) : Json(j.m_page)},
                  {"side", j.m_side},
                  {"documentVersion", j.m_documentVersion},
                  {"status", j.m_phase}};
        if (j.m_error.is_null())
            r["result"] = j.m_result;
        else
            r["error"] = j.m_error;
        return r;
    }
    static void LogFailure(const Job &job, const std::string &operation, const std::exception &error) {
        const auto detail = WorkbenchFailure(error).at("error");
        Json fields = {{"error", detail},
                       {"code", detail.at("code")},
                       {"requestId", job.m_id},
                       {"page", job.m_page},
                       {"operation", operation}};
        if (!job.m_side.is_null()) fields["side"] = job.m_side;
        TerminalLog::Instance().Write("error", "workbench.failed", operation + " failed",
                                      fields.dump(-1, ' ', false, Json::error_handler_t::replace));
    }
    Json ListForPage(Page &page, const Json &request) {
        Json result =
            files_.List(Field(request, "path"), Field(request, "filter"), request.value("number", 1));
        for (auto &entry : result.at("entries")) {
            if (entry["directory"] == true)
                continue;
            const auto path = (fs::path(Field(result, "path")) / Field(entry, "name")).string();
            auto known = page.m_handlesByPath.find(path);
            if (known != page.m_handlesByPath.end()) {
                entry["handle"] = known->second;
                continue;
            }
            if (page.m_handleOrder.size() >= 4096) {
                const auto oldest = page.m_handleOrder.front();
                page.m_handlesByPath.erase(page.m_pathsByHandle.at(oldest));
                page.m_pathsByHandle.erase(oldest);
                page.m_handleOrder.pop_front();
            }
            const auto handle = "ngb-file:" + WorkbenchToken();
            page.m_handleOrder.push_back(handle);
            page.m_pathsByHandle.emplace(handle, path);
            page.m_handlesByPath.emplace(path, handle);
            entry["handle"] = handle;
        }
        return result;
    }
    Json PrepareFiles(const WorkbenchCommand &c, const fs::path &cwd, Page *browser, Job &job,
                      std::unique_lock<std::mutex> &lock) {
        Json inputs = Json::array();
        size_t size = 0;
        for (const auto &arg : c.m_args) {
            std::string name = arg.get<std::string>();
            if (name.rfind("ngb-file:", 0) == 0) {
                if (!browser)
                    throw WorkbenchError("ACCESS_DENIED", "File handle requires its issuing page");
                auto handle = browser->m_pathsByHandle.find(name);
                if (handle == browser->m_pathsByHandle.end())
                    throw WorkbenchError("ACCESS_DENIED", "File handle is unavailable to this page");
                name = handle->second;
            }
            Json file;
            try {
                if (c.m_options.contains("text"))
                    file = {{"name", name}, {"text", c.m_options.at("text")}};
                else {
                    lock.unlock();
                    try {
                        file = files_.Read(cwd / name, browser);
                    } catch (...) {
                        lock.lock();
                        throw;
                    }
                    lock.lock();
                }
                size += file.at("text").get_ref<const std::string &>().size();
                if (size > 24 * 1024 * 1024)
                    throw WorkbenchError("FILE_LIMIT", "Input batch too large");
            } catch (const std::exception &e) {
                if (job.m_finished)
                    return Json::array();
                const Json error = WorkbenchFailure(e).at("error");
                if (c.m_name == "files import" && Field(error, "code") != "FILE_LIMIT" &&
                    Field(error, "code") != "ACCESS_DENIED") {
                    file = {{"name", fs::path(name).filename().string()}, {"error", error}};
                    LogFailure(job, c.m_name, e);
                } else if (c.m_name == "aig add" ||
                           (c.m_name == "design add" &&
                            Field(pages_.at(job.m_page).m_context, "mode") == "AIG")) {
                    WorkbenchError failure(Field(error, "code"), e.what());
                    failure.m_files = Json::array();
                    for (size_t i = 0; i < c.m_args.size(); i++) {
                        auto label = c.m_args[i].get<std::string>();
                        if (browser && browser->m_pathsByHandle.count(label))
                            label = browser->m_pathsByHandle.at(label);
                        failure.m_files.push_back(
                            {{"name", fs::path(label).filename().string()},
                             {"status", i == inputs.size() ? "failed" : "uncommitted"}});
                    }
                    throw failure;
                } else
                    throw;
            }
            if (job.m_finished)
                return Json::array();
            inputs.push_back(std::move(file));
        }
        return inputs;
    }
    void PrepareJob(const WorkbenchCommand &command, const fs::path &cwd, Page *browser, Job &job,
                    std::unique_lock<std::mutex> &lock) {
        if (job.m_finished) {
            job.m_preparing = false;
            return;
        }
        try {
            auto inputs = FileCommand(command.m_name) ? PrepareFiles(command, cwd, browser, job, lock)
                                                      : Json::array();
            job.m_preparing = false;
            if (job.m_finished)
                return;
            auto options = command.m_options;
            if (command.m_name == "svg export" && (options.contains("out") ||
                (!options.value("download", false) && command.m_args.at(0) != "download"))) {
                if (browser)
                    throw WorkbenchError("ACCESS_DENIED", "Use the terminal for server output");
                job.m_output = cwd / command.m_args.at(0).get<std::string>();
                job.m_overwrite = options.value("overwrite", false);
            }
            options.erase("text");
            job.m_inputs = std::move(inputs);
            job.m_payload = {{"id", job.m_id}, {"name", command.m_name}, {"args", command.m_args},
                             {"opts", std::move(options)}, {"files", Json::array()},
                             {"hasInputs", !job.m_inputs.empty()}};
            job.m_phase = "queued";
            changed_.notify_all();
        } catch (const std::exception &e) {
            job.m_preparing = false;
            if (!job.m_finished) {
                LogFailure(job, command.m_name, e);
                Finish(job, "failed", nullptr, WorkbenchFailure(e).at("error"));
            }
        }
    }
    Json Command(const Json &b, Page *browser, std::unique_lock<std::mutex> &lock) {
        auto c = ParseWorkbench(b.at("argv"));
        const auto id = Field(c.m_options, "request-id");
        if (id.empty() || (c.m_name != "page new" && c.m_name != "page rename"))
            return Dispatch(c, b, browser, lock);

        // A rename must match a replay using its old selector before resolving a page.
        const auto key = Json::array({c.m_name, c.m_args, c.m_options.value("name", Json(nullptr))}).dump();
        Prune();
        if (expired_.count(id) || jobs_.count(id)) {
            const auto &previous = Lookup(id);
            if (previous.m_key != key)
                throw WorkbenchError("REQUEST_CONFLICT", "Request ID reused");
            return Receipt(previous);
        }
        if (jobs_.size() >= 2048 || key.size() + retainedKeyBytes_ > 64 * 1024 * 1024)
            throw WorkbenchError("QUEUE_FULL", "Retained request capacity exceeded");
        auto &job = jobs_[id];
        job.m_id = id;
        job.m_key = key;
        retainedKeyBytes_ += key.size();
        order_.push_back(id);
        try {
            auto changed = Dispatch(c, b, browser, lock);
            if (changed.contains("error")) {
                job.m_phase = "failed";
                job.m_error = std::move(changed.at("error"));
                const WorkbenchError error(Field(job.m_error, "code"), Field(job.m_error, "message"));
                LogFailure(job, c.m_name, error);
            } else {
                job.m_page = Field(changed, "page");
                job.m_documentVersion = pages_.at(job.m_page).m_context.value("documentVersion", 0LL);
                job.m_phase = "committed";
                job.m_result = std::move(changed.at("result"));
            }
        } catch (const std::exception &e) {
            job.m_phase = "failed";
            job.m_error = WorkbenchFailure(e).at("error");
            LogFailure(job, c.m_name, e);
        }
        job.m_finished = true;
        job.m_at = now_();
        return Receipt(job);
    }
    Json Dispatch(WorkbenchCommand &c, const Json &b, Page *browser, std::unique_lock<std::mutex> &lock) {
        auto name = c.m_name;
        auto &args = c.m_args;
        auto &opts = c.m_options;
        fs::path cwd =
            browser ? files_.Roots().at(0).get<std::string>() : Field(b, "cwd", fs::current_path());
        std::string first = args.empty() ? "" : args.at(0).get<std::string>();
        if (name == "commands" && opts.value("available", false)) {
            Json failure;
            const auto side = Field(opts, "side");
            const auto key = Field(opts, "page", Field(b, "page"));
            auto *page = SelectPage(key, failure);
            const auto mode = page ? Field(page->m_context, "mode") : "";
            if (page && !side.empty() && mode != "Compare")
                failure = WorkbenchFailure(WorkbenchError("INVALID_SIDE", "Only a Compare page has sides A and B"));
            if (failure.contains("error") && (!side.empty() || Field(failure.at("error"), "code") != "PAGE_NOT_CONNECTED")) {
                Job source;
                source.m_page = page ? page->m_id : key;
                source.m_id = Field(opts, "request-id", Field(b, "id"));
                if (!side.empty()) source.m_side = side;
                const auto &details = failure.at("error");
                LogFailure(source, name, WorkbenchError(Field(details, "code"), Field(details, "message")));
                return failure;
            }
            Json rows = Json::array();
            for (const auto &row : CommandCatalogue()["commands"]) {
                if (row.at("capability") != "v1") continue;
                if (row.at("target") != "page") {
                    if (side.empty()) rows.push_back(row);
                    continue;
                }
                if (!page) continue;
                const auto matches = [&](const char *key, const std::string &value) {
                    auto values = row.find(key);
                    return values == row.end() || std::find(values->begin(), values->end(), value) != values->end();
                };
                if (!matches("modes", mode) || !matches("pickerStates", Field(page->m_context, "pickerState", "closed")))
                    continue;
                auto sidePolicy = Field(row, "compareSide");
                if (side.empty() ? mode == "Compare" && sidePolicy == "required" : sidePolicy.empty()) continue;
                rows.push_back(row);
            }
            return Completed(std::move(rows), page ? Json(page->m_id) : Json(nullptr));
        }
        if (name == "commands" || name == "help") {
            auto prefix = first;
            if (args.size() > 1)
                prefix += " " + args[1].get<std::string>();
            Json rows = Json::array();
            for (const auto &row : CommandCatalogue()["commands"])
                if (Field(row, "name").rfind(prefix, 0) == 0)
                    rows.push_back(row);
            return Completed(rows);
        }
        if (std::set<std::string>{"start", "stop", "status", "cmd", "quit"}.count(name))
            throw WorkbenchError("INVALID_ARGUMENT", "Use this command at the launcher or prompt");
        if (name == "page list") {
            Json rows = Json::array();
            for (auto &kv : pages_)
                if (Active(kv.second))
                    rows.push_back(Describe(kv.second));
            return Completed(rows);
        }
        if (name == "page new") {
            if (opts.contains("name"))
                RequireAvailablePageName(Field(opts, "name"));
            if (pages_.size() >= 2048)
                throw WorkbenchError("PAGE_LIMIT", "Page limit reached");
            auto id = "p" + std::to_string(++serial_);
            auto &p = pages_[id];
            p.m_id = id;
            p.m_resume = WorkbenchToken();
            p.m_name = Field(opts, "name");
            return Completed(
                {{"id", id}, {"href", "/#ngb=" + m_pair + "&page=" + id + "&resume=" + p.m_resume}}, id);
        }
        if (name == "page wait" && pages_.count(first) && !Active(pages_.at(first)))
            return {{"version", 1},
                    {"protocolVersion", 1},
                    {"status", "waiting"},
                    {"page", first},
                    {"pageId", first}};
        if (name.rfind("job ", 0) == 0) {
            auto &j = Lookup(first);
            if (name == "job cancel" && !j.m_finished) {
                if (j.m_phase == "executing" || j.m_phase == "writing")
                    throw WorkbenchError("ALREADY_EXECUTING", "Page has begun applying this command");
                Finish(j, "cancelled", nullptr,
                       {{"code", "CANCELLED"}, {"message", "Cancelled before execution"}});
            }
            return Receipt(j);
        }
        if (name == "fs roots")
            return Completed(files_.Roots());
        if (name == "fs pwd")
            return Completed({{"path", cwd.string()}});
        if (name.rfind("fs ", 0) == 0) {
            auto path = (cwd / first).lexically_normal();
            const bool complete = name == "fs complete";
            const bool directoryPrefix = first.empty() || first.back() == '/';
            const auto directory = complete && !directoryPrefix ? path.parent_path() : path;
            const auto filter = complete ? (directoryPrefix ? std::string() : path.filename().string())
                                         : Field(opts, "filter");
            auto list =
                files_.List(directory, filter, std::stoi(Field(opts, "page-number", "1")), browser, complete);
            return Completed(name == "fs cd" ? Json{{"path", list["path"]}} : list);
        }
        auto key = name.rfind("page ", 0) == 0 ? first : Field(opts, "page", Field(b, "page"));
        Page *p = browser;
        if (browser)
            key = browser->m_id;
        auto id = Field(opts, "request-id", Field(b, "id", WorkbenchToken()));
        if (name.rfind("page ", 0) != 0) {
            Prune();
            if (expired_.count(id))
                throw WorkbenchError("REQUEST_EXPIRED", "The receipt retention period has ended");
            const auto previous = jobs_.find(id);
            if (previous != jobs_.end()) {
                const auto &record = previous->second;
                auto owner = pages_.find(record.m_page);
                if (owner == pages_.end() || (key != record.m_selector && key != record.m_page &&
                    (key.empty() || key != owner->second.m_name)))
                    throw WorkbenchError("REQUEST_CONFLICT", "Request ID already used for another target");
                p = &owner->second;
            }
        }
        if (!p) {
            Json failure;
            p = SelectPage(key, failure);
            if (!p) return failure;
        }
        if (name.rfind("page ", 0) == 0) {
            if (name == "page rename") {
                std::string label = args.at(1);
                RequireAvailablePageName(label, p);
                p->m_name = label;
            }
            return Completed(Describe(*p), p->m_id);
        }
        auto semanticOptions = opts;
        for (const char *option : {"page", "request-id", "async", "json", "timeout"})
            semanticOptions.erase(option);
        auto fingerprint = Json::array({p->m_id, cwd.string(), name, args, semanticOptions}).dump();
        if (jobs_.count(id)) {
            auto &j = jobs_.at(id);
            if (j.m_key != fingerprint)
                throw WorkbenchError("REQUEST_CONFLICT", "Request ID reused");
            return Receipt(j);
        }

        if (jobs_.size() >= 2048 || std::count_if(jobs_.begin(), jobs_.end(), [](const auto &kv) {
                return !kv.second.m_finished || kv.second.m_preparing;
            }) >= 64)
            throw WorkbenchError("QUEUE_FULL", "Workbench queue is full");
        if (fingerprint.size() + retainedKeyBytes_ > 64 * 1024 * 1024)
            throw WorkbenchError("QUEUE_FULL", "Retained request capacity exceeded");
        auto &j = jobs_[id];
        j.m_id = id;
        j.m_key = std::move(fingerprint);
        retainedKeyBytes_ += j.m_key.size();
        j.m_page = p->m_id;
        j.m_selector = key;
        j.m_phase = "reading";
        j.m_preparing = true;
        j.m_documentVersion = p->m_context.value("documentVersion", 0LL);
        j.m_at = now_();
        if (opts.contains("side"))
            j.m_side = opts["side"];
        order_.push_back(id);
        if (opts.value("async", false) && FileCommand(name) && !opts.contains("text")) {
            try {
                std::thread([self = shared_from_this(), command = std::move(c), cwd, browser, id]() {
                    std::unique_lock<std::mutex> guard(self->mutex_);
                    self->PrepareJob(command, cwd, browser, self->jobs_.at(id), guard);
                }).detach();
            } catch (const std::exception &e) {
                j.m_preparing = false;
                LogFailure(j, name, e);
                Finish(j, "failed", nullptr, WorkbenchFailure(e).at("error"));
            }
        } else
            PrepareJob(c, cwd, browser, j, lock);
        return Receipt(j);
    }

  public:
    const std::string m_pair = WorkbenchToken();
    WorkbenchBroker(WorkbenchFiles files, std::string statePath, std::string owner,
                    long long (*now)() = WorkbenchNow)
        : files_(std::move(files)), statePath_(std::move(statePath)), owner_(std::move(owner)), now_(now) {}
    void BeginShutdown() {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
        for (auto &entry : pages_)
            if (entry.second.m_online)
                Disconnect(entry.second);
    }
    bool HasPendingFileWork() {
        std::lock_guard<std::mutex> lock(mutex_);
        return std::any_of(jobs_.begin(), jobs_.end(), [](const auto &entry) {
            return entry.second.m_preparing || entry.second.m_phase == "writing";
        });
    }
    Json Handle(const Json &b, bool admin) {
        std::unique_lock<std::mutex> lock(mutex_);
        if (b.value("version", 0) != 1)
            throw WorkbenchError("PROTOCOL_VERSION", "Expected protocol version 1");
        auto op = Field(b, "op"), id = Field(b, "id");
        if (admin && op == "identity")
            return {{"version", 1}, {"stateFile", statePath_}, {"owner", owner_}, {"pid", getpid()}};
        if (stopping_)
            throw WorkbenchError("SERVICE_STOPPING", "Workbench is stopping");
        for (auto &kv : pages_)
            if (kv.second.m_online && !Active(kv.second))
                Disconnect(kv.second);
        if (admin) {
            if (op == "command") {
                Json reply = Command(b, nullptr, lock);
                if (!reply.contains("requestId"))
                    reply["requestId"] = Field(b, "id", WorkbenchToken());
                if (!reply.contains("side"))
                    reply["side"] = nullptr;
                if (!reply.contains("documentVersion"))
                    reply["documentVersion"] = 0;
                return reply;
            }
            if (op == "status")
                return Receipt(Lookup(id));
            throw WorkbenchError("INVALID_ARGUMENT", "Unknown control operation");
        }
        auto key = Field(b, "page");
        auto it = pages_.find(key);
        if (op == "join") {
            if (Field(b, "token") != m_pair)
                throw WorkbenchError("ACCESS_DENIED", "Pair this browser");
            if (it == pages_.end() || Field(b, "resume") != it->second.m_resume ||
                (Active(it->second) && !b.value("reload", false))) {
                if (pages_.size() >= 2048)
                    throw WorkbenchError("PAGE_LIMIT", "Page limit reached");
                key = "p" + std::to_string(++serial_);
                auto &p = pages_[key];
                p.m_id = key;
                p.m_resume = WorkbenchToken();
            } else
                Disconnect(it->second);
            auto &p = pages_.at(key);
            p.m_online = true;
            p.m_connection = WorkbenchToken();
            p.m_seen = now_();
            return {{"page", key}, {"resume", p.m_resume}, {"connection", p.m_connection}};
        }
        if (it == pages_.end() || !it->second.m_online || it->second.m_connection != Field(b, "connection"))
            throw WorkbenchError("PAGE_UNAVAILABLE", "Page connection expired");
        auto &p = it->second;
        p.m_seen = now_();
        if (op == "leave") {
            Disconnect(p);
            return Json::object();
        }
        if (op == "pulse")
            return Json::object();
        if (op == "list")
            return ListForPage(p, b);
        if (op == "import") {
            auto c = ParseWorkbench(b.at("argv"));
            if (!FileCommand(c.m_name))
                throw WorkbenchError("ACCESS_DENIED", "Invalid picker action");
            return Command(b, &p, lock);
        }
        if (op == "poll")
            return Poll(p, b, lock);
        auto &j = Lookup(id);
        if (j.m_page != key)
            throw WorkbenchError("ACCESS_DENIED", "Job belongs to another page");
        if (op == "status" || (op == "ack" && j.m_finished))
            return Receipt(j);
        if (op == "inputs") {
            if (j.m_phase != "delivered" && j.m_phase != "executing")
                throw WorkbenchError("INVALID_STATE", "Inputs unavailable for this request");
            return {{"files", j.m_inputs}};
        }
        if (op == "picker-files") {
            if (j.m_phase != "executing" || j.m_preparing || Field(j.m_payload, "name") != "files submit")
                throw WorkbenchError("ACCESS_DENIED", "Picker job is not available for reading");
            const auto command = ParseWorkbench(b.at("argv"));
            if (!FileCommand(command.m_name) || command.m_options.contains("text"))
                throw WorkbenchError("ACCESS_DENIED", "Invalid picker action");
            j.m_preparing = true;
            try {
                auto files = PrepareFiles(command, files_.Roots().at(0).get<std::string>(), &p, j, lock);
                j.m_preparing = false;
                if (j.m_finished)
                    throw WorkbenchError("CANCELLED", "Picker job is no longer active");
                return {{"name", command.m_name},
                        {"args", command.m_args},
                        {"opts", command.m_options},
                        {"files", std::move(files)}};
            } catch (const std::exception &e) {
                j.m_preparing = false;
                if (!j.m_finished)
                    LogFailure(j, command.m_name, e);
                throw;
            }
        }
        if (op == "grant") {
            RefreshContext(p, b);
            if (j.m_phase == "delivered" && RejectStale(j, p))
                return {{"granted", false}};
            bool granted = j.m_phase == "delivered" || j.m_phase == "executing";
            if (granted)
                j.m_phase = "executing";
            return {{"granted", granted}};
        }
        if (op == "ack" && j.m_phase == "writing") {
            changed_.wait(lock, [&] { return Lookup(id).m_finished; });
            return Receipt(Lookup(id));
        }
        if (op == "ack" && j.m_phase == "executing") {
            const auto operation = Field(j.m_payload, "name");
            try {
                RefreshContext(p, b);
                if (b.contains("error"))
                    Finish(j, "failed", nullptr, b.at("error"));
                else {
                    Json result = b.at("result");
                    if (!j.m_output.empty()) {
                        const auto &text = result.at("text").get_ref<const std::string &>();
                        j.m_phase = "writing";
                        j.m_documentVersion = p.m_context.value("documentVersion", 0LL);
                        lock.unlock();
                        try {
                            result = files_.Output(j.m_output, text, j.m_overwrite);
                        } catch (...) {
                            lock.lock();
                            throw;
                        }
                        lock.lock();
                    }
                    const bool partial = result.is_object() && result.value("partial", false);
                    Finish(j, partial ? "partial" : "committed", std::move(result));
                }
            } catch (const std::exception &e) {
                LogFailure(j, operation, e);
                Finish(j, "failed", nullptr, WorkbenchFailure(e).at("error"));
            }
            return Receipt(j);
        }
        throw WorkbenchError("INVALID_STATE", "Unexpected page operation");
    }
};
} // namespace ngb
