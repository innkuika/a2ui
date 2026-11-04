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
import SwiftUI
import os

/// Renders a single resolved A2UI engine node by looking up its view builder
/// from the active component catalogs in the SwiftUI environment.
///
/// The rendered view gets the node's `accessibility` attributes applied through
/// ``A2UIAccessibilityModifier``. When the component applied the label and hint to its own
/// control with ``SwiftUI/View/a2uiAccessibilityControl(for:)``, they are left off the root.
///
/// A node no catalog can build, and a pending or cyclic placeholder, renders the surface's
/// ``A2UIFallbacks`` view, or nothing. The rendered component publishes its type as
/// ``SwiftUI/EnvironmentValues/a2uiParentComponentType`` for its children's fallbacks.
public struct ComponentNodeView: View {
  @Environment(\.a2uiCatalogs) private var catalogs
  @Environment(\.a2uiDefaultCatalogID) private var defaultCatalogID
  @Environment(\.a2uiFallbacks) private var fallbacks
  @Environment(\.a2uiParentComponentType) private var parentComponentType

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  public var body: some View {
    let _ = (node.properties, node.metadata)
    switch Self.content(
      for: node,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID,
      fallbacks: fallbacks,
      parentComponentType: parentComponentType
    ) {
    case .component(let implementation):
      implementation.builder(node)
        .modifier(ComponentAccessibilityHostModifier(node: node))
        .environment(\.a2uiParentComponentType, node.type)
    case .fallback(let view):
      view
    case nil:
      EmptyView()
    }
  }

  /// What a node renders.
  enum NodeContent {
    case component(ComponentImplementation)
    case fallback(AnyView)
  }

  /// What `node` renders, or `nil` when it renders nothing.
  @MainActor
  static func content(
    for node: Node,
    catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String?,
    fallbacks: A2UIFallbacks,
    parentComponentType: String?
  ) -> NodeContent? {
    if let implementation = Surface.implementation(
      for: node, using: catalogs, defaultCatalogID: defaultCatalogID)
    {
      return .component(implementation)
    }
    if node.state == .resolved || node.state == .unknownType {
      logMissingViewBuilder(for: node, defaultCatalogID: defaultCatalogID)
    }
    return fallbacks.view(for: node, parentComponentType: parentComponentType).map {
      .fallback($0)
    }
  }

  private static let logger = Logger(subsystem: "A2UISwiftUI", category: "ComponentNodeView")

  /// Catalog and type pairs already logged, so a missing view builder is logged once per
  /// process instead of on every render.
  @MainActor private static var loggedMissingViewBuilders: Set<String> = []

  /// Logs a node type that has no view builder in the SwiftUI catalogs passed to `Surface`.
  ///
  /// A type missing from the surface's catalog was already reported to the agent by the
  /// resolver as `UNKNOWN_COMPONENT_TYPE`. A catalog type with no view builder is a host setup
  /// mismatch that only this log points at.
  @MainActor private static func logMissingViewBuilder(
    for node: Node,
    defaultCatalogID: String?
  ) {
    let catalogID = node.catalogID ?? defaultCatalogID ?? "default"
    guard loggedMissingViewBuilders.insert("\(catalogID)/\(node.type)").inserted else {
      return
    }
    logger.warning(
      """
      No view builder for component type '\(node.type, privacy: .public)' \
      in catalog '\(catalogID, privacy: .public)'.
      """
    )
  }
}

private struct ComponentAccessibilityHostModifier: ViewModifier {
  let node: Node

  /// Whether the rendered component reported applying its label and hint to its own control.
  @State private var controlCarriesLabel = false

  func body(content: Content) -> some View {
    content
      .modifier(
        A2UIAccessibilityModifier(node: node, appliesLabelAndHint: !controlCarriesLabel)
      )
      .onPreferenceChange(A2UIAccessibilityControlKey.self) { carriesLabel in
        // SwiftUI delivers preference changes on the main thread. Updating synchronously avoids
        // a frame where both the root and the control carry the label.
        MainActor.assumeIsolated {
          if controlCarriesLabel != carriesLabel {
            controlCarriesLabel = carriesLabel
          }
        }
      }
      // A nested component's control must not affect its ancestors.
      .transformPreference(A2UIAccessibilityControlKey.self) { $0 = false }
  }
}
