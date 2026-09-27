@preconcurrency import AppKit

@testable import ScholiaMac

extension StudyWorkspaceSmoke {
    static func checkCanvasFavorites() async throws {
        CanvasFixtureProtocol.state.revision = 1
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CanvasFixtureProtocol.self]
        let client = CanvasClient(
            origin: try CanvasAddress.origin("canvas.ntnu.no"), token: "fixture-token",
            session: URLSession(configuration: config))
        let remote = try await client.courses()
        precondition(remote.first { $0.id == 12 }?.favorite == true, "Canvas stars must survive course pagination")
        precondition(remote.first { $0.id == 11 }?.favorite == nil, "Omitted favorite metadata must remain unknown")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("scholia-favorites-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = StudyWorkspaceModel(store: StudyLibraryStore(root: root))
        workspace.loadCanvasCourses(clientOverride: client)
        for _ in 0..<500 where workspace.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        let canvasCourse = workspace.library.courses.first { $0.canvasID == 12 }!
        let localCourse = workspace.library.courses.first { $0.canvasID == 11 }!
        precondition(canvasCourse.isFavorite && canvasCourse.favorite == nil && canvasCourse.canvasFavorite == true)
        workspace.toggleFavorite(canvasCourse.id)
        workspace.toggleFavorite(localCourse.id)
        workspace.loadCanvasCourses(clientOverride: client)
        for _ in 0..<500 where workspace.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        precondition(
            workspace.library.courses.first { $0.id == canvasCourse.id }?.isFavorite == false,
            "A local unstar must survive Canvas refresh")
        precondition(
            workspace.library.courses.first { $0.id == localCourse.id }?.isFavorite == true,
            "A local favorite must survive Canvas refresh")
        let ci = workspace.library.courses.firstIndex { $0.id == canvasCourse.id }!
        workspace.library.courses[ci].favorite = nil
        CanvasFixtureProtocol.state.revision = 2
        workspace.loadCanvasCourses(clientOverride: client)
        for _ in 0..<500 where workspace.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        precondition(
            !workspace.library.courses[ci].isFavorite,
            "Courses without a local override must follow a removed Canvas star")
        workspace.flush()
        let reopened = StudyWorkspaceModel(store: workspace.store)
        precondition(reopened.library.courses.first { $0.id == localCourse.id }?.isFavorite == true)
        precondition(reopened.library.courses[ci].canvasFavorite == false)
        CanvasFixtureProtocol.state.revision = 1
        print("PASS: Canvas favorites import, pagination, local overrides, remote changes and persistence")
    }

