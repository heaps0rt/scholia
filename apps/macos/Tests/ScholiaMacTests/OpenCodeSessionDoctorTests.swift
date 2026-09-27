import Foundation
import SQLite3
import XCTest
@testable import ScholiaMac

final class OpenCodeSessionDoctorTests: XCTestCase {
    func testScanStripAndBackupUseCurrentOpencodeSchema() throws {
        let fixture = try makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }

        let findings = try OpenCodeSessionDoctor.scan(databaseURL: fixture.database)
        XCTAssertEqual(findings.map(\.partID), ["file-bad", "tool-mixed"])
        XCTAssertEqual(findings.map(\.sessionTitle), ["Poisoned session", "Poisoned session"])
        XCTAssertEqual(findings[0].mimeType, "application/pdf")
        XCTAssertEqual(findings[0].byteCount, 3)

        let backup = try OpenCodeSessionDoctor.backup(
            databaseURL: fixture.database,
            destinationDirectory: fixture.directory.appendingPathComponent("backups")
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: backup.path))
        let backupConnection = try SQLite3.open(url: backup, readOnly: true)
        XCTAssertEqual(try SQLite3.query(backupConnection, sql: "SELECT count(*) FROM part")[0][0] as? Int, 4)
        sqlite3_close(backupConnection)

        XCTAssertEqual(
            try OpenCodeSessionDoctor.stripAttachments(findings, databaseURL: fixture.database),
            2
        )
        XCTAssertTrue(try OpenCodeSessionDoctor.scan(databaseURL: fixture.database).isEmpty)

        let connection = try SQLite3.open(url: fixture.database, readOnly: true)
        defer { sqlite3_close(connection) }
        XCTAssertTrue(try SQLite3.query(
            connection,
            sql: "SELECT count(*) FROM part WHERE id = 'file-bad'"
        )[0][0] as? Int == 0)
        let serialized = try XCTUnwrap(try SQLite3.query(
            connection,
            sql: "SELECT data FROM part WHERE id = 'tool-mixed'"
        )[0][0] as? String)
        let part = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any])
        let state = try XCTUnwrap(part["state"] as? [String: Any])
        let attachments = try XCTUnwrap(state["attachments"] as? [[String: Any]])
        XCTAssertEqual(attachments.count, 1)
        XCTAssertEqual(attachments[0]["name"] as? String, "safe.png")
    }

    func testDeleteSessionClearsEverySessionIDTableAtomically() throws {
        let fixture = try makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }

        XCTAssertEqual(
            try OpenCodeSessionDoctor.deleteSessions(["session-1", "session-1"], databaseURL: fixture.database),
            1
        )
        let connection = try SQLite3.open(url: fixture.database, readOnly: true)
        defer { sqlite3_close(connection) }
        for table in ["session", "message", "part", "session_input"] {
            let count = try SQLite3.query(connection, sql: "SELECT count(*) FROM \(table)")[0][0] as? Int
            XCTAssertEqual(count, 0, "Expected \(table) to be empty")
        }
    }

    func testDiagnosisAllowsSmallImagesAndRejectsOtherOrOversizedDataURLs() throws {
        XCTAssertNil(OpenCodeSessionDoctor.diagnose(dataURL: "data:image/png;base64,aW1n"))
        let pdf = try XCTUnwrap(OpenCodeSessionDoctor.diagnose(dataURL: "data:application/pdf;base64,cGRm"))
        XCTAssertEqual(pdf.mimeType, "application/pdf")
        XCTAssertEqual(pdf.byteCount, 3)
        let oversized = "data:image/png;base64," + String(
            repeating: "A",
            count: ((OpenCodeSessionDoctor.maximumSafeDataURLBytes + 1) * 4 / 3) + 8
        )
        XCTAssertNotNil(OpenCodeSessionDoctor.diagnose(dataURL: oversized))
    }

    private func makeFixture() throws -> (directory: URL, database: URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scholia-doctor-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let database = directory.appendingPathComponent("opencode.db")
        let connection = try SQLite3.open(url: database, readOnly: false, createIfMissing: true)
        defer { sqlite3_close(connection) }
        try SQLite3.execute(connection, sql: "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT)")
        try SQLite3.execute(connection, sql: "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT)")
        try SQLite3.execute(connection, sql: "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_updated INTEGER, data TEXT)")
        try SQLite3.execute(connection, sql: "CREATE TABLE session_input (id TEXT PRIMARY KEY, session_id TEXT)")
        try SQLite3.execute(connection, sql: "INSERT INTO session VALUES (?, ?)", parameters: ["session-1", "Poisoned session"])
        try SQLite3.execute(connection, sql: "INSERT INTO message VALUES (?, ?)", parameters: ["message-1", "session-1"])
        try SQLite3.execute(connection, sql: "INSERT INTO session_input VALUES (?, ?)", parameters: ["input-1", "session-1"])

        let badFile: [String: Any] = [
            "type": "file", "mime": "application/pdf", "filename": "notes.pdf",
            "url": "data:application/pdf;base64,cGRm"
        ]
        let safeFile: [String: Any] = [
            "type": "file", "mime": "image/png", "filename": "small.png",
            "url": "data:image/png;base64,aW1n"
        ]
        let mixedTool: [String: Any] = [
            "type": "tool", "tool": "read",
            "state": ["attachments": [
                ["name": "unsafe.txt", "url": "data:text/plain;base64,dGV4dA=="],
                ["name": "safe.png", "url": "data:image/png;base64,aW1n"]
            ]]
        ]
        let incidentalTool: [String: Any] = [
            "type": "tool", "tool": "bash",
            "state": ["output": "documentation mentions data:text/plain;base64, but has no attachments"]
        ]
        for (id, value) in [
            ("file-bad", badFile),
            ("file-safe", safeFile),
            ("tool-mixed", mixedTool),
            ("tool-incidental", incidentalTool)
        ] {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            let serialized = try XCTUnwrap(String(data: data, encoding: .utf8))
            try SQLite3.execute(
                connection,
                sql: "INSERT INTO part VALUES (?, ?, ?, 0, ?)",
                parameters: [id, "message-1", "session-1", serialized]
            )
        }
        return (directory, database)
    }
}
