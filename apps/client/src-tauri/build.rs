fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        use std::{path::PathBuf, process::Command};
        let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let object = out.join("mouse_capture.o");
        let library = out.join("libmouse_capture.a");
        let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
            "aarch64" => "arm64",
            "x86_64" => "x86_64",
            other => panic!("unsupported macOS architecture: {other}"),
        };
        assert!(Command::new("xcrun")
            .args(["--sdk", "macosx", "clang", "-arch", arch, "-fobjc-arc", "-fblocks", "-c", "src/mouse_capture.m", "-o"])
            .arg(&object)
            .status()
            .expect("run clang")
            .success());
        assert!(Command::new("xcrun").args(["ar", "crs"]).arg(&library).arg(&object).status().expect("run ar").success());
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=mouse_capture");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rerun-if-changed=src/mouse_capture.m");
    }
    tauri_build::build()
}
