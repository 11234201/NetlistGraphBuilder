#pragma once

#include <cstddef>
#include <string>

namespace ngb {

struct EmbeddedAsset {
    const char* route;
    const unsigned char* data;
    std::size_t size;
};

const EmbeddedAsset* findEmbeddedAsset(const std::string& route);

}  // namespace ngb
