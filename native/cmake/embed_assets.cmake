if (NOT DEFINED NGB_OUTPUT OR NOT DEFINED NGB_SOURCE_ROOT)
    message(FATAL_ERROR "NGB_OUTPUT and NGB_SOURCE_ROOT are required")
endif()

file(GLOB_RECURSE NGB_SOURCE_ASSETS
    "${NGB_SOURCE_ROOT}/src/*.js")

set(NGB_ASSETS
    "${NGB_SOURCE_ROOT}/index.html"
    "${NGB_SOURCE_ROOT}/styles.css"
    ${NGB_SOURCE_ASSETS}
    "${NGB_SOURCE_ROOT}/vendor/elkjs-0.11.1/lib/elk.bundled.js"
    "${NGB_SOURCE_ROOT}/vendor/elkjs-0.11.1/LICENSE.md")
list(SORT NGB_ASSETS)

get_filename_component(NGB_OUTPUT_DIR "${NGB_OUTPUT}" DIRECTORY)
file(MAKE_DIRECTORY "${NGB_OUTPUT_DIR}")
file(WRITE "${NGB_OUTPUT}"
"#include \"embedded_assets.hpp\"\n\n"
"namespace ngb {\n\n")

set(NGB_INDEX 0)
foreach (NGB_ASSET IN LISTS NGB_ASSETS)
    if (NOT EXISTS "${NGB_ASSET}")
        message(FATAL_ERROR "Embedded asset does not exist: ${NGB_ASSET}")
    endif()

    file(RELATIVE_PATH NGB_ROUTE "${NGB_SOURCE_ROOT}" "${NGB_ASSET}")
    string(REPLACE "\\" "/" NGB_ROUTE "${NGB_ROUTE}")
    file(READ "${NGB_ASSET}" NGB_HEX HEX)
    string(REGEX REPLACE "([0-9A-Fa-f][0-9A-Fa-f])" "0x\\1," NGB_BYTES "${NGB_HEX}")

    file(APPEND "${NGB_OUTPUT}"
        "static const unsigned char ngb_asset_${NGB_INDEX}[] = {\n"
        "${NGB_BYTES}\n"
        "};\n\n")
    file(APPEND "${NGB_OUTPUT}"
        "static const EmbeddedAsset ngb_asset_record_${NGB_INDEX} = {\n"
        "    \"${NGB_ROUTE}\",\n"
        "    ngb_asset_${NGB_INDEX},\n"
        "    sizeof(ngb_asset_${NGB_INDEX})\n"
        "};\n\n")
    math(EXPR NGB_INDEX "${NGB_INDEX} + 1")
endforeach()

file(APPEND "${NGB_OUTPUT}" "static const EmbeddedAsset ngb_assets[] = {\n")
if (NGB_INDEX GREATER 0)
    math(EXPR NGB_LAST "${NGB_INDEX} - 1")
    foreach (NGB_RECORD RANGE 0 ${NGB_LAST})
        file(APPEND "${NGB_OUTPUT}" "    ngb_asset_record_${NGB_RECORD},\n")
    endforeach()
endif()
file(APPEND "${NGB_OUTPUT}"
    "};\n\n"
    "const EmbeddedAsset* findEmbeddedAsset(const std::string& route) {\n"
    "    for (std::size_t index = 0; index < sizeof(ngb_assets) / sizeof(ngb_assets[0]); ++index) {\n"
    "        if (route == ngb_assets[index].route) return &ngb_assets[index];\n"
    "    }\n"
    "    return 0;\n"
    "}\n\n"
    "}  // namespace ngb\n")
