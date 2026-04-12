#pragma once

#include <string>
#include "../ipc/serial-channel.h"

class Vst2Host {
public:
    Vst2Host(const std::string& dll_path, SerialChannel& ch);
    ~Vst2Host();

    void run();

private:
    void process_block(const ProcessFrame& frame);
    void handle_set_param(const ParamFrame& p);
    void handle_get_param(uint32_t id);

    SerialChannel& ch_;
    void*          lib_handle_  = nullptr;
    void*          aeffect_     = nullptr;
};
