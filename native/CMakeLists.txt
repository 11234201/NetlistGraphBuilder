cmake_minimum_required(VERSION 3.16)

project(netlist_graph_builder_native LANGUAGES CXX)

find_package(Threads REQUIRED)

set(NGB_SOURCE_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
set(NGB_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(NGB_ASSET_CPP "${NGB_GENERATED_DIR}/embedded_assets.cpp")

file(GLOB_RECURSE NGB_SOURCE_ASSETS CONFIGURE_DEPENDS
    "${NGB_SOURCE_ROOT}/src/*.js")

set(NGB_ASSETS
    "${NGB_SOURCE_ROOT}/index.html"
    "${NGB_SOURCE_ROOT}/styles.css"
    ${NGB_SOURCE_ASSETS}
    "${NGB_SOURCE_ROOT}/vendor/elkjs-0.11.1/lib/elk.bundled.js"
    "${NGB_SOURCE_ROOT}/vendor/elkjs-0.11.1/LICENSE.md")
list(SORT NGB_ASSETS)

add_custom_command(
    OUTPUT "${NGB_ASSET_CPP}"
    COMMAND ${CMAKE_COMMAND}
        "-DNGB_OUTPUT=${NGB_ASSET_CPP}"
        "-DNGB_SOURCE_ROOT=${NGB_SOURCE_ROOT}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_assets.cmake"
    DEPENDS ${NGB_ASSETS}
            "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_assets.cmake"
    VERBATIM
)

add_executable(ngb
    launcher/main.cpp
    launcher/embedded_assets.hpp
    "${NGB_ASSET_CPP}"
)

target_compile_features(ngb PRIVATE cxx_std_11)
target_compile_definitions(ngb PRIVATE _FILE_OFFSET_BITS=64)
target_include_directories(ngb PRIVATE launcher)
target_link_libraries(ngb PRIVATE Threads::Threads)

if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_compile_definitions(ngb PRIVATE NGB_LINUX=1)
else()
    message(FATAL_ERROR "The native launcher currently supports Linux only")
endif()

include(GNUInstallDirs)
install(TARGETS ngb
    RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

option(NGB_BUILD_TESTS "Build native launcher smoke tests" OFF)
if (NGB_BUILD_TESTS)
    enable_testing()
    add_test(
        NAME ngb-help
        COMMAND ngb --help)
    add_test(
        NAME ngb-licenses
        COMMAND ngb --licenses)
endif()
