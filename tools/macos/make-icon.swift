import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: make-icon.swift SOURCE_PNG OUTPUT_ICONSET\n", stderr)
    exit(2)
}

let sourcePath = CommandLine.arguments[1]
let outputDirectory = CommandLine.arguments[2]
guard let source = NSImage(contentsOfFile: sourcePath) else {
    fputs("unable to load source image\n", stderr)
    exit(1)
}

let variants: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

try FileManager.default.createDirectory(
    atPath: outputDirectory,
    withIntermediateDirectories: true
)

for (name, size) in variants {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "PandamateIcon", code: 1)
    }
    NSGraphicsContext.saveGraphicsState()
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "PandamateIcon", code: 2)
    }
    context.imageInterpolation = .high
    NSGraphicsContext.current = context
    source.draw(
        in: NSRect(x: 0, y: 0, width: size, height: size),
        from: NSRect(origin: .zero, size: source.size),
        operation: .copy,
        fraction: 1
    )
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PandamateIcon", code: 3)
    }
    try data.write(
        to: URL(fileURLWithPath: outputDirectory).appendingPathComponent(name)
    )
}
