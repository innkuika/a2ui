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

/// What the fallback for a component that hasn't arrived yet is told.
public struct A2UIPendingInfo: Sendable, Hashable {
  /// The id of the component that hasn't arrived (`"root"` before the root arrives).
  public let componentID: String
  /// The type of the component whose child this is, or `nil` for the root.
  public let parentComponentType: String?

  public init(componentID: String, parentComponentType: String? = nil) {
    self.componentID = componentID
    self.parentComponentType = parentComponentType
  }
}

/// Why a component can't render.
public struct A2UIFallbackError: Sendable, Hashable {
  /// `"unknown-type"`, `"cyclic"`, or a kind added later.
  public let type: String
  /// The declared component type, for `"unknown-type"`.
  public let componentType: String?

  public init(type: String, componentType: String? = nil) {
    self.type = type
    self.componentType = componentType
  }
}

/// What the fallback for a component that can't render is told.
public struct A2UIErrorInfo: Sendable, Hashable {
  /// The id of the component that can't render.
  public let componentID: String
  /// The type of the component whose child this is, or `nil` for the root.
  public let parentComponentType: String?
  /// Why the component can't render.
  public let error: A2UIFallbackError

  public init(componentID: String, parentComponentType: String? = nil, error: A2UIFallbackError) {
    self.componentID = componentID
    self.parentComponentType = parentComponentType
    self.error = error
  }
}

/// Views a ``Surface`` shows in place of components that can't render yet, or at all.
///
/// A builder that is unset or returns `nil` renders nothing, which takes no space in a layout.
/// Builders run while SwiftUI renders, so they must not report errors: the resolver already
/// reported them to the surface's action handler.
///
/// The builders only run on the main actor, which makes sharing the struct safe.
public struct A2UIFallbacks: @unchecked Sendable {
  /// Builds the view for a component that hasn't arrived yet.
  public var pending: (@MainActor (A2UIPendingInfo) -> AnyView?)?
  /// Builds the view for a component that won't render unless the agent changes it.
  public var error: (@MainActor (A2UIErrorInfo) -> AnyView?)?

  public init(
    pending: (@MainActor (A2UIPendingInfo) -> AnyView?)? = nil,
    error: (@MainActor (A2UIErrorInfo) -> AnyView?)? = nil
  ) {
    self.pending = pending
    self.error = error
  }

  /// The fallback view for `node`, or `nil` to render nothing.
  @MainActor
  func view(for node: Node, parentComponentType: String?) -> AnyView? {
    switch node.state {
    case .pending:
      return pending?(
        A2UIPendingInfo(componentID: node.componentID, parentComponentType: parentComponentType)
      )
    case .cyclic:
      return error?(
        A2UIErrorInfo(
          componentID: node.componentID,
          parentComponentType: parentComponentType,
          error: A2UIFallbackError(type: "cyclic")
        )
      )
    case .resolved, .unknownType:
      return error?(
        A2UIErrorInfo(
          componentID: node.componentID,
          parentComponentType: parentComponentType,
          error: A2UIFallbackError(type: "unknown-type", componentType: node.type)
        )
      )
    }
  }
}

/// Environment key for the fallbacks of the enclosing ``Surface``.
public struct A2UIFallbacksKey: EnvironmentKey {
  public static let defaultValue = A2UIFallbacks()
}

/// Environment key for the type of the component whose subtree a view is in.
public struct A2UIParentComponentTypeKey: EnvironmentKey {
  public static let defaultValue: String? = nil
}

extension EnvironmentValues {
  /// The fallbacks of the enclosing ``Surface``.
  public var a2uiFallbacks: A2UIFallbacks {
    get { self[A2UIFallbacksKey.self] }
    set { self[A2UIFallbacksKey.self] = newValue }
  }

  /// The type of the component that renders the current subtree; `ComponentNodeView` publishes
  /// it so that a child's fallback gets its `parentComponentType`.
  public var a2uiParentComponentType: String? {
    get { self[A2UIParentComponentTypeKey.self] }
    set { self[A2UIParentComponentTypeKey.self] = newValue }
  }
}
