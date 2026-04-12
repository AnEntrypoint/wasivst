#pragma once

#include <cstdint>
#include <string>
#include <vector>

enum class FrameTag : uint8_t {
    Load          = 0x01,
    Process       = 0x02,
    ProcessResp   = 0x03,
    SetParam      = 0x04,
    GetParam      = 0x05,
    GetParamResp  = 0x06,
    Log           = 0x07,
};

struct ProcessFrame {
    uint32_t sample_count;
    uint32_t channel_count;
    std::vector<float> samples;
};

struct ParamFrame {
    uint32_t id;
    double   value;
};

class SerialChannel {
public:
    SerialChannel();

    FrameTag      read_next_tag();
    std::string   read_load_frame_body();
    ProcessFrame  read_process_frame_body();
    ParamFrame    read_set_param_frame_body();
    uint32_t      read_get_param_frame_body();

    void write_process_resp(uint32_t sample_count, uint32_t ch_count,
                            const float* const* output_channels);
    void write_get_param_resp(uint32_t id, double value);
    void write_log(uint8_t level, const char* subsystem, const char* message);

private:
    void write_bytes(const void* data, size_t len);
    void read_bytes(void* data, size_t len);

    uint8_t read_tag();
    uint32_t read_u32();
    double   read_f64();
};