    static func assignmentClient() throws -> CanvasClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AssignmentFixtureProtocol.self]
        return CanvasClient(
            origin: try CanvasAddress.origin("canvas.example"), token: "fixture-token",
            session: URLSession(configuration: config))
    }

    static func checkAssignments() async throws {
        let client = try assignmentClient()
        AssignmentFixtureProtocol.state.revision = 1
        AssignmentFixtureProtocol.state.reset()
        let catalog = try await client.catalog(courseID: 1)
        precondition(catalog.warnings.isEmpty && catalog.completeKinds.contains(.assignments))
        precondition(
            catalog.items.count == 8, "Pagination must include every visible assignment, including locked work")
        precondition(AssignmentFixtureProtocol.state.paths.contains { $0.contains("page=2") })
        var course = StudyCourse(
            name: "Linear algebra", code: "MATH101", canvasID: 1, canvasOrigin: "https://canvas.example",
            canvasMaterials: catalog.items, catalogUpdatedAt: Date(), term: "2026 HØST")
        let pending = StudyAssignment.list(courses: [course])
        precondition(pending.map(\.material.remoteID) == ["2", "9", "1", "7"])
        precondition(StudyAssignment.list(courses: [course], includeCompleted: true).count == 6)
        precondition(StudyAssignment.list(courses: [course], query: "MATH101").count == 4)
        precondition(StudyAssignment.list(courses: [course], query: "Exercise 9").count == 1)
        var anotherCourse = course
        anotherCourse.id = UUID()
        anotherCourse.code = "CS101"
        anotherCourse.term = "2025 HØST"
        anotherCourse.canvasMaterials = [catalog.items.first { $0.remoteID == "9" }!]
        let dashboard = StudyAssignment.list(courses: [course, anotherCourse], dueOnly: true)
        precondition(
            dashboard.count == 4 && Set(dashboard.map(\.id)).count == 4,
            "Dashboard deadlines span every workspace without conflating assignment IDs")
        precondition(
            dashboard.first?.material.remoteID == "2" && dashboard.last?.material.remoteID == "1",
            "Overdue and upcoming work stays in deadline order")
        precondition(
            dashboard.allSatisfy { $0.dueDate != nil && $0.details?.status.isComplete == false },
            "The dashboard excludes undated and completed work")
        let locked = catalog.items.first { $0.remoteID == "1" }!
        precondition(locked.assignment?.dueAt == "2026-09-29T12:00:00+02:00")
        precondition(locked.unavailableReason == "Locked in Canvas")
        let now = CanvasAssignmentDetails.date("2026-09-27T10:00:00.000Z")!
        let groups = StudyAssignmentGroup.make(courses: [course, anotherCourse], now: now)
        precondition(groups.map { $0.semester.id } == ["2026-autumn", "2025-autumn", "2026-autumn"])
        precondition(groups.map { $0.items.map(\.material.remoteID) } == [["9", "1"], ["9"], ["2"]])
        precondition(groups.map(\.timeframe) == [.upcoming, .upcoming, .overdue])
        let archived = StudyAssignmentGroup.make(courses: [course], filter: .archive, now: now).flatMap(\.items)
        precondition(
            archived.map(\.material.remoteID) == ["3", "4", "7"], "Undated and completed work belongs in Archive")
        let handedIn = StudyAssignmentGroup.make(courses: [course], filter: .handedIn, now: now).flatMap(\.items)
        precondition(
            handedIn.map(\.material.remoteID) == ["3"],
            "Handed in must exclude excused, missing and unknown submissions")
        precondition(StudyAssignmentGroup.make(courses: [course], filter: .all, now: now).flatMap(\.items).count == 6)
        precondition(CanvasAssignmentDetails(record: [:]).status == .unknown)
        precondition(CanvasAssignmentDetails(record: ["submission": ["workflow_state": "graded"]]).status.isHandedIn)
        precondition(
            CanvasAssignmentDetails(record: ["submission": ["workflow_state": "pending_review"]]).status == .submitted)
        precondition(!CanvasSubmissionStatus.excused.isHandedIn && !CanvasSubmissionStatus.unknown.isComplete)
        var spanning = course
        spanning.term = "2026 HØST|2027 VÅR"
        var spring = locked
        spring.id = "assignments:spring"
        spring.assignment?.dueAt = "2027-02-01T12:00:00Z"
        var boundary = locked
        boundary.id = "assignments:now"
        boundary.assignment?.dueAt = "2026-09-27T12:00:00+02:00"
        spanning.canvasMaterials = [locked, spring, boundary, catalog.items.first { $0.remoteID == "2" }!]
        let multiTerm = StudyAssignmentGroup.make(courses: [spanning], now: now)
        precondition(
            multiTerm.map { $0.semester.id } == ["2026-autumn", "2027-spring", "2026-autumn"]
                && multiTerm.flatMap(\.items).count == 4)
        precondition(
            multiTerm.last?.items.map(\.material.id) == [boundary.id, "assignments:2"],
            "Overdue work follows all upcoming deadlines, newest overdue first")
        precondition(StudyAssignmentGroup.make(courses: [spanning], filter: .archive, now: now).isEmpty)
        precondition(locked.assignment?.availability(at: now) == "Not open yet")
        precondition(
            pending[0].details?.status == .notSubmitted, "A missing assignment graded zero still needs submission")
        precondition(pending[0].details?.statusLabel(at: now) == "Overdue")
        precondition(CanvasAssignmentDetails.date("2026-09-27T12:00:00+02:00") == now)
        precondition(CanvasAssignmentDetails.date("2026-09-27T12:00:00.123+02:00")!.timeIntervalSince(now) > 0.122)
        precondition(CanvasAssignmentDetails.date("invalid") == nil && CanvasAssignmentDetails.date(nil) == nil)

        AssignmentFixtureProtocol.state.revision = 2
        let refreshed = try await client.catalog(courseID: 1)
        let changes = CanvasCatalogChanges.reconcile(previous: catalog.items, catalog: refreshed)
        precondition(
            changes.changes.updated.contains("assignments:1") && changes.changes.updated.contains("assignments:9"),
            "Date and submission changes count even when updated_at is unchanged")
        precondition(
            changes.items.first { $0.remoteID == "1" }?.assignment?.dueAt == nil,
            "Removing a deadline must clear the old date")
        precondition(
            changes.items.first { $0.remoteID == "1" }?.version != locked.version,
            "Downloaded descriptions must not retain an old Due line")
        let refreshedDescription = try await client.material(refreshed.items.first { $0.remoteID == "9" }!, courseID: 1)
        precondition(refreshedDescription.version == refreshed.items.first { $0.remoteID == "9" }?.version)
        course.canvasMaterials = changes.items
        precondition(!StudyAssignment.list(courses: [course]).contains { $0.material.remoteID == "9" })

        let fallback = try await client.catalog(courseID: 2)
        precondition(!fallback.warnings.isEmpty && !fallback.completeKinds.contains(.assignments))
        precondition(fallback.items.first?.assignment?.dueAt == "2026-09-28T18:00:00Z")
        precondition(fallback.items.first?.moduleID == 55)
        let partial = try await client.catalog(courseID: 3)
        let retained = CanvasCatalogChanges.reconcile(previous: fallback.items, catalog: partial)
        precondition(
            retained.items.first?.assignment == fallback.items.first?.assignment,
            "Failed metadata requests must not erase known deadlines")

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("scholia-assignments-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = StudyLibraryStore(root: root)
        try store.save(StudyLibrary(courses: [course], showingCourseLibrary: true, courseLibraryView: .assignments))
        let workspace = StudyWorkspaceModel(store: store)
        workspace.selectSemester("2026-autumn")
        workspace.flush()
        let reopened = StudyWorkspaceModel(store: store)
        precondition(reopened.courseLibraryView == .assignments && reopened.selectedSemesterID == "2026-autumn")
        precondition(reopened.library.courses[0].materials == changes.items)
        let dateGroups = StudyAssignmentDateGroup.make(pending)
        precondition(dateGroups.flatMap(\.items).count == pending.count && dateGroups.last?.date == nil)
        workspace.setAssignmentHidden("assignments:1", courseID: course.id, hidden: true)
        workspace.flush()
        let hiddenReopen = StudyWorkspaceModel(store: store)
        precondition(
            !StudyAssignment.list(courses: hiddenReopen.library.courses).contains { $0.material.id == "assignments:1" })
        precondition(
            StudyAssignmentGroup.make(courses: hiddenReopen.library.courses, filter: .hidden).flatMap(\.items).map(
                \.material.id) == ["assignments:1"])
        let completeList = StudyAssignment.list(
            courses: hiddenReopen.library.courses, includeCompleted: true, includeHidden: true)
        let completeAgenda = StudyAssignmentGroup.make(
            courses: hiddenReopen.library.courses, filter: .all
        ).flatMap(\.items)
        precondition(
            completeList.count == StudyAssignment.list(courses: [course], includeCompleted: true).count,
            "The complete course list must retain every assignment after hiding one")
        precondition(
            completeList.contains { $0.material.id == "assignments:1" && $0.isHidden },
            "All assignments must expose hidden rows with their actual visibility state")
        precondition(
            Set(completeAgenda.map(\.id)) == Set(completeList.map(\.id)),
            "The sidebar All filter must include the same complete list as the course view")
        precondition(completeAgenda.contains { $0.material.id == "assignments:1" && $0.isHidden })
        hiddenReopen.setAssignmentHidden("assignments:1", courseID: course.id, hidden: false)
        precondition(
            StudyAssignment.list(courses: hiddenReopen.library.courses).contains {
                $0.material.id == "assignments:1" && !$0.isHidden
            }, "Unhiding must restore the assignment to standard lists and clear its hidden state")

        var old = try JSONSerialization.jsonObject(with: JSONEncoder().encode(locked)) as! [String: Any]
        old.removeValue(forKey: "assignment")
        let legacy = try JSONDecoder().decode(
            CanvasMaterialReference.self, from: JSONSerialization.data(withJSONObject: old))
        precondition(legacy.assignment == nil, "Libraries saved before deadlines were added must remain readable")
        try await checkAssignmentOpening()
    }

    static func checkAssignmentOpening() async throws {
        let links =
            #"<a href="/courses/1/files/501/download?download_frd=1&amp;x=2" data-api-endpoint="https://canvas.example/api/v1/courses/1/files/501">PDF</a><iframe src='/files/502/preview'></iframe><a href="https://evil.example/files/503">Other origin</a><a href="/courses/2/files/504">Other course</a><a href="javascript:alert(1)">Bad</a>"#
        precondition(
            CanvasAssignmentDetails.linkedFiles(in: links, origin: URL(string: "https://canvas.example")!, courseID: 1)
                == ["501", "502"])
        AssignmentFixtureProtocol.attachments.set(data: try fixturePDF(), fail: false)
        AssignmentFixtureProtocol.state.revision = 1
        let client = try assignmentClient()
        let catalog = try await client.catalog(courseID: 1)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("scholia-assignment-opening-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let course = StudyCourse(
            name: "Assignment fixture", canvasID: 1, canvasOrigin: "https://canvas.example",
            canvasMaterials: catalog.items)
        let store = StudyLibraryStore(root: root)
        try store.save(StudyLibrary(courses: [course], showingCourseLibrary: true))
        let workspace = StudyWorkspaceModel(store: store)
        let assignment = catalog.items.first { $0.remoteID == "9" }!
        @MainActor func settle() async throws {
            for _ in 0..<500 where workspace.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
            precondition(!workspace.canvasBusy, "Assignment opening must settle")
        }
        workspace.openAssignment(assignment, courseID: course.id, clientOverride: client)
        try await settle()
        precondition(
            workspace.assignment?.id == assignment.id && workspace.document?.kind == .pdf
                && workspace.document?.sourceKey == "files:501",
            "Opening an assignment must automatically download and select its first PDF")
        precondition(
            workspace.assignmentText.contains("Show your work")
                && workspace.assignmentPDFs.map(\.id) == ["files:501", "files:502"])
        precondition(workspace.assignmentNotice == nil)
        precondition(
            workspace.assignmentFiles.map(\.id) == ["files:501", "files:502", "files:503", "files:504", "files:505"],
            "Included files must retain PDFs, source inputs and potential data in link order")
        let input = workspace.course!.documents.first { $0.sourceKey == "files:504" }!
        let potential = workspace.course!.documents.first { $0.sourceKey == "files:505" }!
        precondition(
            input.kind == .code && potential.kind == .code,
            "Unknown-extension UTF-8 simulation inputs and data must be readable without executing them")
        let originalInput = try Data(contentsOf: store.file(for: input))
        precondition(originalInput == Data(AssignmentFixtureProtocol.textFile("504").utf8))
        var contextCourse = workspace.course!
        let unrelated = try StudyDocumentImporter.read(
            data: Data("Unrelated course sentinel".utf8), name: "Unrelated.md", store: store)
        contextCourse.documents.append(unrelated)
        let context = StudyContextBuilder.build(
            document: workspace.document, index: try store.index(for: workspace.document!), currentPage: 1,
            question: "Help me understand this assignment", selection: "", course: contextCourse, store: store,
            includeCourse: false, assignment: workspace.assignment)
        precondition(
            context.text.contains("Show your work") && context.text.contains("units metal")
                && context.text.contains("pair_coeff * * Ni.eam")
                && context.text.contains("Nickel EAM potential fixture"),
            "A generic companion question must include instructions and actual linked-file contents with course context off"
        )
        precondition(
            context.sources.contains { $0.documentID == input.id }
                && context.sources.contains { $0.documentID == potential.id }
                && !context.text.contains("Unrelated course sentinel"))
        precondition(
            Set(context.sources.map(\.id)).count == context.sources.count,
            "Assignment references must not duplicate the current document or each other")
        let instructionsOnly = StudyContextBuilder.build(
            document: nil, index: nil, currentPage: 1,
            question: "Help me", selection: "", course: contextCourse, store: store,
            includeCourse: false, assignment: workspace.assignment)
        precondition(
            instructionsOnly.text.utf16.count <= StudyContextBuilder.assignmentBudget + 200,
            "Assignment context must remain within its separate bounded budget")
        workspace.navigate(to: StudySource(documentID: input.id, title: input.title, page: 1))
        precondition(
            workspace.assignment?.id == assignment.id && workspace.library.selectedAssignmentFileID == "files:504",
            "Following an included-file citation preserves assignment context")
        let owner = workspace.draftOwner
        workspace.library.selectedAssignmentID = "assignments:2"
        do {
            try workspace.validateDraftOwner(owner)
            preconditionFailure("A draft from another assignment must be rejected even on the same file")
        } catch {}
        workspace.library.selectedAssignmentID = assignment.id
        workspace.openAssignment(
            workspace.assignment!, courseID: course.id, fileID: "files:501", clientOverride: client)
        workspace.navigate(to: StudySource(documentID: input.id, title: input.title, page: 1))
        try await settle()
        precondition(
            workspace.document?.id == input.id && workspace.library.selectedAssignmentFileID == "files:504",
            "Late assignment preparation must not replace an included file selected through a citation")
        workspace.openAssignmentFile("files:504")
        try await settle()
        precondition(
            workspace.assignment?.id == assignment.id && workspace.document?.id == input.id
                && workspace.library.selectedAssignmentFileID == "files:504")
        let binary = try StudyDocumentImporter.read(data: Data([0, 1, 2, 3, 255]), name: "binary.eam", store: store)
        precondition(binary.kind == .preview, "Binary attachments must never be treated as source text")
        let empty = try StudyDocumentImporter.read(data: Data(" \n\t".utf8), name: "empty.nanowire", store: store)
        precondition(
            empty.unreadablePages == empty.pageCount, "Empty source markup must not imply readable companion content")
        workspace.openAssignment(
            workspace.assignment!, courseID: course.id, fileID: "files:502", clientOverride: client)
        try await settle()
        precondition(workspace.document?.sourceKey == "files:502", "PDF choices stay in the assignment page")
        workspace.flush()
        let reopened = StudyWorkspaceModel(store: store)
        precondition(
            reopened.assignment?.id == assignment.id && reopened.document?.sourceKey == "files:502"
                && !reopened.assignmentText.isEmpty)
        let requests = AssignmentFixtureProtocol.state.paths.count
        reopened.showCourseLibrary()
        reopened.openAssignment(assignment, courseID: course.id)
        for _ in 0..<500 where reopened.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        precondition(
            reopened.document?.sourceKey == "files:501" && AssignmentFixtureProtocol.state.paths.count == requests,
            "Cached assignments reopen without authentication or network requests")
        workspace.openAssignment(assignment, courseID: course.id, clientOverride: client)
        workspace.showCourseLibrary()
        try await settle()
        precondition(
            workspace.isShowingLibrary && workspace.assignment == nil,
            "Finishing a download must not reopen an assignment after leaving it")
        workspace.openAssignment(
            catalog.items.first { $0.remoteID == "1" }!, courseID: course.id, clientOverride: client)
        precondition(
            workspace.assignment?.assignment?.locked == true && workspace.document == nil && !workspace.canvasBusy)

        let failedStore = StudyLibraryStore(root: root.appendingPathComponent("failure"))
        try failedStore.save(StudyLibrary(courses: [course]))
        let failed = StudyWorkspaceModel(store: failedStore)
        AssignmentFixtureProtocol.attachments.set(data: try fixturePDF(), fail: true)
        failed.openAssignment(assignment, courseID: course.id, fileID: "files:502", clientOverride: client)
        for _ in 0..<500 where failed.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        precondition(
            !failed.canvasBusy && failed.assignment != nil && failed.document == nil && !failed.assignmentText.isEmpty
                && failed.assignmentNotice != nil)
        let incomplete = StudyContextBuilder.build(
            document: nil, index: nil, currentPage: 1,
            question: "Explain this", selection: "", course: failed.course!, store: failedStore,
            includeCourse: false, assignment: failed.assignment, assignmentFileNotices: failed.assignmentFileNotices)
        precondition(
            incomplete.text.contains("Formula sheet.pdf") && incomplete.text.contains("Contents are unavailable"),
            "Missing linked files must be identified instead of silently omitted")
        AssignmentFixtureProtocol.attachments.set(data: try fixturePDF(), fail: false)
        failed.openAssignment(failed.assignment!, courseID: course.id, clientOverride: client)
        for _ in 0..<500 where failed.canvasBusy { try await Task.sleep(for: .milliseconds(20)) }
        precondition(
            failed.document?.sourceKey == "files:502" && failed.assignmentNotice == nil,
            "Retry preserves instructions and retries the chosen PDF")
        print(
            "PASS: assignment included files, safe simulation text, bounded companion context, draft ownership, offline reopen, navigation, locked content and retry"
        )
    }

    /// An isolated real backend for manual Chromium verification; never uses the user's library or Canvas session.
    static func previewAssignments() async throws {
        AssignmentFixtureProtocol.state.revision = 1
        let client = try assignmentClient()
        let catalog = try await client.catalog(courseID: 1)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "scholia-assignments-preview-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = StudyLibraryStore(root: root)
        var course = StudyCourse(
            name: "Linear algebra & differential equations", code: "MATH101-26H", canvasID: 1,
            canvasOrigin: "https://canvas.example", canvasMaterials: catalog.items, catalogUpdatedAt: Date(),
            term: "2026 HØST")
        // Save descriptions so Read assignment exercises native/web navigation offline.
        for material in catalog.items {
            var document = try StudyDocumentImporter.read(
                data: Data(
                    "# \(material.title)\n\nSolve the problems and upload your work in Canvas.\n\nThis is an isolated test assignment."
                        .utf8), name: "\(material.title).md", store: store)
            document.sourceKey = material.id
            document.sourceVersion = material.version
            document.sourceURL = material.sourceURL
            course.documents.append(document)
        }
        for id in ["501", "502", "503", "504", "505"] {
            let file = try await client.fileReference(id: id, courseID: 1)
            course.canvasMaterials?.append(file)
            let data =
                ["501", "502"].contains(id) ? try fixturePDF() : Data(AssignmentFixtureProtocol.textFile(id).utf8)
            var document = try StudyDocumentImporter.read(data: data, name: file.fileName!, store: store)
            document.title = file.title
            document.sourceKey = file.id
            document.sourceURL = file.sourceURL
            document.sourceVersion = file.version
            course.documents.append(document)
        }
        var second = course
        second.id = UUID()
        second.name = "Programming fundamentals"
        second.code = "CS101-26H"
        second.documents = []
        second.canvasMaterials = [catalog.items.first { $0.remoteID == "9" }!]
        var past = second
        past.id = UUID()
        past.name = "Past course"
        past.code = "PAST-25H"
        past.term = "2025 HØST"
        try store.save(
            StudyLibrary(
                courses: [course, second, past], showingCourseLibrary: true, courseLibraryView: .assignments,
                canvasCheckedAt: Date(), canvasRefreshSummary: "Fixture deadlines loaded."))
        let workspace = StudyWorkspaceModel(store: store)
        workspace.setCourseLibraryView(.all)
        let controller = StudyWindowController(app: AppModel.shared, workspace: workspace, autosave: false)
        controller.show()
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try await Task.sleep(for: .milliseconds(500))
        try snapshot(controller.window, at: output.appendingPathComponent("workspace-dashboard-assignments.png"))
        let server = StudyWebServer(
            app: AppModel.shared, workspace: workspace, assets: URL(fileURLWithPath: "dist/web"))
        server.start(port: 0)
        for _ in 0..<100 where server.address == nil { try await Task.sleep(for: .milliseconds(20)) }
        print("ASSIGNMENTS_PREVIEW \(server.address!.absoluteString)")
        fflush(stdout)
        if CommandLine.arguments.contains("--assignment-page-smoke") {
            let browser = Process()
            browser.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            browser.arguments = [
                "node", "scripts/smoke-assignment-page.mjs", server.address!.absoluteString, output.path,
            ]
            let result: Int32 = await withCheckedContinuation { continuation in
                browser.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
                do { try browser.run() } catch { continuation.resume(returning: -1) }
            }
            precondition(result == 0, "Chromium assignment page smoke failed")
            try snapshot(controller.window, at: output.appendingPathComponent("assignment-native.png"))
            func splitView(in view: NSView) -> NSSplitView? {
                if let split = view as? NSSplitView, split.isVertical, split.arrangedSubviews.count == 2 {
                    return split
                }
                return view.subviews.lazy.compactMap { splitView(in: $0) }.first
            }
            let split = splitView(in: controller.window.contentView!)!
            split.setPosition(85, ofDividerAt: 0)
            try await Task.sleep(for: .milliseconds(300))
            precondition(
                split.arrangedSubviews[0].frame.width <= 100
                    && split.arrangedSubviews[1].frame.width > split.bounds.width * 0.85,
                "Native AI chat can expand to nearly the whole document workspace")
            try snapshot(controller.window, at: output.appendingPathComponent("assignment-native-wide-chat.png"))
            split.setPosition(split.bounds.width - 225, ofDividerAt: 0)
            try await Task.sleep(for: .milliseconds(300))
            precondition(split.arrangedSubviews[1].frame.width < 250, "Native AI chat can also be narrowed")
            split.setPosition(split.bounds.width - 390, ofDividerAt: 0)
            print("PASS: Native AI chat resizes from a narrow sidebar to nearly the full document workspace")
            server.stop()
            return
        }
        while !Task.isCancelled { try await Task.sleep(for: .seconds(1)) }
        server.stop()
    }
}

