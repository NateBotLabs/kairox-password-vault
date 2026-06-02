fn main() {
    // tauri-build on Windows requires icons/icon.ico to exist before it can embed
    // a Windows resource. Create a minimal placeholder if the real icon isn't present.
    create_placeholder_icons();
    tauri_build::build()
}

fn create_placeholder_icons() {
    let dir = std::path::Path::new("icons");
    std::fs::create_dir_all(dir).unwrap();

    let ico = dir.join("icon.ico");
    if !ico.exists() {
        std::fs::write(ico, PLACEHOLDER_ICO).unwrap();
    }

    // PNG / ICNS placeholders (needed for tauri bundle; not needed for cargo check)
    for name in &["32x32.png", "128x128.png", "icon.icns"] {
        let p = dir.join(name);
        if !p.exists() {
            // Write the ICO bytes with a .png/.icns extension — only used as a
            // file-existence placeholder until real icons are provided.
            std::fs::write(p, PLACEHOLDER_ICO).unwrap();
        }
    }
}

/// Minimal valid 1×1 32-bit ICO (70 bytes, indigo pixel).
/// ICONDIR (6) + ICONDIRENTRY (16) + BITMAPINFOHEADER (40) + XOR mask (4) + AND mask (4).
static PLACEHOLDER_ICO: &[u8] = &[
    // ICONDIR
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    // ICONDIRENTRY: 1×1 px, 32 bpp, data size = 48, data offset = 22
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00,
    0x30, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    // BITMAPINFOHEADER
    0x28, 0x00, 0x00, 0x00, // biSize = 40
    0x01, 0x00, 0x00, 0x00, // biWidth = 1
    0x02, 0x00, 0x00, 0x00, // biHeight = 2 (ICO doubles height)
    0x01, 0x00,             // biPlanes = 1
    0x20, 0x00,             // biBitCount = 32
    0x00, 0x00, 0x00, 0x00, // biCompression = BI_RGB
    0x08, 0x00, 0x00, 0x00, // biSizeImage = 8 (4 XOR + 4 AND)
    0x00, 0x00, 0x00, 0x00, // biXPelsPerMeter
    0x00, 0x00, 0x00, 0x00, // biYPelsPerMeter
    0x00, 0x00, 0x00, 0x00, // biClrUsed
    0x00, 0x00, 0x00, 0x00, // biClrImportant
    // XOR mask: BGRA indigo pixel (B=0x63, G=0x66, R=0xF1, A=0xFF)
    0x63, 0x66, 0xF1, 0xFF,
    // AND mask: 4 bytes, all 0 = opaque
    0x00, 0x00, 0x00, 0x00,
];
