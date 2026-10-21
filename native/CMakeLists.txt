cmake_minimum_required(VERSION 3.16)

project(netlist_graph_builder_native LANGUAGES CXX)

find_package(Threads REQUIRED)

get_filename_component(NGB_SOURCE_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
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
set(NGB_ASSET_MANIFEST "${CMAKE_CURRENT_BINARY_DIR}/asset_manifest.txt")
string(REPLACE ";" "\n" NGB_ASSET_MANIFEST_CONTENT "${NGB_ASSETS}")
file(GENERATE OUTPUT "${NGB_ASSET_MANIFEST}" CONTENT "${NGB_ASSET_MANIFEST_CONTENT}\n")

add_custom_command(
    OUTPUT "${NGB_ASSET_CPP}"
    COMMAND ${CMAKE_COMMAND}
        "-DNGB_OUTPUT=${NGB_ASSET_CPP}"
        "-DNGB_SOURCE_ROOT=${NGB_SOURCE_ROOT}"
        "-DNGB_ASSET_MANIFEST=${NGB_ASSET_MANIFEST}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_assets.cmake"
    DEPENDS ${NGB_ASSETS} "${NGB_ASSET_MANIFEST}"
            "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_assets.cmake"
    VERBATIM
)

add_executable(ngb
    launcher/main.cpp
    launcher/embedded_assets.hpp
    launcher/ProcessGuard.h
    "${NGB_ASSET_CPP}"
)

target_compile_features(ngb PRIVATE cxx_std_11)
set_target_properties(ngb PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
target_compile_definitions(ngb PRIVATE _FILE_OFFSET_BITS=64)
target_include_directories(ngb PRIVATE launcher)
target_link_libraries(ngb PRIVATE Threads::Threads)

if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_compile_definitions(ngb PRIVATE NGB_LINUX=1)
else()
    message(FATAL_ERROR "The native launcher currently supports Linux only")
endif()

include(GNUInstallDirs)
option(NGB_INSTALL "Install ngb and its EDA Tcl helper" ON)
set(NGB_INSTALL_BINDIR "${CMAKE_INSTALL_BINDIR}" CACHE STRING "ngb installation directory")
set(NGB_INSTALL_DATADIR "${CMAKE_INSTALL_DATADIR}/netlist_graph_builder" CACHE STRING "ngb Tcl helper directory")
if (NGB_INSTALL)
    install(TARGETS ngb RUNTIME DESTINATION "${NGB_INSTALL_BINDIR}")
    install(FILES "${NGB_SOURCE_ROOT}/tools/eda/ngb.tcl" DESTINATION "${NGB_INSTALL_DATADIR}")
endif()

option(NGB_BUILD_TESTS "Build native launcher smoke tests" OFF)
if (NGB_BUILD_TESTS)
    enable_testing()
    add_test(
        NAME ngb-help
        COMMAND ngb --help)
    add_test(
        NAME ngb-licenses
        COMMAND ngb --licenses)
    find_package(Python3 3.6 REQUIRED COMPONENTS Interpreter)
    add_test(NAME ngb-integration
        COMMAND "${Python3_EXECUTABLE}" "${NGB_SOURCE_ROOT}/tests/e2e/native_launcher_e2e.py"
            "$<TARGET_FILE:ngb>" "${NGB_SOURCE_ROOT}")
    set_tests_properties(ngb-integration PROPERTIES TIMEOUT 60)
    add_test(NAME ngb-cmake
        COMMAND "${Python3_EXECUTABLE}" "${NGB_SOURCE_ROOT}/tests/e2e/native_cmake_e2e.py" "${NGB_SOURCE_ROOT}")
    set_tests_properties(ngb-cmake PROPERTIES TIMEOUT 120)
    find_program(NGB_TCLSH tclsh)
    if (NGB_TCLSH)
        add_test(NAME ngb-tcl
            COMMAND "${NGB_TCLSH}" "${NGB_SOURCE_ROOT}/tests/e2e/native_launcher_tcl.test.tcl"
                "$<TARGET_FILE:ngb>" "${NGB_SOURCE_ROOT}/tools/eda/ngb.tcl")
        set_tests_properties(ngb-tcl PROPERTIES TIMEOUT 30)
    else()
        message(STATUS "tclsh not found: ngb-tcl test is unavailable")
    endif()
endif()
