// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScholiaMac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ScholiaMac", targets: ["ScholiaMac"])
    ],
    targets: [
        .executableTarget(name: "ScholiaMac")
    ]
)
