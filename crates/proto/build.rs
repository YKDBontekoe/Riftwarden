//! Compile proto/ with protox (pure Rust, no protoc binary) and generate prost types.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../proto");
    let files: Vec<_> = std::fs::read_dir(root.join("riftwarden/v1"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "proto"))
        .collect();
    for f in &files {
        println!("cargo:rerun-if-changed={}", f.display());
    }
    let fds = protox::compile(&files, [&root])?;
    prost_build::Config::new().compile_fds(fds)?;
    Ok(())
}
