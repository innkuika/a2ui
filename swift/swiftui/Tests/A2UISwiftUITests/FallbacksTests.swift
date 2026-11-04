// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import A2UICore
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

/// What the fallbacks were asked for and which probed views were laid out, and where.
private final class FallbackRecorder: @unchecked Sendable {
  var pending: Set<A2UIPendingInfo> = []
  var errors: Set<A2UIErrorInfo> = []
  var origins: [String: CGPoint] = [:]

  /// Fallbacks that render a probed `Text` named after the component, or nothing when
  /// `rendersNothing` is set.
  @MainActor
  func fallbacks(rendersNothing: Bool = false) -> A2UIFallbacks {
    A2UIFallbacks(
      pending: { info in
        self.pending.insert(info)
        return rendersNothing ? nil : AnyView(self.probe("pending:\(info.componentID)"))
      },
      error: { info in
        self.errors.insert(info)
        return rendersNothing ? nil : AnyView(self.probe("error:\(info.componentID)"))
      }
    )
  }

  /// A `Text` that records its origin in the "container" coordinate space under `key`.
  func probe(_ key: String, text: String? = nil) -> some View {
    Text(text ?? key)
      .background(
        GeometryReader { proxy in
          let origin = proxy.frame(in: .named("container")).origin
          let _ = MainActor.assumeIsolated { self.origins[key] = origin }
          Color.clear
        }
      )
  }
}

@Suite(.serialized)
@MainActor
struct FallbacksTests {
  private let swiftUICatalog = BasicCatalogImplementation.makeCatalog(version: .v091)

  private var catalogs: [String: Catalog<ComponentImplementation>] {
    [swiftUICatalog.id: swiftUICatalog]
  }

  private func column(_ children: [Node], justify: String = "start") -> Node {
    Node(id: "col", type: "Column", properties: ["justify": justify, "children": children])
  }

  private let pendingChild = Node(
    id: "p", type: Node.placeholderType, state: .pending, properties: [:])
  private let unknownChild = Node(
    id: "x", type: "StarRating", state: .unknownType, properties: [:])
  // A cyclic placeholder keeps the repeated component's type, which the catalog can build.
  private let cyclicChild = Node(id: "c", type: "Card", state: .cyclic, properties: [:])
  private let textChild = Node(id: "a", type: "Text", properties: ["text": "A"])

  @Test func renderedChildrenLeavesOutPlaceholdersWithoutFallbacks() {
    let node = column([textChild, pendingChild, unknownChild, cyclicChild])
    let ids = node.renderedChildren(
      for: "children", in: catalogs, defaultCatalogID: swiftUICatalog.id
    ).map(\.id)
    #expect(ids == ["a"])
    #expect(Surface.render(node: cyclicChild, using: catalogs) == nil)
  }

