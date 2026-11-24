#pragma once
#include "WorkbenchBroker.h"
#include <cctype>
#include <sstream>
#include <string_view>

namespace ngb {
inline std::string TerminalText(const std::string &value) {
    std::string text;
    for (size_t i = 0; i < value.size(); ++i) {
        unsigned char c = value[i];
        if (c == 0xc2 && i + 1 < value.size() && static_cast<unsigned char>(value[i + 1]) >= 0x80 &&
            static_cast<unsigned char>(value[i + 1]) <= 0x9f)
            c = value[++i];
        else if ((c >= 32 && c != 127) || c == '\n' || c == '\t') {
            text += static_cast<char>(c);
            continue;
        }
        char escaped[7];
        std::snprintf(escaped, sizeof(escaped), "\\u%04x", static_cast<unsigned>(c));
        text += escaped;
    }
    return text;
}

inline std::string TerminalLabel(const std::string &key) {
    std::string label;
    for (unsigned char c : TerminalText(key)) {
        if (!label.empty() && std::islower(static_cast<unsigned char>(label.back())) && std::isupper(c))
            label += ' ';
        label += c == '_' || c == '-' ? ' ' : label.empty() ? static_cast<char>(std::toupper(c)) : static_cast<char>(c);
    }
    return label;
}

inline void PrintReceiptRows(std::ostream &out, const Json &value, std::string indent = "",
                             const std::string &prefix = "") {
    if (!value.is_structured() || value.empty()) {
        auto text = value.is_string() ? TerminalText(value.get_ref<const std::string &>()) :
                    value.is_structured() ? "(none)" : value.is_null() ? "—" : value.dump();
        out << indent << prefix;
        for (char c : text) {
            out << c;
            if (c == '\n') out << indent << "  ";
        }
        out << '\n';
        return;
    }
    if (!prefix.empty()) {
        out << indent << prefix.substr(0, prefix.size() - 1) << '\n';
        indent += "  ";
    }
    for (auto it = value.begin(); it != value.end(); ++it)
        PrintReceiptRows(out, *it, indent, value.is_array() ? "- " : TerminalLabel(it.key()) + ": ");
}

inline std::string FormatWorkbenchReply(const Json &reply, const std::string &command = "") {
    std::ostringstream out;
    const auto status = Field(reply, "status");
    out << (status == "committed" ? "Done" : TerminalLabel(status));
    if (reply.contains("error")) {
        const auto &error = reply.at("error");
        out << " [" << TerminalText(Field(error, "code")) << "]  " << TerminalText(Field(error, "message"));
    }
    out << '\n';
    bool hasContext = false;
    for (auto [key, label] : {std::pair{"page", "Page"}, {"side", "Side"}, {"requestId", "Request"}, {"jobStatus", "Job status"}}) {
        if (!reply.contains(key) || reply.at(key).is_null()) continue;
        if (std::string_view(key) == "requestId" && status == "committed" && command.rfind("job ", 0) != 0) continue;
        out << (hasContext ? "   " : "") << label << ": " << TerminalText(Field(reply, key));
        hasContext = true;
    }
    if (hasContext) out << '\n';
    if (reply.contains("error")) {
        for (const auto &[key, value] : reply.at("error").items())
            if (key != "code" && key != "message") PrintReceiptRows(out, value, "", TerminalLabel(key) + ": ");
    } else if (reply.contains("result") && !reply.at("result").is_null()) {
        const auto &result = reply.at("result");
        if ((command == "help" || command == "commands") && result.is_array()) {
            if (result.empty()) out << "No matching commands.\n";
            for (const auto &row : result) out << "  " << TerminalText(Field(row, "syntax")) << '\n';
        } else if ((command == "fs ls" || command == "fs complete") && result.contains("entries")) {
            out << TerminalText(Field(result, "path")) << "\nPage " << result.at("number")
                << " · " << result.at("total") << " entries\n";
            for (const auto &entry : result.at("entries"))
                out << "  " << TerminalText(Field(entry, "name")) << (entry.value("directory", false) ? "/" : "") << '\n';
        } else if (command == "page list" && result.is_array()) {
            out << (result.empty() ? "No connected pages.\n" : "Connected pages\n");
            for (const auto &page : result) {
                std::string separator = "  ";
                for (const auto key : {"id", "name", "mode", "moduleName"}) {
                    const auto field = Field(page, key);
                    if (field.empty()) continue;
                    out << separator << TerminalText(field);
                    separator = "  ·  ";
                }
                out << '\n';
            }
        }
        else PrintReceiptRows(out, result);
    }
    return out.str();
}
} // namespace ngb
