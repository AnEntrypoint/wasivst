#include "serial-channel.h"

#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

SerialChannel::SerialChannel() {}

void SerialChannel::read_bytes(void* data, size_t len) {
    if (fread(data, 1, len, stdin) != len)
        throw std::runtime_error("serial-channel: read_bytes EOF or error");
}

void SerialChannel::write_bytes(const void* data, size_t len) {
    if (fwrite(data, 1, len, stdout) != len)
        throw std::runtime_error("serial-channel: write_bytes error");
    fflush(stdout);
}

FrameTag SerialChannel::read_next_tag() {
    return static_cast<FrameTag>(read_tag());
}

uint8_t SerialChannel::read_tag() {
    uint8_t tag;
    read_bytes(&tag, 1);
    return tag;
}

uint32_t SerialChannel::read_u32() {
    uint32_t v;
    read_bytes(&v, 4);
    return v;
}

double SerialChannel::read_f64() {
    double v;
    read_bytes(&v, 8);
    return v;
}

std::string SerialChannel::read_load_frame_body() {
    const uint32_t len = read_u32();
    std::string path(len, '\0');
    read_bytes(path.data(), len);
    return path;
}

ProcessFrame SerialChannel::read_process_frame_body() {
    ProcessFrame f;
    f.sample_count   = read_u32();
    f.channel_count  = read_u32();
    const uint32_t audio_bytes = read_u32();
    f.samples.resize(audio_bytes / 4);
    read_bytes(f.samples.data(), audio_bytes);
    return f;
}

ParamFrame SerialChannel::read_set_param_frame_body() {
    ParamFrame p;
    p.id    = read_u32();
    p.value = read_f64();
    return p;
}

uint32_t SerialChannel::read_get_param_frame_body() {
    return read_u32();
}

void SerialChannel::write_process_resp(uint32_t sample_count, uint32_t ch_count,
                                       const float* const* channels) {
    const uint8_t tag = static_cast<uint8_t>(FrameTag::ProcessResp);
    write_bytes(&tag, 1);
    write_bytes(&sample_count, 4);
    write_bytes(&ch_count, 4);
    for (uint32_t c = 0; c < ch_count; ++c)
        write_bytes(channels[c], sample_count * sizeof(float));
}

void SerialChannel::write_get_param_resp(uint32_t id, double value) {
    const uint8_t tag = static_cast<uint8_t>(FrameTag::GetParamResp);
    write_bytes(&tag, 1);
    write_bytes(&id, 4);
    write_bytes(&value, 8);
}

void SerialChannel::write_log(uint8_t level, const char* subsystem, const char* message) {
    const uint8_t tag = static_cast<uint8_t>(FrameTag::Log);
    write_bytes(&tag, 1);
    write_bytes(&level, 1);
    const uint32_t sub_len = static_cast<uint32_t>(strlen(subsystem));
    const uint32_t msg_len = static_cast<uint32_t>(strlen(message));
    write_bytes(&sub_len, 4);
    write_bytes(subsystem, sub_len);
    write_bytes(&msg_len, 4);
    write_bytes(message, msg_len);
}