  @Test func renderedChildrenKeepsChildrenWhoseFallbackRendersSomething() {
    let recorder = FallbackRecorder()
    let node = column([textChild, pendingChild, unknownChild, cyclicChild])
    let ids = node.renderedChildren(
      for: "children",
      in: catalogs,
      defaultCatalogID: swiftUICatalog.id,
      fallbacks: recorder.fallbacks()
    ).map(\.id)

    #expect(ids == ["a", "p", "x", "c"])
    #expect(recorder.pending == [A2UIPendingInfo(componentID: "p", parentComponentType: "Column")])
    #expect(
      recorder.errors == [
        A2UIErrorInfo(
          componentID: "x",
          parentComponentType: "Column",
          error: A2UIFallbackError(type: "unknown-type", componentType: "StarRating")
        ),
        A2UIErrorInfo(
          componentID: "c",
          parentComponentType: "Column",
          error: A2UIFallbackError(type: "cyclic")
        ),
      ]
    )
  }

  @Test func renderedChildrenLeavesOutChildrenWhoseFallbackRendersNothing() {
    let recorder = FallbackRecorder()
    let node = column([textChild, pendingChild, unknownChild, cyclicChild])
    let ids = node.renderedChildren(
      for: "children",
      in: catalogs,
      defaultCatalogID: swiftUICatalog.id,
      fallbacks: recorder.fallbacks(rendersNothing: true)
    ).map(\.id)

    #expect(ids == ["a"])
    #expect(recorder.pending.count == 1)
    #expect(recorder.errors.count == 2)
  }

  @Test func surfaceRendersFallbacksAndReplacesPendingChildInPlace() {
    let recorder = FallbackRecorder()
    let viewModel = SurfaceViewModel(
      surfaceID: "s", catalog: BasicCatalog.makeCatalog(version: .v091))
    let host = Host(
      Surface(
        viewModel: viewModel,
        catalog: probedCatalog(recorder),
        fallbacks: recorder.fallbacks()
      ))

    // Before the root arrives, the pending fallback stands in for it.
    #expect(recorder.pending == [A2UIPendingInfo(componentID: "root")])
    #expect(recorder.origins.keys.sorted() == ["pending:root"])

    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "Column",
        properties: ["children": .array([.string("card"), .string("x")])]
      ),
      ComponentModel(id: "card", type: "Card", properties: ["child": .string("greeting")]),
      ComponentModel(id: "x", type: "StarRating", properties: [:]),
    ])
    recorder.pending = []
    recorder.origins = [:]
    host.flush()

    // Each child's fallback gets the type of the component that renders it.
    #expect(
      recorder.pending == [A2UIPendingInfo(componentID: "greeting", parentComponentType: "Card")])
    #expect(
      recorder.errors == [
        A2UIErrorInfo(
          componentID: "x",
          parentComponentType: "Column",
          error: A2UIFallbackError(type: "unknown-type", componentType: "StarRating")
        )
      ]
    )
    #expect(recorder.origins.keys.sorted() == ["error:x", "pending:greeting"])

    viewModel.componentsModel.addComponent(
      ComponentModel(id: "greeting", type: "Text", properties: ["text": .string("Hello")]))
    recorder.origins = [:]
    host.flush()

    // The Text takes the fallback's place.
    #expect(recorder.origins.keys.sorted() == ["Hello"])
  }

  @Test func surfaceWithoutPendingFallbackRendersNothingBeforeTheRoot() {
    let recorder = FallbackRecorder()
    let viewModel = SurfaceViewModel(
      surfaceID: "s", catalog: BasicCatalog.makeCatalog(version: .v091))
    _ = Host(
      Surface(
        viewModel: viewModel,
        catalog: swiftUICatalog,
        fallbacks: A2UIFallbacks(error: recorder.fallbacks().error)
      ))
    #expect(recorder.origins.isEmpty)
  }

  @Test(arguments: ["Row", "Column"])
  func fallbackTakesASlotAndNothingTakesNone(container: String) {
    let recorder = FallbackRecorder()
    let texts = ["a", "b", "c"].map { id in
      Node(id: id, type: "Text", properties: ["text": "pending:\(id)"])
    }
    let pending = Node(id: "b", type: Node.placeholderType, state: .pending, properties: [:])

    let reference = measure(container, [texts[0], texts[1], texts[2]], recorder: recorder)
    #expect(reference.count == 3)
    // A pending "b" whose fallback is laid out exactly like the Text it stands in for.
    #expect(
      measure(container, [texts[0], pending, texts[2]], recorder: recorder) == reference)
    let withoutB = measure(container, [texts[0], texts[2]], recorder: recorder)
    #expect(withoutB.count == 2)
    #expect(
      measure(
        container, [texts[0], pending, texts[2]], recorder: recorder, rendersNothing: true)
        == withoutB)
  }

  /// The basic catalog with a `Text` that renders `recorder`'s probe named after its text.
  private func probedCatalog(_ recorder: FallbackRecorder) -> Catalog<ComponentImplementation> {
    let probedText = ComponentImplementation(api: BasicCatalogComponents.text) { node in
      recorder.probe(node.string(for: "text") ?? "")
    }
    return Catalog(
      id: swiftUICatalog.id,
      protocolVersion: .v091,
      components: swiftUICatalog.components.values.filter { $0.name != "Text" } + [probedText]
    )
  }

  /// Hosts a `container` with `justify: spaceBetween` whose Text children and fallbacks render
  /// the same probe, and returns their origins.
  private func measure(
    _ container: String,
    _ children: [Node],
    recorder: FallbackRecorder,
    rendersNothing: Bool = false
  ) -> [String: CGPoint] {
    recorder.origins = [:]
    let catalog = probedCatalog(recorder)
    let node = Node(
      id: "container",
      type: container,
      properties: ["justify": "spaceBetween", "children": children]
    )
    let stack = container == "Row" ? AnyView(A2UIRow(node: node)) : AnyView(A2UIColumn(node: node))
    let host = Host(
      stack
        .environment(\.a2uiCatalogs, [catalog.id: catalog])
        .environment(\.a2uiDefaultCatalogID, catalog.id)
        .environment(\.a2uiFallbacks, recorder.fallbacks(rendersNothing: rendersNothing))
    )
    return withExtendedLifetime(host) { recorder.origins }
  }
}

/// Hosts a view in a 300x200 window with a "container" coordinate space and lays it out.
@MainActor
private final class Host {
  #if canImport(AppKit)
    private let window: NSWindow
    private let view: NSView
  #elseif canImport(UIKit)
    private let window: UIWindow
    private let view: UIView
  #endif

  init(_ content: some View) {
    let size = CGSize(width: 300, height: 200)
    let rootView = content.frame(width: size.width, height: size.height)
      .coordinateSpace(name: "container")
    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = CGRect(origin: .zero, size: size)
      window = NSWindow(
        contentRect: hostingView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.contentView = hostingView
      view = hostingView
    #elseif canImport(UIKit)
      let controller = UIHostingController(rootView: rootView)
      window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.view.frame = window.bounds
      view = controller.view
    #endif
    flush()
  }

  func flush() {
    Self.spinRunLoop()
    #if canImport(AppKit)
      view.needsLayout = true
      view.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      Self.spinRunLoop()
      view.layoutSubtreeIfNeeded()
    #elseif canImport(UIKit)
      view.setNeedsLayout()
      view.layoutIfNeeded()
      Self.spinRunLoop()
      view.layoutIfNeeded()
    #endif
  }

  private static func spinRunLoop() {
    RunLoop.main.run(until: Date())
  }
}
