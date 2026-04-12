#pragma once

#include <string>
#include "../ipc/serial-channel.h"

class Vst3Host {
public:
    Vst3Host(const std::string& bundle_path, SerialChannel& ch);
    ~Vst3Host();
    void run();

private:
    SerialChannel& ch_;
    void*          lib_handle_  = nullptr;
    void*          factory_     = nullptr;
    void*          component_   = nullptr;
    void*          processor_   = nullptr;
};
