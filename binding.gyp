{
  "targets": [
    {
      "target_name": "rap_proxy",
      "sources": [
        "native/addon.cpp",
        "native/balancer.cpp",
        "native/rate_limiter.cpp",
        "native/backend_state.cpp"
      ],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
      },
      "msvs_settings": {
        "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] }
      }
    }
  ]
}