final class AssignmentFixtureProtocol: URLProtocol, @unchecked Sendable {
    static let state = CanvasFixtureState()
    static let attachments = AssignmentAttachmentFixture()
    static func fileName(_ id: String) -> String {
        [
            "501": "Exercises.pdf", "502": "Formula sheet.pdf", "503": "notes.txt", "504": "in.nanowire",
            "505": "Ni.eam",
        ][id] ?? "notes.txt"
    }
    static func textFile(_ id: String) -> String {
        switch id {
        case "504":
            "# Tensile test input\nunits metal\natom_style atomic\npair_style eam\npair_coeff * * Ni.eam\nfix tensile all deform 1 z erate 0.001\n"
        case "505":
            "Nickel EAM potential fixture\n28 58.6934 3.5200 FCC\n1000 0.01 1000 0.01 5.0\n"
                + String(repeating: "0.1023 0.2301 0.5900 0.0321\n", count: 1000)
        default: "These notes belong to the tensile test assignment."
        }
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        precondition(
            url.host == "canvas.example" && request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token"
        )
        Self.state.record(url.absoluteString)
        let path = url.path
        let revision = Self.state.revision
        var status = 200
        var body: Any = [[String: Any]]()
        var headers = ["Content-Type": "application/json"]
        func assignment(_ id: Int) -> [String: Any] {
            var item: [String: Any] = [
                "id": id, "name": "Exercise \(id)", "updated_at": "unchanged", "published": true,
                "submission_types": ["online_upload"], "due_at": "2026-09-28T18:00:00Z",
                "submission": ["workflow_state": "unsubmitted"],
            ]
            switch id {
            case 1:
                item["locked_for_user"] = true
                item["unlock_at"] = "2026-09-28T00:00:00Z"
                item["due_at"] = revision == 1 ? "2026-09-29T12:00:00+02:00" : NSNull()
            case 2:
                item["due_at"] = "2026-09-20T18:00:00Z"
                item["submission"] = ["workflow_state": "graded", "score": 0, "missing": true]
            case 3: item["submission"] = ["workflow_state": "submitted", "submitted_at": "2026-09-26T12:00:00Z"]
            case 4: item["submission"] = ["excused": true]
            case 5: item["submission_types"] = ["none"]
            case 6: item["submission_types"] = ["not_graded"]
            case 7:
                item["due_at"] = NSNull()
                item.removeValue(forKey: "submission")
            case 8: item["hidden_for_user"] = true
            case 9:
                item["description"] =
                    "<p>Show your work for both exercises.</p><a href=\"/courses/1/files/501/download\">Exercises.pdf</a><a href=\"/files/502/preview\">Formula sheet.pdf</a><a href=\"/files/503\">Notes</a><a href=\"/files/504\">in.nanowire</a><a href=\"/files/505\">Ni.eam</a>"
                if revision == 2 { item["submission"] = ["workflow_state": "pending_review"] }
            case 10: item["published"] = false
            default: break
            }
            if item["description"] == nil { item["description"] = "<p>Show your work.</p>" }
            return item
        }
        if path.hasSuffix(".pdf") {
            let (data, fail) = Self.attachments.value
            let response = HTTPURLResponse(
                url: url, statusCode: fail ? 503 : 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/pdf"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
            return
        } else if path.hasSuffix(".txt") {
            let id = url.deletingPathExtension().lastPathComponent
            let data = Data(Self.textFile(id).utf8)
            let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/octet-stream"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
            return
        } else if path.hasPrefix("/api/v1/courses/1/files/") {
            let id = path.components(separatedBy: "/").last!
            let name = Self.fileName(id)
            body = [
                "id": Int(id)!, "filename": name, "display_name": name, "updated_at": "file-v1", "size": 1000,
                "url": "https://canvas.example/\(id).\(id == "501" || id == "502" ? "pdf" : "txt")",
            ]
        } else if path == "/api/v1/courses/1/assignments" {
            precondition(
                URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains {
                    $0.name == "include[]" && $0.value == "submission"
                } == true)
            if url.query?.contains("page=2") == true {
                body = [assignment(9), assignment(10)]
            } else {
                body = (1...8).map(assignment)
                headers["Link"] = "<https://canvas.example\(path)?include[]=submission&page=2>; rel=\"next\""
            }
        } else if ["/api/v1/courses/2/assignments", "/api/v1/courses/3/assignments"].contains(path) {
            status = 403
        } else if ["/api/v1/courses/2/modules", "/api/v1/courses/3/modules"].contains(path) {
            body = [
                [
                    "id": 55, "name": "Module exercises", "items_count": 1,
                    "items": [["type": "Assignment", "content_id": 9, "title": "Exercise 9"]],
                ]
            ]
        } else if ["/api/v1/courses/1/assignments/9", "/api/v1/courses/2/assignments/9"].contains(path) {
            body = assignment(9)
        } else if path == "/api/v1/courses/3/assignments/9" {
            status = 403
        } else if ["/api/v1/courses/1", "/api/v1/courses/2", "/api/v1/courses/3"].contains(path) {
            body = ["syllabus_body": ""]
        } else {
            precondition(
                path.hasSuffix("/pages") || path.hasSuffix("/files") || path.hasSuffix("/modules"),
                "Unexpected fixture request: \(path)")
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class AssignmentAttachmentFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private var fail = false
    func set(data: Data, fail: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.data = data
        self.fail = fail
    }
    var value: (Data, Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (data, fail)
    }
}
